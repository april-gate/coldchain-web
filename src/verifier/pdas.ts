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

/** Shipment PDA — derived from authority + 32-byte nonce. */
export function shipmentPda(authority: PublicKey, nonce: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shipment"), authority.toBuffer(), Buffer.from(nonce)],
    PROGRAM_ID
  );
  return pda;
}

/** Device PDA — derived from device_id. */
export function devicePda(deviceId: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("device"), Buffer.from(deviceId)],
    PROGRAM_ID
  );
  return pda;
}

/** Assignment (shipment-device) PDA. */
export function assignmentPda(shipment: PublicKey, device: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("assignment"), shipment.toBuffer(), device.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}
