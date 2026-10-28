import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import idl from "../idl/device_registry.json";
import { PROGRAM_ID } from "./pdas";

/**
 * Read-only Solana access. We decode accounts via the program IDL rather than
 * hand-maintained byte offsets, so the layout can never silently drift from the
 * on-chain program. Drop your real IDL into src/idl/device_registry.json
 * (anchor build emits it at target/idl/device_registry.json).
 */

export interface ShipmentAccount {
  authority: PublicKey;
  chainHash: number[]; // [u8; 32]
  proofCount: bigint; // u64
  createdAt: bigint; // i64 / u64 unix ts
  lastCommitment: number[];
}

export interface ProofAccount {
  shipment: PublicKey;
  commitment: number[]; // [u8; 32]
  sequence: bigint; // u64
  blockTime: number | null; // unix seconds of the submit_proof tx, if the RPC has it
}

export function makeReadOnlyProgram(rpcUrl: string): Program {
  const connection = new Connection(rpcUrl, "confirmed");
  // Read-only: a throwaway provider with a dummy wallet. We never sign anything.
  const provider = new AnchorProvider(
    connection,
    { publicKey: PublicKey.default } as any,
    { commitment: "confirmed" }
  );
  // Anchor 0.30+: program id comes from idl.address; constructor is (idl, provider).
  return new Program(idl as Idl, provider);
}

export async function fetchShipment(
  program: Program,
  pda: PublicKey
): Promise<ShipmentAccount> {
  // account name must match the IDL (camelCased): adjust if yours differs.
  // Cast through `any` because the placeholder IDL isn't statically typed;
  // with your real generated IDL types this can be tightened.
  return (await (program.account as any).shipment.fetch(pda)) as ShipmentAccount;
}

/** One successful transaction that touched the shipment PDA. */
export interface ChainTx {
  signature: string | null;
  blockTime: number | null; // unix seconds
  logs: string[]; // at least every "Program data:" line
}

export interface ChainHistory {
  txs: ChainTx[]; // oldest first
  source: "proxy" | "rpc";
}

/**
 * Every successful transaction that touched the shipment PDA, oldest first.
 *
 * Preferred: `historyUrl` (functions/api/chain/history.js), which reads Helius'
 * getTransactionsForAddress — up to 1,000 full txs per call, key kept server-side.
 * Fallback: standard RPC, i.e. paginated getSignaturesForAddress plus batched
 * getTransactions. On public devnet the fallback is slow for big shipments: each
 * call inside a batch counts toward the rate limit, and web3.js backs off on 429.
 *
 * NOTE ON RPC: transaction history is pruned by public RPC over time; production
 * needs the proxy (or another archival RPC).
 */
export async function fetchHistory(
  connection: Connection,
  shipment: PublicKey,
  historyUrl?: string
): Promise<ChainHistory> {
  if (historyUrl) {
    try {
      const sep = historyUrl.includes("?") ? "&" : "?";
      const res = await fetch(`${historyUrl}${sep}address=${shipment.toBase58()}`);
      const body = await res.json();
      if (res.ok && body?.ok && Array.isArray(body.transactions)) {
        return { txs: body.transactions as ChainTx[], source: "proxy" };
      }
    } catch {
      // fall through to standard RPC
    }
  }

  // 1) ALL signatures that touched the shipment PDA, paginated, newest-first.
  //    We must collect every proof — capping the limit (e.g. 10) would drop
  //    older proofs and make the chain replay come up short, i.e. a false
  //    "tampered". Page size is large; we still page to catch big histories.
  const sigs: { signature: string; blockTime: number | null }[] = [];
  let before: string | undefined = undefined;
  for (let page = 0; page < 50; page++) {
    const batch = await connection.getSignaturesForAddress(
      shipment,
      { before, limit: 1000 },
      "confirmed"
    );
    if (batch.length === 0) break;
    for (const s of batch) if (!s.err) sigs.push({ signature: s.signature, blockTime: s.blockTime ?? null });
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) break;
  }
  sigs.reverse(); // chronological

  // 2) Batch-fetch the transactions (one round-trip per chunk, not per tx).
  const txs: ChainTx[] = [];
  const CHUNK = 100; // keep batch JSON-RPC requests RPC-provider-friendly
  for (let i = 0; i < sigs.length; i += CHUNK) {
    const chunk = sigs.slice(i, i + CHUNK);
    const res = await connection.getTransactions(
      chunk.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    res.forEach((tx, j) =>
      txs.push({
        signature: chunk[j].signature,
        blockTime: tx?.blockTime ?? chunk[j].blockTime,
        logs: tx?.meta?.logMessages ?? [],
      })
    );
  }
  return { txs, source: "rpc" };
}

/**
 * Reconstruct the ordered commitment sequence for a shipment.
 *
 * submit_proof does NOT store proofs as accounts — it rolls `chain_hash` forward
 * and emits a `ProofSubmitted { sequence, commitment, chain_hash_after }` event.
 * So we decode the ProofSubmitted events from the logs of every transaction that
 * touched the shipment PDA, and order them by `sequence`. The ledger itself is
 * the source of truth; nothing app-side is trusted. Requires the real IDL (with
 * the ProofSubmitted event) for the event coder to decode.
 */
export function decodeProofs(
  program: Program,
  shipment: PublicKey,
  txs: ChainTx[]
): ProofAccount[] {
  const coder = (program as any).coder.events;
  const proofs: ProofAccount[] = [];
  for (const tx of txs) {
    for (const line of tx.logs) {
      const m = line.match(/^Program data: (.+)$/);
      if (!m) continue;
      let ev: any;
      try {
        ev = coder.decode(m[1]);
      } catch {
        continue;
      }
      if (!ev || String(ev.name).toLowerCase() !== "proofsubmitted") continue;
      proofs.push({
        shipment,
        commitment: Array.from(ev.data.commitment as ArrayLike<number>),
        sequence: BigInt(ev.data.sequence.toString()),
        blockTime: tx.blockTime,
      });
    }
  }

  // Order by sequence; the chain must be replayed first-to-last.
  proofs.sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  return proofs;
}

/** History + decode in one step (standard RPC unless a historyUrl is given). */
export async function fetchProofs(
  program: Program,
  shipment: PublicKey,
  historyUrl?: string
): Promise<ProofAccount[]> {
  const { txs } = await fetchHistory(program.provider.connection, shipment, historyUrl);
  return decodeProofs(program, shipment, txs);
}
