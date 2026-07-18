#!/usr/bin/env bash
#
# Deploy the hosted CodinFlow stack (API worker + web app) to Cloudflare.
# This is the "keeps Cloudflare" path — it does not publish to npm.
#
#   pnpm deploy
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] || [ -z "${CODINFLOW_API:-}" ]; then
  cat >&2 <<'EOF'
✗ CLOUDFLARE_ACCOUNT_ID and/or CODINFLOW_API is not set.

  Deployment-specific values are intentionally not committed to this repo.
  Set both before deploying:

    export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
    export CODINFLOW_API=<your API worker URL>   # baked into the web app build

EOF
  exit 1
fi

echo "→ Deploying API worker…"
pnpm --filter @codinflow/api run deploy

echo "→ Building and deploying web app…"
VITE_API_URL="$CODINFLOW_API" pnpm --filter @codinflow/web run deploy

echo "✓ Cloudflare deploy complete (API: $CODINFLOW_API)"
