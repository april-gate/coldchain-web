/**
 * April Gate — telemetry read endpoint (dashboard polls this).
 * Cloudflare Pages Function.  Route: GET /api/readings?shipment_id=<id>&limit=<n>
 *
 * Public read is fine for the demo. Returns ONLY reading fields — never LOI or
 * any other table's data.
 *
 * `ingest_v` travels with every row so the caller knows the temperature scale:
 * 1 = temp_c is legacy centi-Celsius, 2 = temp_c is degrees Celsius. Callers
 * must not assume a scale (see schema/readings_v2.sql).
 *
 * `sensor_ok` = 0 marks a reading where the device reported a failed sensor;
 * its `temp_c` is NULL. Such rows are real events and are returned, but callers
 * must exclude them from temperature maths (see schema/readings_v3.sql).
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
  const params = new URL(request.url).searchParams;
  const shipmentId = params.get("shipment_id");
  if (!shipmentId) {
    return json({ ok: false, error: "shipment_id is required." }, 400);
  }
  // Per-shipment dashboards want the whole run, not a 200-row tail.
  const requested = parseInt(params.get("limit"), 10);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 2000) : 200;
  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  try {
    const { results } = await env.WAITLIST_DB.prepare(
      `SELECT id, shipment_id, device_id, device_serial, proof_count, timestamp,
              temp_c, ingest_v, sensor_ok, received_at
         FROM readings
        WHERE shipment_id = ?
        ORDER BY id DESC
        LIMIT ?`
    ).bind(shipmentId, limit).all();

    return json({ ok: true, shipment_id: shipmentId, count: results.length, readings: results });
  } catch (err) {
    console.error("D1 select (readings) failed:", err && err.message);
    return json({ ok: false, error: "Could not read telemetry." }, 500);
  }
}
