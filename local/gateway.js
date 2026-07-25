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
//
// Run:   node --env-file=local/.env local/gateway.js      (Node >= 20.6)
//   or:   CLOUD_URL=... INGEST_KEY=... node local/gateway.js
//
// The device posts to:  http://<gateway-LAN-ip>:8080/ingest

import http from "node:http";

const { CLOUD_URL, INGEST_KEY, PORT = 8080 } = process.env;

if (!CLOUD_URL || !INGEST_KEY) {
  console.error("Missing CLOUD_URL or INGEST_KEY (set them in local/.env).");
  process.exit(1);
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
      try {
        const r = await fetch(`${CLOUD_URL}/api/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Ingest-Key": INGEST_KEY,
          },
          body,
        });
        console.log(new Date().toISOString(), req.socket.remoteAddress, "→", r.status, body);
      } catch (e) {
        // Best-effort: log and still ACK the device (buffering/retry can come later).
        console.error(new Date().toISOString(), "forward failed:", e.message, body);
      }
      res.writeHead(200).end("ok");
    });
  })
  .listen(PORT, "0.0.0.0", () =>
    console.log(`gateway on 0.0.0.0:${PORT} → ${CLOUD_URL}`)
  );
