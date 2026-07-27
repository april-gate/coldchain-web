/**
 * April Gate — Operator Portal: list shipments.
 * Cloudflare Pages Function.  Route: GET /api/shipments/list
 *
 * Returns the off-chain shipment metadata rows (newest first) for the portal
 * list. Metadata only — the on-chain state is read per-shipment on the detail
 * page.
 */

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequestGet({ env }) {
  if (!env.WAITLIST_DB) {
    return json({ ok: false, error: "Storage not configured." }, 500);
  }
  try {
    const { results } = await env.WAITLIST_DB.prepare(
      `SELECT shipment_id, name, tier, temp_c_min, temp_c_max, num_devices,
              duration_days, origin, destination, create_sig, network, created_at
         FROM shipments
        ORDER BY created_at DESC
        LIMIT 200`
    ).all();
    return json({ ok: true, count: results.length, shipments: results });
  } catch (err) {
    console.error("D1 select (shipments list) failed:", err && err.message);
    return json({ ok: false, error: "Could not list shipments." }, 500);
  }
}
