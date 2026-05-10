# coldchain-web

Public website and operator interfaces for [April Gate](https://aprilgatehq.com) — tamper-evident cold chain verification on Solana.

This repository contains the user-facing surface: marketing site, operator dashboard, and shipment verification portal. The on-chain programs live in [coldchain-programs](https://github.com/april-gate/coldchain-programs); the ZK consensus engine lives in [coldchain-core](https://github.com/april-gate/coldchain-core).

## Status

**Hackathon MVP.** Currently static HTML for the public marketing surface. Interactive functionality is being built incrementally:

- [x] Public site (static)
- [ ] Device registration via Phantom wallet (in progress)
- [ ] Shipment creation and assignment dashboard
- [ ] Public shipment verification portal (lookup by program account address)
- [ ] Proof submission interface

## Architecture

The website is a thin client over the on-chain program. Every interactive flow:

1. Connects to the user's Solana wallet (Phantom)
2. Derives the relevant PDA client-side using the same seed structure as the on-chain program
3. Calls the corresponding instruction on `device_registry` (program ID `APRu6WGxe1NC4X2FrcLpujRRtqLNfMTSt6fYp5wQZVtP`)
4. Surfaces the resulting transaction signature and account address as Solscan links

No off-chain database. The on-chain program is the source of truth; the website is just a UI on top of `getAccountInfo` and `getProgramAccounts`.

## Quick start

For the static site, no build step required. Open `index.html` directly:

```bash
open index.html
```

For local development with a live server (recommended once interactive features land):

```bash
npx serve .
# or any other static server: python -m http.server, etc.
```

## Configuration

Interactive flows target Solana devnet:

- **RPC endpoint:** `https://api.devnet.solana.com`
- **Program:** `APRu6WGxe1NC4X2FrcLpujRRtqLNfMTSt6fYp5wQZVtP`

Users need a Phantom wallet with devnet SOL. Devnet airdrop: https://faucet.solana.com

## Related repositories

- [april-gate/coldchain-programs](https://github.com/april-gate/coldchain-programs) — Solana on-chain programs
- [april-gate/coldchain-core](https://github.com/april-gate/coldchain-core) — ZK consensus proof engine

## License

Apache 2.0

---

Built for the [Solana Frontier Hackathon](https://colosseum.com/frontier) — Colosseum, May 2026.
