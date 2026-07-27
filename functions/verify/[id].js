/**
 * April Gate — /verify/<shipment_id> pretty URL (for QR links).
 * Cloudflare Pages Function. Serves the SAME verify.html page (URL preserved),
 * whose client JS reads the shipment id from the path and runs verification.
 *
 * A Function is used rather than a _redirects rewrite because Pages' automatic
 * clean-URL redirect strips the trailing id from /verify/<id> before a static
 * rewrite can apply.
 */
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  // /verify is the clean URL for verify.html (served as-is, no redirect).
  const res = await fetch(origin + "/verify", { headers: { accept: "text/html" } });
  return new Response(res.body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
