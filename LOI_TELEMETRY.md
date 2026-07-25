# LOI verification · telemetry ingest · local gateway

Three features on the existing Cloudflare Pages + D1 stack (binding `WAITLIST_DB`).
Scope is deliberately narrow — no accounts/login, no Solana, no payments.

| Piece | File | Route |
|-------|------|-------|
| LOI capture + magic link | `functions/loi.js` | `POST /loi` |
| Magic-link verify | `functions/loi/verify.js` | `GET /loi/verify?token=…` |
| Telemetry ingest (auth) | `functions/api/ingest.js` | `POST /api/ingest` |
| Telemetry read | `functions/api/readings.js` | `GET /api/readings?shipment_id=…` |
| Dashboard live panel | `public/dashboard.html` | polls `/api/readings` |
| Local device→cloud relay | `local/gateway.js` | runs on your laptop/Pi |

The waitlist form (`public/waitlist.html`) now posts to **`/loi`** (was `/waitlist`).
A submission is **stored and counts as a lead even if unverified** — `email_verified`
just tracks whether they clicked the confirmation link.

## One-time setup

```bash
# 1. Tables (the DB from the waitlist setup already exists)
npx wrangler d1 execute aprilgate-waitlist --file=./schema/loi.sql      --remote
npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings.sql --remote

# 2. Secrets (never committed)
npx wrangler pages secret put RESEND_API_KEY   # enables magic-link + founder email
npx wrangler pages secret put INGEST_KEY       # shared secret for /api/ingest

# 3. Vars — already in wrangler.toml [vars]; adjust as needed:
#    NOTIFY_TO, NOTIFY_FROM (use a Resend-verified aprilgatehq.com sender),
#    PUBLIC_BASE_URL (base for the magic-link URLs)
```

Magic-link email to non-owner addresses needs a **Resend-verified `aprilgatehq.com`**
domain — the `resend.dev` fallback sender only delivers to your own Resend account email.

## Local testing

```bash
# tables into the LOCAL D1
npx wrangler d1 execute aprilgate-waitlist --file=./schema/loi.sql      --local
npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings.sql --local

# INGEST_KEY for local dev (gitignored)
echo 'INGEST_KEY=test-ingest-key' > .dev.vars

npx wrangler pages dev public       # serves Functions + D1 at http://localhost:8788
```

```bash
# LOI: stored unverified, then verify with the token from loi_tokens
curl -X POST localhost:8788/loi -H 'content-type: application/json' \
  -d '{"fullName":"Dana Reyes","email":"dana@acmepharma.com","company":"Acme Pharma","title":"QA Director"}'
#   → open http://localhost:8788/loi/verify?token=<token>  (email_verified flips to 1)

# Ingest: 401 without the key, stored with it
curl -X POST localhost:8788/api/ingest -H 'X-Ingest-Key: test-ingest-key' -H 'content-type: application/json' \
  -d '{"v":1,"device_id":"test-01","shipment_id":"ship-001","proof_count":42,"timestamp":"2026-07-25T14:32:05Z","temp_f":71.6}'
curl 'localhost:8788/api/readings?shipment_id=ship-001'

# Dashboard: open http://localhost:8788/dashboard.html → "LIVE TELEMETRY" panel
#   polls every ~7s and shows the reading within one cycle.
```

## Local gateway (Feature 3)

Lets a plain-HTTP device reach the HTTPS site. Runs on your machine, not Cloudflare.

```bash
cp local/.env.example local/.env     # set CLOUD_URL, INGEST_KEY, PORT
node --env-file=local/.env local/gateway.js
# device posts to  http://<gateway-LAN-ip>:8080/ingest  → forwarded to CLOUD_URL/api/ingest
```

Best-effort: a failed forward is logged but the device still gets `200`.

## Export leads

```bash
npx wrangler d1 execute aprilgate-waitlist --remote --json \
  --command "SELECT created_at, name, email, email_verified, free_email, company, role, intent FROM loi ORDER BY created_at DESC" > loi.json
```

## Security notes
- `/api/ingest` requires `X-Ingest-Key`; a missing/wrong key is `401`.
- Magic-link tokens are single-use, 30-min expiry, `crypto.randomUUID()`.
- No endpoint exposes LOI data publicly; `/api/readings` returns reading fields only.
- Honeypot `website` field on the form: bots that fill it are silently dropped.
