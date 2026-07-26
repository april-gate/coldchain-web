/**
 * April Gate — magic-link verification landing.
 * Cloudflare Pages Function.  Route: GET /loi/verify?token=<token>
 *
 * Consumes a single-use, expiring token: flips loi.email_verified = 1 for the
 * token's email and marks the token used. Renders a small styled page.
 *
 * CAVEAT: email link-scanners (corporate mail security) can pre-fetch this GET
 * and consume the token before the human clicks — the user then sees "already
 * used / expired". Acceptable for the demo. If it becomes a problem, switch to a
 * confirm *button* that POSTs (so a scanner's GET doesn't consume the token).
 */

const PAGE_HEAD = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>April Gate — Email verification</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#071019;color:#eaf4ff;font-family:'DM Sans',system-ui,sans-serif;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
  .card{max-width:460px;width:100%;background:#0f2231;border:1px solid #173247;
        padding:2.5rem;position:relative}
  .card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg,#4fd6ff,#6ea8ff)}
  .badge{width:3.5rem;height:3.5rem;border:1px solid #4fd6ff;background:rgba(79,214,255,.08);
        display:flex;align-items:center;justify-content:center;margin-bottom:1.5rem}
  .badge svg{width:1.7rem;height:1.7rem;fill:none;stroke:#4fd6ff;stroke-width:2.5}
  .badge.bad{border-color:#ff8a3d;background:rgba(255,138,61,.08)}
  .badge.bad svg{stroke:#ff8a3d}
  h1{font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.03em;
        color:#fff;margin-bottom:.75rem;font-weight:400}
  p{color:#88aecb;line-height:1.7;font-size:.98rem}
  a{color:#4fd6ff;text-decoration:none}
  .kicker{font-family:'Share Tech Mono',monospace;font-size:.65rem;letter-spacing:.22em;
        text-transform:uppercase;color:#4fd6ff;margin-bottom:1.25rem}
</style></head><body><div class="card">`;
const PAGE_FOOT = `</div></body></html>`;

function html(body, status = 200) {
  return new Response(PAGE_HEAD + body + PAGE_FOOT, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const OK_ICON = `<div class="badge"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>`;
const BAD_ICON = `<div class="badge bad"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg></div>`;

const invalidPage = () =>
  html(
    BAD_ICON +
      `<div class="kicker">April Gate</div>` +
      `<h1>Link invalid or expired</h1>` +
      `<p>This confirmation link is no longer valid — it may have already been used or expired (links last 30 minutes). ` +
      `You're still on our list. If you'd like a fresh link, just submit the form again, or email ` +
      `<a href="mailto:irina@aprilgatehq.com">irina@aprilgatehq.com</a>.</p>`,
    400
  );

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !env.WAITLIST_DB) return invalidPage();

  let tok;
  try {
    tok = await env.WAITLIST_DB.prepare(
      `SELECT token, email, expires_at, used FROM loi_tokens WHERE token = ?`
    ).bind(token).first();
  } catch (err) {
    console.error("D1 select (loi_tokens) failed:", err && err.message);
    return invalidPage();
  }

  if (!tok || tok.used || new Date(tok.expires_at).getTime() < Date.now()) {
    return invalidPage();
  }

  const verifiedAt = new Date().toISOString();
  try {
    await env.WAITLIST_DB.batch([
      env.WAITLIST_DB.prepare(
        `UPDATE loi SET email_verified = 1, verified_at = ? WHERE email = ?`
      ).bind(verifiedAt, tok.email),
      env.WAITLIST_DB.prepare(
        `UPDATE loi_tokens SET used = 1 WHERE token = ?`
      ).bind(token),
    ]);
  } catch (err) {
    console.error("D1 verify update failed:", err && err.message);
    return invalidPage();
  }

  return html(
    OK_ICON +
      `<div class="kicker">April Gate</div>` +
      `<h1>You're verified — thank you</h1>` +
      `<p>Your email is confirmed. You're on the founding list — you'll be first to hear as we build, ` +
      `and first to get it. <a href="/">Back to April Gate →</a></p>`
  );
}
