#!/usr/bin/env bash
#
# Deploy the hosted CodinFlow stack (API worker + web app) to Cloudflare.
# This is the "keeps Cloudflare" path — it does not publish to npm.
#
#   pnpm deploy
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  cat >&2 <<'EOF'
✗ CLOUDFLARE_ACCOUNT_ID is not set.

  account_id is intentionally not committed to this repo, and the wrangler
  default account may be a different one. Set it before deploying:

    export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>

EOF
  exit 1
fi

echo "→ Deploying API worker…"
pnpm --filter @codinflow/api run deploy

echo "→ Building and deploying web app…"
pnpm --filter @codinflow/web run deploy

echo "✓ Cloudflare deploy complete — https://codinflow.software-93f.workers.dev"
