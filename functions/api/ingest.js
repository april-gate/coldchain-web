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
 * Body: { "v":1, "device_id":"pico-01", "device_serial":"0123d7acbc34a9f9ee00…",
 *         "shipment_id":"<base58 shipment PDA>", "proof_count":42,
 *         "timestamp":"2026-07-24T14:32:05Z", "temp_c_centi":2537 }
 *
 * ── TEMPERATURE UNITS ──────────────────────────────────────────────────────
 * The device MUST declare its scale. Two accepted forms, both stored as
 * canonical degrees Celsius with ingest_v = 2:
 *
 *   { "temp_c_centi": 2537 }          -> 25.37 °C   (integer centi-Celsius)
 *   { "temp_c": 25.37, "unit": "C" }  -> 25.37 °C   (float degrees)
 *
 * A bare `temp_c`/`temp` with no `unit` is the LEGACY shape current firmware
 * sends: an integer that is really centi-Celsius but is labelled as degrees.
 * We store that value VERBATIM and mark the row ingest_v = 1 so readers know
 * the scale — we never guess at the magnitude. The response carries a
 * `warning` telling the device to declare its units.
 *
 * `device_serial` is the ATECC608 serial as lowercase hex — the same bytes the
 * program stores in DeviceRegistry.device_id. It is what joins a reading to its
 * on-chain DeviceAssignment. The human `device_id` is a display label only.
 *
 * ── SENSOR FAULTS ──────────────────────────────────────────────────────────
 * A reading is recorded as a fault (sensor_ok = 0, temp_c = NULL) when either:
 *   • the device sends `sensor_ok: false`, or
 *   • the temperature is outside PLAUSIBLE_C — firmware signals a failed read
 *     with a sentinel value (observed: -100000, i.e. -1000 °C).
 * The row is still stored. A gap in a cold-chain record is evidence and must be
 * visible; inventing a temperature to fill it would misrepresent the shipment.
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
/** Lowercase hex, no 0x, even length. Anything else is not a device serial. */
function hex(v, max = 64) {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]+$/.test(s) && s.length % 2 === 0 && s.length <= max ? s : null;
}

// Widest band any real cold-chain sensor can report. The DS18B20 spans
// -55..+125 °C; the margin leaves room for other parts without ever admitting a
// sentinel like -1000 °C.
const PLAUSIBLE_C = { min: -80, max: 150 };

/**
 * Resolve the reading's temperature to (value, ingest_v) per the unit contract
 * documented at the top of this file. Returns null when no usable value was
 * supplied, or an { error } when the payload is self-contradictory.
 */
function resolveTemp(data) {
  const centi = num(data.temp_c_centi);
  const plain = num(data.temp_c) ?? num(data.temp);
  const unit = str(data.unit, 8);

  if (centi !== null && plain !== null) {
    return { error: "Send either temp_c_centi or temp_c, not both." };
  }
  // Explicit centi-Celsius -> canonical degrees.
  if (centi !== null) return { temp_c: centi / 100, ingest_v: 2 };

  if (plain === null) {
    return { error: "A temperature is required (temp_c_centi, or temp_c with unit)." };
  }
  // Explicit unit declaration.
  if (unit) {
    const u = unit.toUpperCase();
    if (u === "C" || u === "°C") return { temp_c: plain, ingest_v: 2 };
    if (u === "CENTI_C" || u === "CC") return { temp_c: plain / 100, ingest_v: 2 };
    return { error: `Unsupported unit "${unit}". Use "C" or "centi_C".` };
  }
  // Legacy: undeclared scale. Store verbatim, flag the row, warn the device.
  return {
    temp_c: plain,
    ingest_v: 1,
    warning:
      "temp_c was sent without a `unit`; stored as legacy centi-Celsius " +
      "(ingest_v=1). Send `temp_c_centi` (integer) or `temp_c` + `unit:\"C\"`.",
  };
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
  // A device that reports its own sensor as failed is taken at its word: the
  // row is stored as a fault and no temperature is required or believed.
  const declaredFault = data.sensor_ok === false;

  let temp;
  if (declaredFault) {
    temp = { temp_c: null, ingest_v: 2, sensor_ok: 0, warning: "Device reported sensor_ok:false — stored as a sensor fault, no temperature recorded." };
  } else {
    temp = resolveTemp(data);
    if (temp.error) {
      return json({ ok: false, error: temp.error }, 400);
    }
    // A sentinel slipped through with sensor_ok unset (or true). Treat an
    // impossible temperature as the failed read it is rather than storing it.
    var asDegrees = temp.ingest_v >= 2 ? temp.temp_c : temp.temp_c / 100;
    if (asDegrees < PLAUSIBLE_C.min || asDegrees > PLAUSIBLE_C.max) {
      temp = {
        temp_c: null,
        ingest_v: temp.ingest_v,
        sensor_ok: 0,
        warning: "Temperature " + asDegrees + " °C is outside the plausible range (" +
          PLAUSIBLE_C.min + ".." + PLAUSIBLE_C.max + " °C); stored as a sensor fault.",
      };
    } else {
      temp.sensor_ok = 1;
    }
  }

  const row = {
    shipment_id:   shipmentId,
    device_id:     str(data.device_id, 120),
    device_serial: hex(data.device_serial ?? data.device_id_hex),
    proof_count:   int(data.proof_count),
    timestamp:     str(data.timestamp, 40),
    temp_c:        temp.temp_c,
    ingest_v:      temp.ingest_v,
    sensor_ok:     temp.sensor_ok,
    source_ip:     request.headers.get("CF-Connecting-IP") || "",
  };

  if (!env.WAITLIST_DB) {
    console.error("WAITLIST_DB binding is not configured.");
    return json({ ok: false, error: "Storage not configured." }, 500);
  }

  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO readings
         (shipment_id, device_id, device_serial, proof_count, timestamp, temp_c,
          ingest_v, sensor_ok, received_at, source_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    )
      .bind(
        row.shipment_id, row.device_id, row.device_serial, row.proof_count,
        row.timestamp, row.temp_c, row.ingest_v, row.sensor_ok, row.source_ip
      )
      .run();
  } catch (err) {
    console.error("D1 insert (readings) failed:", err && err.message);
    return json({ ok: false, error: "Could not store reading." }, 500);
  }

  return temp.warning ? json({ ok: true, warning: temp.warning }) : json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
