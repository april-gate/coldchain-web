# Operator Portal — setup (maintainer)

The Operator Portal signs a real Solana `create_shipment` transaction on **devnet**
using a **custodial wallet** and stores human-readable metadata in **D1**.

Stack: Cloudflare Pages (static HTML) + Pages Functions (the "Worker routes") + D1.
No auth, no framework — the "Sign In" button is intentionally disabled.

## Cloudflare secrets (never commit these)

```bash
# 1. Custodial devnet keypair (ALREADY DONE by the maintainer)
solana-keygen new -o /tmp/aprilgate-devnet.json --no-bip39-passphrase
solana airdrop 5 <pubkey> --url devnet          # repeat until ~10 SOL
cat /tmp/aprilgate-devnet.json | npx wrangler pages secret put APRILGATE_DEVNET_KEYPAIR --project-name aprilgate

# 2. Dedicated devnet RPC  ← REQUIRED. The public RPC (api.devnet.solana.com)
#    BLOCKS Cloudflare's edge IPs, so create_shipment fails without this.
#    Get a free devnet URL from Helius / QuickNode / Alchemy, then:
npx wrangler pages secret put SOLANA_RPC_URL --project-name aprilgate
#    (paste e.g. https://devnet.helius-rpc.com/?api-key=...)
```

- Never log the keypair, never expose it via any endpoint. It is read only inside
  `functions/api/shipments/create.js`.
- The custodial wallet is the shipment `authority`/fee-payer (the program's
  `create_shipment` is permissionless — any signer may create a shipment).

## D1 tables

One database `aprilgate-waitlist` (binding `WAITLIST_DB`) holds the operator table:

```bash
npx wrangler d1 execute aprilgate-waitlist --file=./schema/shipments.sql --remote
# local dev:  add --local instead of --remote
```

`wrangler.toml` also sets `compatibility_flags = ["nodejs_compat"]` — required so
`@solana/web3.js` has `Buffer` in the Workers runtime.

## Routes

| Route | File | Purpose |
|-------|------|---------|
| `POST /api/shipments/create` | `functions/api/shipments/create.js` | Sign+send `create_shipment`, store metadata, return `{shipment_id, solscan_url, network}` |
| `GET /api/shipments/list` | `functions/api/shipments/list.js` | Portal list |
| `GET /api/shipments/get?id=` | `functions/api/shipments/get.js` | Detail metadata |
| `/operator/` | `public/operator/index.html` | Landing + list |
| `/operator/new-shipment` | `public/operator/new-shipment.html` | Create form |
| `/operator/shipment/<id>` | `functions/operator/shipment/[id].js` → `shipment.html` | Detail |
| `/verify/<id>` | `functions/verify/[id].js` → `verify.html` | QR-friendly verify (same page as typed input) |

The `/…/<id>` pretty URLs are served by **Pages Functions**, not `_redirects`
rewrites — Pages' clean-URL handling strips the trailing id from a static rewrite.

## On-chain reference

Program `device_registry` = `APRBVwwJJeStD5wShyg4HivneDYj4TCPYKtSFX5F4jez` (devnet).
`create_shipment(nonce:[u8;32], manifest_commitment:[u8;32])`, accounts
`[shipment(PDA), authority(signer), system_program]`, PDA seeds `["shipment", authority, nonce]`.
`manifest_commitment` = `sha256` of the shipment manifest JSON; `nonce` = 32 random bytes.
The instruction is hand-rolled from the IDL discriminator (Anchor client pulls
Node-only APIs the Workers runtime lacks).

## Deploy

```bash
npx wrangler pages deploy public --project-name aprilgate --branch main
```
(This is a Direct-Upload Pages project; a git push does NOT deploy.)
