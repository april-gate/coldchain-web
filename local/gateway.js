// April Gate — local gateway (device plain-HTTP → cloud HTTPS relay).
//
// Runs on the developer's laptop/Pi, NOT on Cloudflare. Lets a plain-HTTP device
// (e.g. a Pico) post readings to the LAN while the data still lands on the real
// site over HTTPS. Node >= 18, no external deps (built-in http + global fetch).
//
// Config via local/.env (gitignored) or the shell environment:
//   CLOUD_URL=https://aprilgatehq.com
//   INGEST_KEY=<same shared secret as the /api/ingest INGEST_KEY>
//   SOLANA_RPC_URL=https://api.devnet.solana.com   (required; devnet RPC for /solana)
//   PORT=8080
//   SHIPMENT_ID=ship-001   (optional; default shipment stamped on readings that omit one)
//
// Run:   node --env-file=local/.env local/gateway.js      (Node >= 20.6)
//   or:   CLOUD_URL=... INGEST_KEY=... SOLANA_RPC_URL=... node local/gateway.js
//
// Routes (device posts plain HTTP over the LAN):
//   POST http://<gateway-LAN-ip>:8080/ingest    temperature JSON → CLOUD_URL/api/ingest
//   POST http://<gateway-LAN-ip>:8080/solana    {transaction_b64} → SOLANA_RPC_URL sendTransaction
//   GET  http://<gateway-LAN-ip>:8080/blockhash → {"blockhash":...} fresh devnet blockhash
//   GET  http://<gateway-LAN-ip>:8080/account?pubkey=<b58> → {"exists":bool,"data":<b64>}
//
// The gateway is forgiving about the device payload so a constrained device
// (e.g. a Pico) can send the bare minimum. Before forwarding it will:
//   - rename `device`  -> `device_id`
//   - default `shipment_id` -> SHIPMENT_ID (so /api/ingest's required field is met)
//   - default `timestamp`   -> now (ISO) if the device has no clock
// A device that already sends the full/correct shape is passed through unchanged.

import http from "node:http";

const { CLOUD_URL, INGEST_KEY, SOLANA_RPC_URL, PORT = 8080, SHIPMENT_ID = "ship-001" } = process.env;

// SOLANA_RPC_URL has no default on purpose — the operator picks the endpoint
// (helius / quicknode / plain devnet) via env var.
if (!CLOUD_URL || !INGEST_KEY || !SOLANA_RPC_URL) {
  console.error("Missing CLOUD_URL, INGEST_KEY or SOLANA_RPC_URL (set them in local/.env).");
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

// Relay a device-signed, base64 transaction to the devnet RPC as sendTransaction.
// Courier only: the bytes are never decoded, inspected, or altered — the device's
// on-device signature is what Solana validates. No private key material involved.
function handleSolana(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on("end", async () => {
    let txB64;
    try {
      txB64 = JSON.parse(body).transaction_b64;
    } catch {
      res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    if (typeof txB64 !== "string" || !txB64) {
      res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "missing transaction_b64" }));
      return;
    }

    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [txB64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
    });

    try {
      const r = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rpcBody,
      });
      const text = await r.text();
      // Log a short summary only (never the tx body): bytes, status, signature.
      let sig = "";
      try { const j = JSON.parse(text); if (j && j.result) sig = j.result; } catch {}
      const bytes = Buffer.from(txB64, "base64").length;
      console.log(new Date().toISOString(), req.socket.remoteAddress, "/solana →", r.status,
        `bytes=${bytes}`, sig ? `sig=${sig}` : "");
      // Transparent pass-through: RPC status + body verbatim. A JSON-RPC error
      // rides inside the body with HTTP 200 (Solana's convention); the device parses it.
      res.writeHead(r.status, { "content-type": "application/json" }).end(text);
    } catch (e) {
      // Network/DNS/timeout — the RPC was unreachable. No retry; the device retries.
      console.error(new Date().toISOString(), req.socket.remoteAddress, "/solana rpc unreachable:", e.message);
      res.writeHead(502, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "rpc unreachable", detail: e.message }));
    }
  });
}

// Fetch the latest devnet blockhash for a device to stamp its transaction with.
// Relay only — no key material. Blockhashes expire (~90s) so this is called fresh
// before every device transaction.
function handleBlockhash(req, res) {
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getLatestBlockhash",
    params: [{ commitment: "confirmed" }],
  });
  fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rpcBody,
  })
    .then(async (r) => {
      const text = await r.text();
      let blockhash = "";
      try {
        const j = JSON.parse(text);
        blockhash = j && j.result && j.result.value && j.result.value.blockhash;
      } catch {}
      if (!blockhash) {
        console.error(new Date().toISOString(), req.socket.remoteAddress, "/blockhash → no blockhash", text.slice(0, 200));
        res.writeHead(502, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "no blockhash", detail: text.slice(0, 200) }));
        return;
      }
      // Success body MUST be exactly {"blockhash":"<value>"} — the firmware scans
      // for `blockhash` then reads the next quoted value. Do not wrap/rename.
      console.log(new Date().toISOString(), req.socket.remoteAddress, "/blockhash →", r.status, blockhash);
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ blockhash }));
    })
    .catch((e) => {
      console.error(new Date().toISOString(), req.socket.remoteAddress, "/blockhash rpc unreachable:", e.message);
      res.writeHead(502, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "rpc unreachable", detail: e.message }));
    });
}

// Read-only: fetch a Solana account so a device can learn its own on-chain state
// (register vs assign vs submit_proof). Relay only — no key material.
function handleAccount(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pubkey = url.searchParams.get("pubkey");
  if (!pubkey) {
    res.writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "missing pubkey" }));
    return;
  }
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [pubkey, { encoding: "base64", commitment: "confirmed" }],
  });
  fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rpcBody,
  })
    .then(async (r) => {
      const j = JSON.parse(await r.text());
      const value = j && j.result && j.result.value;
      const exists = !!value;
      // Contract: {"exists":false} OR {"exists":true,"data":"<base64>"} — the
      // device string-scans for "data" then base64-decodes the quoted value.
      const out = exists ? { exists: true, data: value.data[0] } : { exists: false };
      console.log(new Date().toISOString(), req.socket.remoteAddress, "/account →", r.status, `exists=${exists}`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    })
    .catch((e) => {
      console.error(new Date().toISOString(), req.socket.remoteAddress, "/account rpc unreachable:", e.message);
      res.writeHead(502, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "rpc unreachable", detail: e.message }));
    });
}

http
  .createServer((req, res) => {
    // /solana — relay a device-signed transaction to the devnet RPC.
    if (req.method === "POST" && req.url.startsWith("/solana")) {
      handleSolana(req, res);
      return;
    }

    // /blockhash — return a fresh devnet blockhash for the device to sign against.
    if (req.method === "GET" && req.url.startsWith("/blockhash")) {
      handleBlockhash(req, res);
      return;
    }

    // /account — read-only getAccountInfo so a device can learn its own state.
    if (req.method === "GET" && req.url.startsWith("/account")) {
      handleAccount(req, res);
      return;
    }

    // /ingest — temperature telemetry (unchanged).
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
    console.log(`gateway on 0.0.0.0:${PORT} → CLOUD=${CLOUD_URL}  SOLANA=${SOLANA_RPC_URL}`)
  );
