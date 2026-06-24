import { sha256 } from "@noble/hashes/sha256";

/**
 * Hash-chain recomputation — the canonical correctness logic.
 *
 * This file is the ONLY place the chain construction lives. It is deliberately
 * tiny and dependency-light (one audited hash lib) so a skeptic can read it and
 * convince themselves it matches the on-chain program. When the Rust core lands,
 * it compiles to WASM and replaces the two functions below behind this same
 * module boundary — nothing else in the codebase changes.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ MUST MATCH coldchain-programs EXACTLY. If any of these drift from the      │
 * │ on-chain `create_shipment` / `submit_proof` handlers, every verdict is     │
 * │ wrong. Confirm against lib.rs before the demo:                             │
 * │   • genesis domain separator string                                        │
 * │   • genesis preimage order (domain || shipment_pda || created_at_le)       │
 * │   • per-proof preimage order (prev || commitment || sequence_le)           │
 * │   • integer widths (created_at, sequence) and endianness                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const GENESIS_DOMAIN = "april-gate-shipment-genesis-v1";

// Confirmed against coldchain-programs:
//   create_shipment: created_at is i64, folded as `created_at.to_le_bytes()` → 8 bytes LE.
//   submit_proof:    sequence is proof_count (u32), folded as `sequence.to_le_bytes()` → 4 bytes LE.
const CREATED_AT_BYTES = 8;
const SEQUENCE_BYTES = 4;

function u64le(n: bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let v = n;
  for (let i = 0; i < width; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Genesis chain hash, bound to shipment identity:
 *   SHA256( domain || shipment_pda(32) || created_at_le )
 */
export function genesisHash(shipmentPda: Uint8Array, createdAt: bigint): Uint8Array {
  return sha256(
    concat(
      new TextEncoder().encode(GENESIS_DOMAIN),
      shipmentPda,
      u64le(createdAt, CREATED_AT_BYTES)
    )
  );
}

/**
 * One chain step:
 *   SHA256( prevChain(32) || commitment(32) || sequence_le )
 * `sequence` is the proof_count BEFORE increment (first proof = 0).
 */
export function step(prevChain: Uint8Array, commitment: Uint8Array, sequence: bigint): Uint8Array {
  return sha256(concat(prevChain, commitment, u64le(sequence, SEQUENCE_BYTES)));
}

/**
 * Replay the whole chain from genesis over an ordered list of proofs.
 * `proofs` MUST be sorted by ascending sequence before calling.
 */
export function recomputeChain(
  shipmentPda: Uint8Array,
  createdAt: bigint,
  proofs: { commitment: Uint8Array; sequence: bigint }[]
): Uint8Array {
  let chain = genesisHash(shipmentPda, createdAt);
  for (const p of proofs) {
    chain = step(chain, p.commitment, p.sequence);
  }
  return chain;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
