/**
 * April Gate — telemetry read endpoint (dashboard polls this).
 * Cloudflare Pages Function.  Route: GET /api/readings?shipment_id=<id>
 *
 * Public read is fine for the demo. Returns ONLY reading fields — never LOI or
 * any other table's data.
 *
 * Bindings:
 *   D1 binding  WAITLIST_DB  -> readings table
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequestGet({ request, env }) {
  const shipmentId = new URL(request.url).searchParams.get("shipment_id");
  if (!shipmentId) {
    return json({ ok: false, error: "shipment_id is required." }, 400);
  }
  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  try {
    const { results } = await env.WAITLIST_DB.prepare(
      `SELECT id, shipment_id, device_id, proof_count, timestamp, temp_f, received_at
         FROM readings
        WHERE shipment_id = ?
        ORDER BY id DESC
        LIMIT 200`
    ).bind(shipmentId).all();

    return json({ ok: true, shipment_id: shipmentId, count: results.length, readings: results });
  } catch (err) {
    console.error("D1 select (readings) failed:", err && err.message);
    return json({ ok: false, error: "Could not read telemetry." }, 500);
  }
}
