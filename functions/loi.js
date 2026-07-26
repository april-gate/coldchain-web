/**
 * April Gate — Letter of Intent capture with magic-link email verification.
 * Cloudflare Pages Function.  Route: POST /loi
 *
 * A non-verified LOI is still stored and still counts as a lead; email_verified
 * only tracks whether the submitter confirmed their address. The submitter gets
 * a single-use, 30-minute magic link; the founders get a notification. Both
 * emails go out via context.waitUntil so they never block the response.
 *
 * Bindings / vars (Pages project → Settings):
 *   D1 binding   WAITLIST_DB     -> holds loi + loi_tokens (see schema/loi.sql)
 *   secret       RESEND_API_KEY  -> enables email (LOI still stores without it)
 *   var          PUBLIC_BASE_URL -> e.g. https://aprilgatehq.com (magic-link base)
 *   var          NOTIFY_TO       -> founder email(s), comma-separated
 *   var          NOTIFY_FROM     -> Resend-verified sender
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Free / consumer email providers — soft-flagged, never rejected.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "zoho.com", "pm.me",
]);

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function clean(v, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendEmail(env, { to, subject, text, html, replyTo }) {
  if (!env.RESEND_API_KEY) return; // email is best-effort; LOI is already stored
  const from = env.NOTIFY_FROM || "April Gate <onboarding@resend.dev>";
  const payload = { from, to, subject };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("Resend send failed:", res.status, await res.text());
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  // 1. Honeypot: a real user never fills a hidden "website" field.
  if (clean(data.website)) return json({ ok: true }); // silently accept, store nothing

  // 2. Required fields.
  const name = clean(data.name || data.fullName, 200);
  const email = clean(data.email, 200).toLowerCase();
  if (!name || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Name and a valid email are required." }, 400);
  }

  const row = {
    name,
    email,
    phone:           clean(data.phone, 60),
    company:         clean(data.company, 200),
    role:            clean(data.role || data.title, 200),
    facility_type:   clean(data.facilityType || data.facility_type, 100),
    intent:          clean(data.intent, 4000),   // free-text letter of intent
    consent_version: clean(data.consent_version, 60) || "loi-v1",
    ip:              request.headers.get("CF-Connecting-IP") || "",
    user_agent:      request.headers.get("user-agent") || "",
  };

  // 2b. The letter of intent is required.
  if (!row.intent) {
    return json({ ok: false, error: "A letter of intent is required." }, 400);
  }

  // 3. Soft-flag free providers (store anyway).
  const domain = email.split("@")[1] || "";
  const freeEmail = FREE_EMAIL_DOMAINS.has(domain) ? 1 : 0;

  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  // 4. Upsert the LOI row (email_verified defaults to 0 on first insert; a
  //    resubmit updates the details but preserves any existing verification).
  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO loi
         (name, email, phone, company, role, facility_type, intent, consent_version,
          email_verified, free_email, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         name=excluded.name, phone=excluded.phone, company=excluded.company,
         role=excluded.role, facility_type=excluded.facility_type,
         intent=excluded.intent, consent_version=excluded.consent_version,
         free_email=excluded.free_email, ip=excluded.ip, user_agent=excluded.user_agent`
    )
      .bind(
        row.name, row.email, row.phone, row.company, row.role, row.facility_type,
        row.intent, row.consent_version, freeEmail, row.ip, row.user_agent
      )
      .run();
  } catch (err) {
    console.error("D1 upsert (loi) failed:", err && err.message);
    return json({ ok: false, error: "Could not save your details." }, 500);
  }

  // 5. Generate a single-use, expiring magic-link token (Web Crypto).
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO loi_tokens (token, email, expires_at, used, created_at)
       VALUES (?, ?, ?, 0, datetime('now'))`
    ).bind(token, row.email, expiresAt).run();
  } catch (err) {
    // Token failure shouldn't lose the lead — it's already stored.
    console.error("D1 insert (loi_tokens) failed:", err && err.message);
  }

  // 6 + 7. Fire off the magic-link email and the founder notification without
  //        blocking the response.
  const base = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const verifyUrl = `${base}/loi/verify?token=${encodeURIComponent(token)}`;

  const magicLink = sendEmail(env, {
    to: [row.email],
    subject: "Confirm your April Gate early-access request",
    text:
      `Hi ${row.name},\n\n` +
      `Thanks for your interest in April Gate. Please confirm your email by opening this link within 30 minutes:\n\n` +
      `${verifyUrl}\n\n` +
      `If you didn't request this, you can ignore this message.\n\n— April Gate`,
    html:
      `<p>Hi ${esc(row.name)},</p>` +
      `<p>Thanks for your interest in April Gate. Please confirm your email within 30 minutes:</p>` +
      `<p><a href="${esc(verifyUrl)}">Confirm my email</a></p>` +
      `<p style="color:#666;font-size:12px">If you didn't request this, you can ignore this message.</p>`,
  });

  const notifyTo = (env.NOTIFY_TO || "irina@aprilgatehq.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const founderNote = sendEmail(env, {
    to: notifyTo,
    replyTo: row.email,
    subject: `New LOI: ${row.company || row.name}${freeEmail ? " (free email)" : ""}`,
    text:
      `New April Gate LOI (unverified)\n\n` +
      `Name:     ${row.name}\n` +
      `Email:    ${row.email}${freeEmail ? "  [free provider]" : ""}\n` +
      `Phone:    ${row.phone || "—"}\n` +
      `Company:  ${row.company || "—"}\n` +
      `Role:     ${row.role || "—"}\n` +
      `Facility: ${row.facility_type || "—"}\n` +
      `Consent:  ${row.consent_version}\n` +
      `IP:       ${row.ip || "—"}\n\n` +
      `Letter of intent:\n${row.intent || "—"}\n`,
  });

  const done = Promise.allSettled([magicLink, founderNote]);
  if (typeof context.waitUntil === "function") context.waitUntil(done);

  // 8. Always succeed to the visitor once the lead is stored.
  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
