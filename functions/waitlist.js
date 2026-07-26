/**
 * April Gate — early-access waitlist capture
 * Cloudflare Pages Function.  Route: POST /waitlist
 *
 * Stores each signup (all form fields + a server timestamp) in a D1 database
 * the founders can query and export, and — if a Resend API key is configured —
 * emails the founders one notification per signup.
 *
 * Bindings / vars (set in the Cloudflare Pages project → Settings):
 *   D1 binding      WAITLIST_DB   -> the D1 database (see schema.sql)
 *   var (optional)  RESEND_API_KEY  -> enables per-signup email
 *   var (optional)  NOTIFY_TO       -> comma-separated founder emails (default irina@aprilgatehq.com)
 *   var (optional)  NOTIFY_FROM     -> verified Resend sender (default waitlist@aprilgatehq.com)
 *
 * Founders can read/export signups with wrangler:
 *   wrangler d1 execute aprilgate-waitlist --command \
 *     "SELECT * FROM signups ORDER BY created_at DESC" --json
 *   # CSV:  add  --json | jq ...   or use the D1 dashboard export
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim + cap length so a bad/hostile payload can't bloat the row.
function clean(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

export async function onRequestPost({ request, env, waitUntil }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const row = {
    full_name:     clean(data.fullName, 200),
    email:         clean(data.email, 200),
    company:       clean(data.company, 200),
    title:         clean(data.title, 200),
    facility_type: clean(data.facilityType, 100),
    headache:      clean(data.headache, 2000),
  };

  // Server-side validation mirrors the client (never trust the client).
  if (!row.full_name || !row.email || !row.company) {
    return json({ ok: false, error: "Missing required fields." }, 400);
  }
  if (!EMAIL_RE.test(row.email)) {
    return json({ ok: false, error: "Invalid email." }, 400);
  }

  const createdAt = new Date().toISOString();
  const ua = request.headers.get("user-agent") || "";
  // Cloudflare-provided visitor country; harmless if absent.
  const country = request.cf && request.cf.country ? request.cf.country : "";

  if (!env.WAITLIST_DB) {
    // Fail loud in logs but don't 500 the visitor with a cryptic message.
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO signups
         (full_name, email, company, title, facility_type, headache, created_at, user_agent, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.full_name, row.email, row.company, row.title,
        row.facility_type, row.headache, createdAt, ua, country
      )
      .run();
  } catch (err) {
    console.error("D1 insert failed:", err && err.message);
    return json({ ok: false, error: "Could not save signup." }, 500);
  }

  // Fire-and-forget founder notification (never blocks/failing the signup).
  if (env.RESEND_API_KEY) {
    const to = (env.NOTIFY_TO || "irina@aprilgatehq.com")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const from = env.NOTIFY_FROM || "April Gate Waitlist <waitlist@aprilgatehq.com>";
    const notify = fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: row.email,
        subject: `New early-access signup: ${row.company}`,
        text:
          `New April Gate waitlist signup\n\n` +
          `Name:          ${row.full_name}\n` +
          `Email:         ${row.email}\n` +
          `Company:       ${row.company}\n` +
          `Title:         ${row.title || "—"}\n` +
          `Facility type: ${row.facility_type || "—"}\n` +
          `Headache:      ${row.headache || "—"}\n\n` +
          `Received:      ${createdAt}\n` +
          `Country:       ${country || "—"}\n`,
      }),
    }).catch((e) => console.error("Resend notify failed:", e && e.message));

    // Keep the worker alive for the email without delaying the response.
    if (typeof waitUntil === "function") waitUntil(notify);
  }

  return json({ ok: true });
}

// NOTE: legacy endpoint. The live form now posts to /loi (functions/loi.js);
// this remains only for backward compatibility. No onRequestGet is exported on
// purpose, so GET /waitlist falls through to the /waitlist → /waitlist.html
// redirect in public/_redirects instead of returning 405.