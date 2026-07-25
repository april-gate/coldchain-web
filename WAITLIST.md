# Design-partner waitlist — setup

The waitlist page (`public/waitlist.html`) posts signups to a Cloudflare Pages
Function (`functions/waitlist.js`) that stores each one — all form fields plus a
server timestamp — in a **D1** database the founders can query and export.

## What's already in the repo

| File | Purpose |
|------|---------|
| `public/waitlist.html` | The page + form (design matches the site). |
| `functions/waitlist.js` | `POST /waitlist` → validate → insert into D1 (+ optional email). |
| `schema.sql` | The `signups` table. |
| `wrangler.toml` | Declares the `WAITLIST_DB` D1 binding + build output dir. |

Nav on every page has a prominent **★ Join the Waitlist** button; the home hero's
primary button links here too.

## One-time backend setup (~5 min)

```bash
# 1. Create the D1 database
wrangler d1 create aprilgate-waitlist
#    → copy the printed database_id into wrangler.toml (database_id = "…")

# 2. Create the table (remote = the deployed DB)
wrangler d1 execute aprilgate-waitlist --file=./schema.sql --remote

# 3. Deploy (Git push triggers the Pages build, or:)
wrangler pages deploy public
```

If you'd rather not use `wrangler.toml`, delete it and instead add the D1 binding
in the dashboard: **Pages project → Settings → Functions → D1 database bindings**,
variable name `WAITLIST_DB`, database `aprilgate-waitlist`.

## Seeing / exporting signups

```bash
# Count
wrangler d1 execute aprilgate-waitlist --remote \
  --command "SELECT COUNT(*) FROM signups"

# Newest first
wrangler d1 execute aprilgate-waitlist --remote \
  --command "SELECT created_at, full_name, email, company, facility_type, headache FROM signups ORDER BY created_at DESC"

# JSON dump (pipe to a file for a spreadsheet)
wrangler d1 execute aprilgate-waitlist --remote --json \
  --command "SELECT * FROM signups ORDER BY created_at DESC" > signups.json
```

The D1 dashboard also has a **CSV export** button.

## Optional — email the founders on each signup

Cloudflare no longer sends email natively, so this uses [Resend](https://resend.com)
(free tier is plenty). Skip this and signups still land in D1.

1. Verify your sending domain in Resend, create an API key.
2. In the Pages project → **Settings → Variables and Secrets**, add (encrypted):
   - `RESEND_API_KEY` — your key
   - `NOTIFY_TO` — `irina@aprilgatehq.com` (comma-separate for several)
   - `NOTIFY_FROM` — a verified sender, e.g. `April Gate Waitlist <waitlist@aprilgatehq.com>`
3. Redeploy. Each signup now emails the founders (reply-to is the signer's email).

## Local dev

```bash
wrangler d1 execute aprilgate-waitlist --file=./schema.sql   # local copy (no --remote)
wrangler pages dev public                                    # serves site + function
```

## Switching backends

The frontend posts to one constant. In `public/waitlist.html`, find:

```js
var ENDPOINT = "/waitlist";
```

To use **Formspree** instead of D1, set it to your form URL
(`https://formspree.io/f/XXXXXXXX`) — the form sends the same JSON and shows the
same success state; no other change needed.
