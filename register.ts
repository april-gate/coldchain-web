import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { makeReadOnlyProgram } from "../verifier/solana";
import { devicePda } from "../verifier/pdas";

/**
 * Device registration — WALLET-SIGNED.
 *
 * The operator connects a wallet (Phantom/Solflare) and that wallet signs the
 * register_device transaction. This site NEVER holds, sees, or embeds a private
 * key. The connected wallet must be one your program authorizes to register
 * devices (your program authority).
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ TO MAKE THIS LIVE, confirm against coldchain-programs register_device:   │
 * │   • instruction name (registerDevice?) and argument list                 │
 * │   • the accounts it expects and their names                              │
 * │ Drop your real IDL into src/idl/device_registry.json and adjust the      │
 * │ .methods / .accounts call below to match it.                             │
 * └────────────────────────────────────────────────────────────────────────┘
 */

const DEFAULT_RPC = "https://api.devnet.solana.com";
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

interface WalletProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}

function getWallet(): WalletProvider {
  const w = window as any;
  const provider = w.solana ?? w.phantom?.solana;
  if (!provider) {
    throw new Error("No Solana wallet found. Install Phantom or Solflare, then try again.");
  }
  return provider as WalletProvider;
}

export interface RegisterResult {
  signature: string;
  device: string; // device PDA, base58
}

/**
 * Register a device on-chain. Prompts the operator's wallet to sign.
 *
 * @param deviceId        your off-chain device identifier (used in the PDA seed)
 * @param devicePubkey    the device's signing pubkey bytes (e.g. secure-element P-256)
 */
export async function registerDevice(
  deviceId: string,
  devicePubkey: Uint8Array,
  opts: { rpcUrl?: string } = {}
): Promise<RegisterResult> {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC;
  const wallet = getWallet();

  // Operator authenticates by connecting. Their pubkey becomes the authority.
  const { publicKey: authority } = await wallet.connect();

  const connection = new Connection(rpcUrl, "confirmed");
  const program = makeReadOnlyProgram(rpcUrl); // read-only: used only to build the ix
  const device = devicePda(deviceId);

  // ⚠️ CONFIRM names/args against your IDL.
  const ix = await (program as any).methods
    .registerDevice(deviceId, Array.from(devicePubkey))
    .accounts({
      device,
      authority,
      systemProgram: SYSTEM_PROGRAM,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = authority;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // The wallet signs and submits. No key material touches this code.
  const { signature } = await wallet.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");

  return { signature, device: device.toBase58() };
}
