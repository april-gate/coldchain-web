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
 * All proofs for a shipment, fetched by memcmp on the `shipment` field, then
 * sorted by ascending sequence so the chain can be replayed in order.
 *
 * ⚠️ CONFIRM the memcmp offset against your Proof account layout: it is
 * 8 (discriminator) + the byte offset of the `shipment` Pubkey field.
 * Assumes `shipment` is the first field → offset 8.
 */
export async function fetchProofs(
  program: Program,
  shipment: PublicKey
): Promise<ProofAccount[]> {
  const accounts = await (program.account as any).proof.all([
    { memcmp: { offset: 8, bytes: shipment.toBase58() } },
  ]);
  const proofs: ProofAccount[] = accounts.map(
    (a: any) => a.account as ProofAccount
  );
  proofs.sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  return proofs;
}
