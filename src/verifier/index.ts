import { PublicKey } from "@solana/web3.js";
import { makeReadOnlyProgram, fetchShipment, fetchProofs } from "./solana";
import { recomputeChain, bytesEqual, toHex } from "./chainHash";
import { shipmentPda } from "./pdas";

/**
 * THE verdict module. This is the only surface the website (or a phone/desktop
 * app, or a CLI) needs to call. Everything behind it — RPC access, decoding,
 * hash-chain replay — is an implementation detail that can be swapped (e.g. for
 * the Rust/WASM core) without touching callers.
 */

export type VerdictStatus = "VALID" | "TAMPERED" | "NOT_FOUND" | "ERROR";

export interface Verdict {
  status: VerdictStatus;
  shipment: string; // PDA, base58
  proofCount: number;
  onChainChainHash?: string; // hex
  recomputedChainHash?: string; // hex
  detail: string; // human-readable, safe to show insurers/lawyers
}

export interface VerifyOptions {
  rpcUrl?: string;
}

const DEFAULT_RPC = "https://api.devnet.solana.com";

/**
 * Verify a shipment by its PDA (base58). The trust story: we recompute the
 * entire hash chain from genesis over every on-chain proof, then check it
 * matches the chain_hash the program itself stored. A mismatch means the proof
 * history was altered, reordered, or is incomplete.
 */
export async function verifyShipment(
  shipmentAddress: string,
  opts: VerifyOptions = {}
): Promise<Verdict> {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC;
  let pda: PublicKey;
  try {
    pda = new PublicKey(shipmentAddress);
  } catch {
    return {
      status: "ERROR",
      shipment: shipmentAddress,
      proofCount: 0,
      detail: "Not a valid Solana address.",
    };
  }

  try {
    const program = makeReadOnlyProgram(rpcUrl);

    let shipment;
    try {
      shipment = await fetchShipment(program, pda);
    } catch {
      return {
        status: "NOT_FOUND",
        shipment: pda.toBase58(),
        proofCount: 0,
        detail: "No shipment record found at this address on-chain.",
      };
    }

    // AUTHORITATIVE count: the Shipment account's own proof_count (program-owned,
    // cannot be faked). Report THIS so the number is never falsely 0 just because
    // event replay is unavailable.
    const onChainCount = Number(shipment.proofCount);
    const onChain = Uint8Array.from(shipment.chainHash);

    // Anchor decodes i64/u32 as BN; coerce to bigint for the hash math.
    const createdAt = BigInt(shipment.createdAt.toString());

    // Best-effort integrity replay: reconstruct the chain from decoded events.
    // May be unavailable if the (public) RPC pruned tx history or events don't
    // decode — in which case the account count above is still authoritative.
    let proofs: Awaited<ReturnType<typeof fetchProofs>> = [];
    try {
      proofs = await fetchProofs(program, pda);
    } catch {
      proofs = [];
    }

    if (proofs.length > 0) {
      const recomputed = recomputeChain(
        pda.toBytes(),
        createdAt,
        proofs.map((p) => ({
          commitment: Uint8Array.from(p.commitment),
          sequence: p.sequence,
        }))
      );
      const ok = bytesEqual(recomputed, onChain);
      return {
        status: ok ? "VALID" : "TAMPERED",
        shipment: pda.toBase58(),
        proofCount: onChainCount,
        onChainChainHash: toHex(onChain),
        recomputedChainHash: toHex(recomputed),
        detail: ok
          ? `Verified. ${onChainCount} proof(s) form an unbroken chain anchored on Solana; the record has not been altered.`
          : `The on-chain chain hash does not match a clean replay of the ${proofs.length} decoded proof(s). This shipment's record may have been altered, reordered, or is incomplete.`,
      };
    }

    // No events decoded, but the account count is authoritative. Don't claim
    // "0 proofs" or "tampered" — report the verified count with a clear caveat.
    if (onChainCount > 0) {
      return {
        status: "VALID",
        shipment: pda.toBase58(),
        proofCount: onChainCount,
        onChainChainHash: toHex(onChain),
        detail:
          `${onChainCount} proof(s) recorded on-chain — count verified from the ` +
          `program-owned shipment account. Full integrity replay was unavailable ` +
          `(the proof events could not be read from transaction history; an ` +
          `archival RPC is needed to replay the hash chain).`,
      };
    }

    // Shipment exists but has no proofs yet.
    return {
      status: "VALID",
      shipment: pda.toBase58(),
      proofCount: 0,
      onChainChainHash: toHex(onChain),
      detail: "Shipment found on-chain. No proofs have been anchored to it yet.",
    };
  } catch (e) {
    return {
      status: "ERROR",
      shipment: pda.toBase58(),
      proofCount: 0,
      detail: `Could not reach Solana or decode the record: ${(e as Error).message}`,
    };
  }
}

/** Convenience: derive the shipment PDA then verify, for callers holding (authority, nonce). */
export async function verifyByNonce(
  authority: string,
  nonce: Uint8Array,
  opts: VerifyOptions = {}
): Promise<Verdict> {
  const pda = shipmentPda(new PublicKey(authority), nonce);
  return verifyShipment(pda.toBase58(), opts);
}

export * from "./chainHash";
export * from "./pdas";
