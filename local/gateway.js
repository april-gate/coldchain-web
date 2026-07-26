// April Gate — local gateway (device plain-HTTP → cloud HTTPS relay).
//
// Runs on the developer's laptop/Pi, NOT on Cloudflare. Lets a plain-HTTP device
// (e.g. a Pico) post readings to the LAN while the data still lands on the real
// site over HTTPS. Node >= 18, no external deps (built-in http + global fetch).
//
// Config via local/.env (gitignored) or the shell environment:
//   CLOUD_URL=https://aprilgatehq.com
//   INGEST_KEY=<same shared secret as the /api/ingest INGEST_KEY>
//   PORT=8080
//   SHIPMENT_ID=ship-001   (optional; default shipment stamped on readings that omit one)
//
// Run:   node --env-file=local/.env local/gateway.js      (Node >= 20.6)
//   or:   CLOUD_URL=... INGEST_KEY=... node local/gateway.js
//
// The device posts to:  http://<gateway-LAN-ip>:8080/ingest
//
// The gateway is forgiving about the device payload so a constrained device
// (e.g. a Pico) can send the bare minimum. Before forwarding it will:
//   - rename `device`  -> `device_id`
//   - default `shipment_id` -> SHIPMENT_ID (so /api/ingest's required field is met)
//   - default `timestamp`   -> now (ISO) if the device has no clock
// A device that already sends the full/correct shape is passed through unchanged.

import http from "node:http";

const { CLOUD_URL, INGEST_KEY, PORT = 8080, SHIPMENT_ID = "ship-001" } = process.env;

if (!CLOUD_URL || !INGEST_KEY) {
  console.error("Missing CLOUD_URL or INGEST_KEY (set them in local/.env).");
  process.exit(1);
}

// Fill in the fields /api/ingest needs when a minimal device omits them.
function normalize(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return raw; // not JSON — forward untouched, let the cloud reject it
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return raw;

  if (obj.device != null && obj.device_id == null) {
    obj.device_id = obj.device;
    delete obj.device;
  }
  if (obj.shipment_id == null || obj.shipment_id === "") {
    obj.shipment_id = SHIPMENT_ID;
  }
  if (obj.timestamp == null || obj.timestamp === "") {
    obj.timestamp = new Date().toISOString();
  }
  return JSON.stringify(obj);
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/ingest")) {
      res.writeHead(405).end("method not allowed");
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // basic flood guard
    });

    req.on("end", async () => {
      const forward = normalize(body);
      try {
        const r = await fetch(`${CLOUD_URL}/api/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Ingest-Key": INGEST_KEY,
          },
          body: forward,
        });
        console.log(new Date().toISOString(), req.socket.remoteAddress, "→", r.status, forward);
      } catch (e) {
        // Best-effort: log and still ACK the device (buffering/retry can come later).
        console.error(new Date().toISOString(), "forward failed:", e.message, forward);
      }
      res.writeHead(200).end("ok");
    });
  })
  .listen(PORT, "0.0.0.0", () =>
    console.log(`gateway on 0.0.0.0:${PORT} → ${CLOUD_URL}`)
  );
