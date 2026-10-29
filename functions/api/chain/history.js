/**
 * April Gate — Verify: a shipment's full transaction history in a few requests.
 * Cloudflare Pages Function.  Route: GET /api/chain/history?address=<shipment PDA>
 *
 * The verify page used to read history from the public devnet RPC: one
 * getSignaturesForAddress page per 1,000 txs, then getTransaction for every
 * signature. Public RPC counts each of those calls against its rate limit, and
 * web3.js backs off on every 429, so large shipments took a long time.
 *
 * Helius' getTransactionsForAddress returns up to 1,000 FULL transactions per
 * call, oldest first, so a shipment's history is ceil(n / 1000) requests. The
 * Helius key lives in env.SOLANA_RPC_URL and must never reach the browser —
 * hence this proxy.
 *
 * This is a convenience, not a trust anchor: the browser still replays the hash
 * chain from these logs and compares it with the chain_hash read from the
 * program-owned Shipment account. A server that dropped or altered a proof would
 * produce a TAMPERED verdict, not a false VALID one.
 *
 * Only accounts owned by the device_registry program are served, so this cannot
 * be used to spend our Helius credits on arbitrary addresses.
 *
 * Response: { ok, transactions: [{ signature, blockTime, logs }] }, oldest first,
 * successful txs only. `logs` holds only "Program data:" lines (Anchor events) —
 * all the verifier decodes.
 *
 * Secret: SOLANA_RPC_URL -> Helius devnet URL (https://devnet.helius-rpc.com/?api-key=…).
 * Any other provider returns 502 here and the browser falls back to public RPC.
 */

const PROGRAM_ID = "APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez";
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PAGE_LIMIT = 1000;
// 40 pages = 40,000 txs, well under the Workers subrequest limit. A shipment
// that outgrows this needs an indexer, not a longer loop.
const MAX_PAGES = 40;

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });

async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

export async function onRequestGet({ request, env }) {
  const address = new URL(request.url).searchParams.get("address") || "";
  if (!BASE58_ADDRESS.test(address)) return json({ ok: false, error: "Not a valid address." }, 400);
  if (!env.SOLANA_RPC_URL) return json({ ok: false, error: "History source not configured." }, 503);

  try {
    const info = await rpc(env.SOLANA_RPC_URL, "getAccountInfo", [
      address,
      { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } },
    ]);
    if (!info || !info.value) return json({ ok: false, error: "No shipment at this address." }, 404);
    if (info.value.owner !== PROGRAM_ID) {
      return json({ ok: false, error: "Not an April Gate shipment." }, 404);
    }

    const transactions = [];
    let paginationToken = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await rpc(env.SOLANA_RPC_URL, "getTransactionsForAddress", [
        address,
        {
          transactionDetails: "full",
          sortOrder: "asc",
          limit: PAGE_LIMIT,
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
          filters: { status: "succeeded" },
          ...(paginationToken && { paginationToken }),
        },
      ]);
      for (const tx of result?.data ?? []) {
        transactions.push({
          signature: tx.transaction?.signatures?.[0] ?? null,
          blockTime: tx.blockTime ?? null,
          logs: (tx.meta?.logMessages ?? []).filter((l) => l.startsWith("Program data: ")),
        });
      }
      paginationToken = result?.paginationToken ?? null;
      if (!paginationToken) break;
    }
    if (paginationToken) {
      return json({ ok: false, error: "History too large to serve in one response." }, 413);
    }

    // Short browser cache: repeated Verify clicks cost one Helius read, while
    // new proofs still show up within seconds.
    return json({ ok: true, transactions }, 200, "public, max-age=15");
  } catch (err) {
    console.error("chain history failed:", err && err.message);
    return json({ ok: false, error: "Could not read chain history." }, 502);
  }
}
