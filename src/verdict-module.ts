import { PublicKey } from "@solana/web3.js";
import { makeReadOnlyProgram, fetchShipment, fetchProofs } from "./verifier/solana";
import { recomputeChain, bytesEqual, toHex } from "./verifier/chainHash";
import { shipmentPda } from "./verifier/pdas";

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

    const proofs = await fetchProofs(program, pda);

    const recomputed = recomputeChain(
      pda.toBytes(),
      shipment.createdAt,
      proofs.map((p) => ({
        commitment: Uint8Array.from(p.commitment),
        sequence: p.sequence,
      }))
    );

    const onChain = Uint8Array.from(shipment.chainHash);
    const ok = bytesEqual(recomputed, onChain);

    return {
      status: ok ? "VALID" : "TAMPERED",
      shipment: pda.toBase58(),
      proofCount: proofs.length,
      onChainChainHash: toHex(onChain),
      recomputedChainHash: toHex(recomputed),
      detail: ok
        ? `Verified. ${proofs.length} proof(s) form an unbroken chain anchored on Solana; the record has not been altered.`
        : "The on-chain chain hash does not match a clean replay of the proof history. This shipment's record may have been altered, reordered, or is incomplete.",
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

export * from "./verifier/chainHash";
export * from "./verifier/pdas";
