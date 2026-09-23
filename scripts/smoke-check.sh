#!/usr/bin/env bash
#
# April Gate — post-deploy smoke check.
#
# Guards against the failure mode that took production down: a Pages deployment
# that ships public/ WITHOUT the functions/ bundle. When that happens nothing
# errors — Pages' static-asset handler quietly answers /api/* with index.html on
# GET and a bodiless 405 on POST, so the dashboard renders an empty shipment
# list and the create form dies on "Unexpected end of JSON input".
#
# The tell is the content-type, not the status code: every check below asserts
# application/json. A deployment missing its functions returns 200 text/html and
# still looks healthy to anything that only watches status codes.
#
# Usage:
#   ./scripts/smoke-check.sh                              # against production
#   ./scripts/smoke-check.sh https://abc123.aprilgate.pages.dev   # a preview
#
# Run it immediately after:  npx wrangler pages deploy --branch=main

set -uo pipefail

BASE="${1:-https://aprilgatehq.com}"
FAILED=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }

# check_json <method> <path> <description> [body]
check_json() {
  local method="$1" path="$2" desc="$3" body="${4:-}"
  local out code ctype

  if [ "$method" = "POST" ]; then
    out=$(curl -s --max-time 30 -w '\n%{http_code}\n%{content_type}' \
      -X POST "$BASE$path" -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
  else
    out=$(curl -s --max-time 30 -w '\n%{http_code}\n%{content_type}' "$BASE$path" 2>/dev/null)
  fi

  ctype=$(printf '%s' "$out" | tail -n 1)
  code=$(printf '%s' "$out" | tail -n 2 | head -n 1)

  case "$ctype" in
    application/json*)
      pass "$desc — $code $ctype" ;;
    *)
      if [ -z "$ctype" ]; then
        fail "$desc — no response (is $BASE reachable?)"
      else
        fail "$desc — $code $ctype  <<< functions bundle is MISSING from this deployment"
      fi ;;
  esac
}

printf '\nSmoke-checking %s\n\n' "$BASE"

# GET routes: must be JSON, not the index.html fallthrough.
check_json GET /api/shipments      '/api/shipments        (dashboard picker)'
check_json GET /api/shipments/list '/api/shipments/list   (operator portal)'

# POST route: an intentionally invalid payload. This exercises the Function's
# validation branch and returns before any Solana write, so the check is safe to
# run against production as often as you like.
check_json POST /api/shipments/create '/api/shipments/create (validation path)' '{"name":""}'

# The landing page should still be HTML — proves we are not just asserting JSON
# everywhere and that static assets survived the deploy.
if curl -s --max-time 30 -o /dev/null -w '%{content_type}' "$BASE/" 2>/dev/null | grep -q 'text/html'; then
  pass '/                     (static assets)'
else
  fail '/                     (static assets) — landing page did not return HTML'
fi

echo
if [ "$FAILED" -ne 0 ]; then
  printf '\033[31mSMOKE CHECK FAILED.\033[0m Redeploy from the repo root so functions/ is included:\n'
  printf '  npx wrangler pages deploy --branch=main\n\n'
  exit 1
fi
printf '\033[32mAll checks passed.\033[0m\n\n'
