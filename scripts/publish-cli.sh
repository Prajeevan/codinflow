#!/usr/bin/env bash
#
# Publish the `codinflow` CLI to the npm registry. This is the "no Cloudflare"
# path — it only builds and publishes the npm package.
#
#   pnpm publish:cli                     # normal publish (may prompt for 2FA)
#   pnpm publish:cli -- --otp=123456     # pass a 2FA one-time code through
#
# Bump the version in packages/cli/package.json before republishing — npm will
# reject re-publishing an existing version.
#
set -euo pipefail
cd "$(dirname "$0")/../packages/cli"

echo "→ Building the bundled CLI…"
node build.mjs

echo "→ Publishing to npm (public, unscoped)…"
npm publish "$@"

echo "✓ Published. Try it: npx codinflow --help"
