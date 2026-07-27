/**
 * April Gate — /operator/shipment/<shipment_id> pretty URL.
 * Cloudflare Pages Function. Serves the shipment detail page (URL preserved);
 * its client JS reads the id from the path. See functions/verify/[id].js for
 * why a Function is used instead of a static _redirects rewrite.
 */
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const res = await fetch(origin + "/operator/shipment", { headers: { accept: "text/html" } });
  return new Response(res.body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
