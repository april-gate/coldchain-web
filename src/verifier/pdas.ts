import { PublicKey } from "@solana/web3.js";

/**
 * PDA derivation. Seeds MUST match coldchain-programs (device_registry).
 *
 * ⚠️ CONFIRM the seed byte-strings and ordering against your lib.rs
 * #[account(seeds = [...])] attributes. These are the conventional guesses
 * based on the program shape we discussed; verify before the demo.
 */

// device_registry program id (from the deploy keypair).
export const PROGRAM_ID = new PublicKey(
  "APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez"
);

/** Shipment PDA — seeds ["shipment", authority, nonce_32]. (already correct) */
export function shipmentPda(authority: PublicKey, nonce: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shipment"), authority.toBuffer(), Buffer.from(nonce)],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Device PDA — seeds ["device", device_id] where device_id is the raw 32 bytes
 * (ATECC608 serial in [0..9], rest zero) — NOT the human string like "pico-01".
 */
export function devicePda(deviceId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("device"), Buffer.from(deviceId)],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Assignment PDA — seeds ["assignment", device_pubkey, sequence_u32_le] where
 * `sequence` is the device's assignment_count (u32, 4 bytes little-endian) at
 * assignment time.
 */
export function assignmentPda(device: PublicKey, sequence: number): PublicKey {
  const seq = Buffer.alloc(4);
  seq.writeUInt32LE(sequence, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("assignment"), device.toBuffer(), seq],
    PROGRAM_ID
  );
  return pda;
}
