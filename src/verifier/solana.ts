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

/**
 * Reconstruct the ordered commitment sequence for a shipment.
 *
 * submit_proof does NOT store proofs as accounts — it rolls `chain_hash` forward
 * and emits a `ProofSubmitted { sequence, commitment, chain_hash_after }` event.
 * So we enumerate every transaction that touched the shipment PDA, decode the
 * ProofSubmitted events from their logs, and order them by `sequence`. The
 * ledger itself is the source of truth; nothing app-side is trusted.
 *
 * NOTE ON RPC: this reads transaction history, which public RPC prunes over
 * time. Fine for a fresh demo shipment on public devnet; production needs a
 * dedicated/archival RPC. Requires the real IDL (with the ProofSubmitted event)
 * for the event coder to decode. Transactions are fetched in batches to keep
 * round-trips low.
 */
export async function fetchProofs(
  program: Program,
  shipment: PublicKey
): Promise<ProofAccount[]> {
  const connection = program.provider.connection;

  // 1) ALL signatures that touched the shipment PDA, paginated, oldest-last.
  //    We must collect every proof — capping the limit (e.g. 10) would drop
  //    older proofs and make the chain replay come up short, i.e. a false
  //    "tampered". Page size is large; we still page to catch big histories.
  const sigs: string[] = [];
  let before: string | undefined = undefined;
  for (let page = 0; page < 50; page++) {
    const batch = await connection.getSignaturesForAddress(
      shipment,
      { before, limit: 1000 },
      "confirmed"
    );
    if (batch.length === 0) break;
    for (const s of batch) if (!s.err) sigs.push(s.signature);
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) break;
  }
  sigs.reverse(); // chronological

  // 2) Batch-fetch the transactions (one round-trip per chunk, not per tx),
  //    then decode ProofSubmitted events from their logs.
  const coder = (program as any).coder.events;
  const proofs: ProofAccount[] = [];
  const CHUNK = 100; // keep batch JSON-RPC requests RPC-provider-friendly
  for (let i = 0; i < sigs.length; i += CHUNK) {
    const txs = await connection.getTransactions(sigs.slice(i, i + CHUNK), {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    for (const tx of txs) {
      const logs = tx?.meta?.logMessages ?? [];
      for (const line of logs) {
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
        });
      }
    }
  }

  // 3) Order by sequence; the chain must be replayed first-to-last.
  proofs.sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  return proofs;
}
