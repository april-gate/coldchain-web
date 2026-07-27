/**
 * April Gate — Operator Portal: create a shipment.
 * Cloudflare Pages Function.  Route: POST /api/shipments/create
 *
 * Signs and sends a Solana `create_shipment` transaction with a CUSTODIAL
 * devnet keypair (Wrangler secret), then stores the human-readable metadata in
 * D1 keyed by the on-chain shipment PDA.
 *
 * On-chain (device_registry, program APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez):
 *   create_shipment(nonce: [u8;32], manifest_commitment: [u8;32])
 *   accounts: [shipment (PDA, init), authority (signer+payer), system_program]
 *   PDA seeds: ["shipment", authority, nonce]
 * The instruction is hand-rolled (discriminator + two 32-byte args) rather than
 * via the Anchor client, which pulls Node-only APIs the Workers runtime lacks.
 * web3.js is used only for offline tx assembly/signing; RPC is raw fetch.
 *
 * Bindings / secrets:
 *   D1 binding  WAITLIST_DB               -> shipments table (schema/shipments.sql)
 *   secret      APRILGATE_DEVNET_KEYPAIR  -> JSON array of 64 bytes (solana-keygen output)
 */

import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

const PROGRAM_ID = new PublicKey("APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const CREATE_SHIPMENT_DISCRIMINATOR = Uint8Array.from([67, 64, 17, 114, 30, 143, 249, 247]);
// Public devnet RPC blocks Cloudflare's edge IPs, so a dedicated endpoint
// (env.SOLANA_RPC_URL — Helius/QuickNode/Alchemy devnet) is required in prod.
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const TIER_MIN_DEVICES = { Essential: 1, Assured: 4, Fortified: 4 };

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function clean(v, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 200);
  }

  // ── Validate mandatory fields (mirror the client) ──
  const name = clean(data.name, 100);
  const tier = clean(data.tier, 20);
  if (!name) return json({ ok: false, error: "Shipment name is required." }, 200);
  if (!TIER_MIN_DEVICES[tier]) {
    return json({ ok: false, error: "Tier must be Essential, Assured, or Fortified." }, 200);
  }
  const tempMin = data.temp_c_min == null || data.temp_c_min === "" ? null : Number(data.temp_c_min);
  const tempMax = data.temp_c_max == null || data.temp_c_max === "" ? null : Number(data.temp_c_max);
  if (tempMin === null || tempMax === null || Number.isNaN(tempMin) || Number.isNaN(tempMax)) {
    return json({ ok: false, error: "A valid temperature range (°C) is required." }, 200);
  }
  if (tempMin > tempMax) {
    return json({ ok: false, error: "Temperature min cannot exceed max." }, 200);
  }
  const numDevices = parseInt(data.num_devices, 10);
  if (!Number.isInteger(numDevices) || numDevices < 1) {
    return json({ ok: false, error: "Number of devices must be a positive integer." }, 200);
  }
  if (numDevices < TIER_MIN_DEVICES[tier]) {
    return json({ ok: false, error: "Assured and Fortified tiers require a minimum of 4 devices." }, 200);
  }
  const durationDays = parseInt(data.duration_days, 10);
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    return json({ ok: false, error: "Duration must be at least 1 day." }, 200);
  }

  const origin = clean(data.origin, 200);
  const destination = clean(data.destination, 200);
  const notes = clean(data.notes, 2000);

  if (!env.APRILGATE_DEVNET_KEYPAIR) {
    return json({ ok: false, error: "Custodial wallet not configured (APRILGATE_DEVNET_KEYPAIR)." }, 200);
  }
  if (!env.WAITLIST_DB) {
    return json({ ok: false, error: "Storage not configured." }, 200);
  }

  // ── Build the on-chain shipment ──
  const rpcUrl = clean(env.SOLANA_RPC_URL) || DEFAULT_RPC_URL;

  let shipmentId, signature, nonce, commitment, authorityB58;
  let step = "start";
  try {
    console.log("[create] step: load keypair");
    step = "load-keypair";
    const secret = Uint8Array.from(JSON.parse(env.APRILGATE_DEVNET_KEYPAIR));
    const authority = Keypair.fromSecretKey(secret);
    authorityB58 = authority.publicKey.toBase58();
    console.log("[create] authority", authorityB58);

    // nonce: 32 unguessable bytes.  manifest_commitment: sha256 of the manifest.
    nonce = crypto.getRandomValues(new Uint8Array(32));
    const manifest = JSON.stringify({
      name, tier, temp_c_min: tempMin, temp_c_max: tempMax,
      num_devices: numDevices, duration_days: durationDays,
      origin, destination, notes,
    });
    commitment = sha256(new TextEncoder().encode(manifest)); // Uint8Array(32)

    console.log("[create] step: derive PDA");
    step = "derive-pda";
    const [shipmentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("shipment"), authority.publicKey.toBuffer(), Buffer.from(nonce)],
      PROGRAM_ID
    );
    shipmentId = shipmentPda.toBase58();
    console.log("[create] pda", shipmentId);

    // instruction data = discriminator ‖ nonce ‖ manifest_commitment
    const ixData = new Uint8Array(8 + 32 + 32);
    ixData.set(CREATE_SHIPMENT_DISCRIMINATOR, 0);
    ixData.set(nonce, 8);
    ixData.set(commitment, 40);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shipmentPda, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(ixData),
    });

    console.log("[create] step: getLatestBlockhash");
    step = "blockhash";
    const { blockhash } = (await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;
    const tx = new Transaction();
    tx.add(ix);
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = blockhash;

    console.log("[create] step: sign");
    step = "sign";
    tx.sign(authority); // tweetnacl (pure JS)

    console.log("[create] step: serialize + send");
    step = "send";
    const rawB64 = Buffer.from(tx.serialize()).toString("base64");
    signature = await rpc(rpcUrl, "sendTransaction", [
      rawB64,
      { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
    ]);
    console.log("[create] sent", signature);
  } catch (err) {
    // Surface the real Solana/RPC error — the operator needs to see it.
    // NOTE: status 200 on purpose. Cloudflare replaces a 5xx *body* with its own
    // HTML error page, which would hide this JSON from the client. The client
    // keys off `ok`, not the HTTP status.
    console.error("create_shipment failed at step", step, ":", err && err.message);
    return json({
      ok: false,
      step,
      error: `On-chain create_shipment failed (${step}): ` + (err && err.message ? err.message : String(err)),
      rpc_url_configured: !!(env.SOLANA_RPC_URL),
      shipment: { name, tier, temp_c_min: tempMin, temp_c_max: tempMax, num_devices: numDevices, duration_days: durationDays, origin, destination, notes },
    }, 200);
  }

  // ── Store metadata (keyed by the PDA). Chain write already succeeded; a
  //    metadata failure shouldn't hide a real shipment_id from the operator. ──
  try {
    await env.WAITLIST_DB.prepare(
      `INSERT INTO shipments
         (shipment_id, name, tier, temp_c_min, temp_c_max, num_devices, duration_days,
          origin, destination, notes, nonce_hex, manifest_commitment_hex, create_sig,
          authority, network, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'devnet', datetime('now'))`
    )
      .bind(
        shipmentId, name, tier, tempMin, tempMax, numDevices, durationDays,
        origin, destination, notes, toHex(nonce), toHex(commitment), signature, authorityB58
      )
      .run();
  } catch (err) {
    console.error("D1 insert (shipments) failed:", err && err.message);
    return json({
      ok: true,
      warning: "Shipment created on-chain but metadata was not saved: " + (err && err.message),
      shipment_id: shipmentId,
      solscan_url: `https://solscan.io/tx/${signature}?cluster=devnet`,
      network: "devnet",
    });
  }

  return json({
    ok: true,
    shipment_id: shipmentId,
    solscan_url: `https://solscan.io/tx/${signature}?cluster=devnet`,
    network: "devnet",
  });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
