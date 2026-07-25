/**
 * April Gate — temperature telemetry ingest.
 * Cloudflare Pages Function.  Route: POST /api/ingest
 *
 * Write endpoint for devices / the local gateway. Requires a shared secret
 * header so the public can't spam readings.
 *
 * Bindings / secrets:
 *   D1 binding  WAITLIST_DB  -> readings table (see schema/readings.sql)
 *   secret      INGEST_KEY   -> must match the X-Ingest-Key request header
 *
 * Body: { "v":1, "device_id":"test-01", "shipment_id":"ship-001",
 *         "proof_count":42, "timestamp":"2026-07-24T14:32:05Z", "temp_f":71.6 }
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function str(v, max = 200) {
  return typeof v === "string" ? v.slice(0, max) : null;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function int(v) {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export async function onRequestPost({ request, env }) {
  // Auth: constant header check (missing key config => always 401).
  const provided = request.headers.get("X-Ingest-Key") || "";
  if (!env.INGEST_KEY || provided !== env.INGEST_KEY) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const shipmentId = str(data.shipment_id, 120);
  if (!shipmentId) {
    return json({ ok: false, error: "shipment_id is required." }, 400);
  }
  const tempF = num(data.temp_f);
  if (tempF === null) {
    return json({ ok: false, error: "temp_f must be a number." }, 400);
  }

  const row = {
    shipment_id: shipmentId,
    device_id:   str(data.device_id, 120),
    proof_count: int(data.proof_count),
    timestamp:   str(data.timestamp, 40),
    temp_f:      tempF,
    source_ip:   request.headers.get("CF-Connecting-IP") || "",
  };

  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO readings
         (shipment_id, device_id, proof_count, timestamp, temp_f, received_at, source_ip)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
    )
      .bind(row.shipment_id, row.device_id, row.proof_count, row.timestamp, row.temp_f, row.source_ip)
      .run();
  } catch (err) {
    console.error("D1 insert (readings) failed:", err && err.message);
    return json({ ok: false, error: "Could not store reading." }, 500);
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
