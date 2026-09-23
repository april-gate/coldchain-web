/**
 * April Gate — devices assigned to a shipment, read from the chain.
 * Cloudflare Pages Function.  Route: GET /api/shipments/<shipmentId>/assignments
 *
 * `assign_device` writes a DeviceAssignment PDA whose `shipment` field sits at
 * byte 40, so one getProgramAccounts with a memcmp on that offset returns
 * exactly the devices bound to this shipment. Nothing app-side is trusted and
 * no database is consulted — the ledger is the source of truth.
 *
 * Layout verified against ../coldchain-programs/programs/device-registry/src/state.rs
 * and confirmed against live devnet accounts (all are exactly 129 bytes):
 *
 *   0..7     Anchor discriminator
 *   8..39    device      Pubkey
 *   40..71   shipment    Pubkey      <- memcmp target
 *   72..75   sequence    u32  LE
 *   76..107  authority   Pubkey
 *   108..115 assigned_at i64  LE
 *   116..123 ended_at    i64  LE
 *   124..127 proof_count u32  LE
 *   128      bump        u8
 *
 * NOTE ON RPC: public devnet blocks Cloudflare's edge IPs (see
 * functions/api/shipments/create.js), so env.SOLANA_RPC_URL should point at a
 * dedicated endpoint in production. The public URL is kept only as the same
 * last-resort default the create route uses.
 */

import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = "APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez";
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const DEVICE_ASSIGNMENT_SIZE = 129;

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function u32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function i64le(b, o) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
  if (v >= 1n << 63n) v -= 1n << 64n;
  return Number(v); // unix seconds — well inside Number's safe range
}
function pk(b, o) {
  return new PublicKey(b.slice(o, o + 32)).toBase58();
}

export async function onRequestGet({ params, env }) {
  const shipmentId = params && params.shipmentId;
  if (!shipmentId) return json({ error: "shipment id is required." }, 400);

  // Reject anything that is not a real address before spending an RPC call.
  try {
    new PublicKey(shipmentId);
  } catch {
    return json({ error: "Not a valid Solana address." }, 400);
  }

  const rpcUrl = (typeof env.SOLANA_RPC_URL === "string" && env.SOLANA_RPC_URL.trim())
    || DEFAULT_RPC_URL;

  let accounts;
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          PROGRAM_ID,
          {
            encoding: "base64",
            filters: [
              { dataSize: DEVICE_ASSIGNMENT_SIZE },
              { memcmp: { offset: 40, bytes: shipmentId } },
            ],
          },
        ],
      }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "getProgramAccounts failed");
    accounts = j.result || [];
  } catch (err) {
    console.error("getProgramAccounts (assignments) failed:", err && err.message);
    return json({ error: "Could not read assignments from Solana: " + (err && err.message ? err.message : String(err)) }, 502);
  }

  let assignments;
  try {
    assignments = accounts.map((a) => {
      const b = b64ToBytes(a.account.data[0]);
      return {
        assignment_pubkey: a.pubkey,
        device_pubkey: pk(b, 8),
        sequence: u32le(b, 72),
        authority: pk(b, 76),
        assigned_at: i64le(b, 108),
        ended_at: i64le(b, 116),
        proof_count: u32le(b, 124),
      };
    });
  } catch (err) {
    console.error("assignment decode failed:", err && err.message);
    return json({ error: "Could not decode assignment accounts." }, 502);
  }

  // Oldest assignment first, so `sequence` reads in order on the page.
  assignments.sort((x, y) => x.assigned_at - y.assigned_at || x.sequence - y.sequence);

  return json({ shipment_id: shipmentId, count: assignments.length, assignments });
}
