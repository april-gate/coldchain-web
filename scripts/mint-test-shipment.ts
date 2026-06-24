/**
 * mint-test-shipment.ts — end-to-end devnet demo data.
 *
 * Runs the full lifecycle so you have a real, verifiable shipment to paste into
 * the verify page (and to film for the Loom walkthrough):
 *
 *   register device → create shipment → assign device → submit N proofs
 *
 * Shapes are taken from the real IDL; PDAs are resolved by Anchor from the IDL
 * seed definitions via `.pubkeys()`, so nothing is hardcoded here.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   PROOFS=3 npm run mint
 */

import fs from "fs";
import os from "os";
import { randomBytes } from "crypto";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha256";
import idl from "../src/idl/device_registry.json" assert { type: "json" };

const RPC = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET ?? `${os.homedir()}/.config/solana/id.json`;
const PROOF_COUNT = Number(process.env.PROOFS ?? 3);

function loadWallet(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
const bytes = (n: number): number[] => Array.from(randomBytes(n));
const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const authority = loadWallet(WALLET_PATH);
  const provider = new AnchorProvider(connection, new Wallet(authority), { commitment: "confirmed" });
  const program: any = new Program(idl as Idl, provider); // dev script: loose typing for the resolver/methods builder

  console.log("program  :", program.programId.toBase58());
  console.log("authority:", authority.publicKey.toBase58());
  console.log("rpc      :", RPC, "\n");

  // Fund on devnet if low.
  if ((await connection.getBalance(authority.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    console.log("requesting devnet airdrop (balance low)…");
    try {
      const s = await connection.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(s, "confirmed");
    } catch {
      console.warn("airdrop failed (faucet rate-limited). Pre-fund the wallet and re-run.");
    }
  }

  // 1) register_device(device_id: [u8;32], pubkey: [u8;33])
  const deviceId = bytes(32);
  const devicePubkey = bytes(33);
  devicePubkey[0] = 0x02; // look like a compressed P-256 key (adjust if your program validates the curve)
  const regB = program.methods.registerDevice(deviceId, devicePubkey).accounts({ authority: authority.publicKey });
  const { device } = await regB.pubkeys();
  await regB.rpc();
  console.log("→ registered device :", device!.toBase58());

  // 2) create_shipment(nonce: [u8;32], manifest_commitment: [u8;32])
  const nonce = bytes(32);
  const manifest = Array.from(sha256(new TextEncoder().encode("demo-manifest")));
  const shipB = program.methods.createShipment(nonce, manifest).accounts({ authority: authority.publicKey });
  const { shipment } = await shipB.pubkeys();
  await shipB.rpc();
  console.log("→ created shipment  :", shipment!.toBase58());

  // 3) assign_device — assignment PDA resolved from device + device.assignment_count
  const asgB = program.methods.assignDevice().accounts({ device, shipment, authority: authority.publicKey });
  const { assignment } = await asgB.pubkeys();
  await asgB.rpc();
  console.log("→ assigned          :", assignment!.toBase58());

  // 4) submit_proof(commitment: [u8;32]) — signer is `submitter`
  for (let i = 0; i < PROOF_COUNT; i++) {
    const commitment = Array.from(sha256(new TextEncoder().encode(`reading-${i}-${Date.now()}`)));
    const sig = await program.methods
      .submitProof(commitment)
      .accounts({ assignment, shipment, device, submitter: authority.publicKey })
      .rpc();
    console.log(`→ proof #${i}          :`, explorerTx(sig));
  }

  console.log("\n✅ done.");
  console.log("shipment PDA:", shipment!.toBase58());
  console.log("explorer    :", explorerAddr(shipment!.toBase58()));
  console.log(`\nPaste the PDA into the verify page — expect VALID with ${PROOF_COUNT} proofs.`);
}

main().catch((e) => {
  console.error("\n❌ failed:", e?.message ?? e);
  process.exit(1);
});
