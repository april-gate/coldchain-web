/**
 * April Gate — list shipments that have telemetry (for the dashboard picker).
 * Cloudflare Pages Function.  Route: GET /api/shipments
 *
 * Returns distinct shipment_ids with a reading count and last-seen time, newest
 * activity first. Reading-table data only — no LOI/other tables.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequestGet({ env }) {
  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }
  try {
    const { results } = await env.WAITLIST_DB.prepare(
      `SELECT shipment_id,
              COUNT(*)       AS reading_count,
              MAX(received_at) AS last_seen
         FROM readings
        GROUP BY shipment_id
        ORDER BY last_seen DESC
        LIMIT 100`
    ).all();
    return json({ ok: true, count: results.length, shipments: results });
  } catch (err) {
    console.error("D1 select (shipments) failed:", err && err.message);
    return json({ ok: false, error: "Could not list shipments." }, 500);
  }
}
