# Revise the early-access page — make it punchy

*Paste into Claude Code in the repo. This revises the page you just built.*

---

**You already built this page — EDIT it in place, do not recreate it.** Change only what's listed below; leave all other markup, styling, layout, the form fields' wiring, and the submission/backend capture untouched unless a change here requires it. The form must keep working exactly as it does now. When done: show me a short summary of exactly what you changed (ideally a diff), run the build/lint to confirm nothing broke, and confirm a test submission still gets stored.

Revise the waitlist page. Core problem: it over-explains and buries the incentive. Most visitors arrive **already convinced** (they clicked a link from a sales follow-up), so lead with the punch and the offer — not an explanation. Keep the site's existing brand/components.

## Restructure

**ABOVE THE FOLD — everything a convinced visitor needs to sign up in 10 seconds, no scrolling:**

1. **Kicker:** EARLY ACCESS · FOUNDING RATE
2. **Headline (one line, the tagline):** Accountability and transparency for every cold-chain shipment.
3. **Subhead (one line only):** A sealed device signs your shipment's temperature and turns it into a tamper-proof record your FDA inspector, an auditor, a hospital, or a court can verify — without taking your word for it.

   **HARD RULE on the FDA mention:** name FDA only as a party who *can verify* the record. NEVER write "FDA-approved," "FDA-compliant," "FDA-cleared," "meets FDA requirements," or anything implying agency endorsement or that FDA requires this — those are false regulatory claims and the audience (compliance officers) will reject the page over them. Frame it as defensibility in an inspection, not compliance status.
4. **The incentive — make it prominent, right beside or above the form (this is the reason to sign up NOW):**
   > **Founding rate — first facilities on the list only:**
   > - **50% off per-shipment service for 3 years**
   > - **Hardware at a flat base rate** (no surprise device costs)
   > - **First to get it** — first units ship in ~6–8 months
5. **The form** (short): Full name · Work email · Company / facility · [optional] Title · [optional] Facility type dropdown (503B outsourcing facility / specialty pharmacy / pharma distributor / logistics-3PL / other).
6. **Button:** Claim early-bird access
7. **Microcopy under button:** Non-binding — it's not a purchase. No spam; we'll only email about early access.
8. **Success state:** You're on the founding list. You'll be first to hear as we build — and first to get it. Thank you.

**BELOW THE FOLD — optional detail for the occasional cold visitor who wants the "what is this":**
- 3 short benefit points: **Hardware-attested** (signed at the sensor, can't be faked) · **Independently verifiable** (anyone checks it without trusting us) · **Rides alongside** (works with your current logger, no change control).
- One short problem line: "When someone challenges whether a shipment stayed in range, your logger's PDF is only as good as their willingness to trust you. We make the record impossible to alter and independent to verify."
- One founder-credibility line if wanted.

## Changes to make explicit
- **Remove the redundant explanatory column.** One value statement (headline + subhead), not two.
- **Rename everything "design partner" → "early access / founding rate / early bird."** Do not use "design partner" anywhere — it implies work; "early bird" implies they get something.
- **Move the incentive above the form**, not below the button.
- Keep it to **one screen** on desktop for the convinced visitor; detail scrolls below.

## Keep the guardrails
- Honest that it's pre-product (~6–8 months). Frame as early access, never buy-now.
- Lead with the benefit (verifiable / tamper-proof / audit-ready). **Do not foreground "blockchain," "crypto," or "Solana"** — audience is pharma QA/regulatory.
- No fake counters, testimonials, or certifications we don't hold.
- Capture submissions (timestamped, all fields) to a store I can export; reuse any existing form backend, else add Netlify Forms/Formspree and tell me the setup. Confirm a test submission is stored before finishing.

*(Pricing note for me, not the page: keep the 3-year term — a permanent/"for life" 50% discount would halve margin on our best accounts forever and weaken unit economics. If a lifetime hook is wanted later, it should be a smaller permanent discount after the 3 years, not 50%.)*
