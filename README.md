# CodinFlow

Turn every repository and commit into a visual, human-readable map of application
behaviour.

**Live:** https://codinflow.software-93f.workers.dev
**API:** https://codinflow-api.software-93f.workers.dev

---

## CLI — analyze any repo (no install)

The analyzer ships as the [`codinflow`](https://www.npmjs.com/package/codinflow)
package. Run it with your package manager's runner:

```bash
npx codinflow ./my-app --out graph.json        # local folder
bunx codinflow honojs/hono --out hono.json      # a public GitHub repo
pnpm dlx codinflow ./my-app \                    # upload to the hosted canvas
  --api https://codinflow-api.software-93f.workers.dev --token "$CODINFLOW_TOKEN"
```

Full flags: `npx codinflow --help`, or see [`packages/cli`](packages/cli).

---

## What works today

A complete vertical slice, verified end to end against a real Express fixture:

```
Express repo → TS Compiler API analyzer → language-neutral graph
    → Worker API (D1 metadata + R2 artifacts + KV cache)
    → React Flow + ELK canvas (overview, execution path, inspector, commit diff)
```

- **Analyzer** — files, functions, classes, methods, imports, calls, awaits,
  conditions, throws, env reads, Express routes and middleware ordering.
  Resolved-call ratio on the fixture: **1.0**.
- **Dependency boundaries** — `node_modules` never becomes graph nodes. Third-party
  packages collapse to named boundaries (PostgreSQL, Shopify Admin API). Templated
  URLs are constant-folded so a real service is named rather than "External HTTP API".
- **Traceability** — every node and edge carries `provenance` (analyzer, version,
  language, evidence type) and a confidence score. Conditional edges keep the
  verbatim source expression next to their prose label.
- **Commit intelligence** — stable symbol identity across commits, behavioural
  change classification, graded blast radius, deterministic prose summary.
  Removing auth middleware is classified as an authentication change and leads
  the summary, which a line diff buries.
- **Canvas** — files render as containers holding their functions and classes,
  with the module-level definitions (`const`/`let`/`var`, types, interfaces)
  listed in each file's header. Every block carries a `</>` icon that opens the
  real source, scrolled to and highlighting that symbol's lines. Selecting a file
  inspects its definitions, imports and dependents; selecting a function inspects
  what it reads, writes, calls and throws. Plus semantic zoom, minimap, search,
  route-path tracing, and a commit overlay that badges files `+N ~N CHANGED` and
  functions `NEW`/`MODIFIED`.
  *Removed* nodes are listed in the diff panel but not drawn on the canvas: the
  diff view renders the head snapshot, and a removed node is by definition not in
  it. Overlaying them needs a base∪head view — not yet built.

## What is not built

Stated plainly, because a map you cannot trust is worse than no map:

- **No authentication and no tenant isolation enforcement.** The API is public and
  serves a fixture. Do not point it at private source.
- **No GitHub App, webhook, or PR check.** Snapshots are ingested via `PUT`.
- **No repository fetching**, so no archive-traversal or symlink defences yet.
- **No AI summaries.** The redaction and injection-defence layer exists; no model
  is wired in. Summaries today are deterministic and fact-derived.
- **No Sandbox/Container.** The analyzer runs in Node (ADR-004).
- **No Vectorize, Queues, Workflows, or Durable Objects.** Not needed by the slice.
- **Not benchmarked above ~300 nodes** with our custom nodes.

## Layout

```
packages/graph-schema     canonical, renderer-independent node/edge types
packages/analyzer-core    symbol identity, boundaries, ignore rules, redaction
packages/analyzer-js-ts   TS Compiler API extraction + Express adapter
workers/api               Hono worker: D1 + R2 + KV, graph views, diff engine
apps/web                  React Flow + ELK canvas
fixtures/express-api      known-behaviour fixture (commit "before")
fixtures/express-api-v2   the same app after a behavioural change ("after")
docs/                     architecture decisions, security, business plan
```

## Connect a repository

Analyze a local folder or a public GitHub repository and push it to the app:

```bash
export CODINFLOW_API=https://codinflow-api.software-93f.workers.dev
export CODINFLOW_TOKEN=<ingest token>   # workers/api/.dev.vars

pnpm codinflow ~/code/my-app            # a local folder
pnpm codinflow honojs/hono              # a public GitHub repo (shallow clone)
pnpm codinflow ./my-app --out graph.json  # no upload, just the graph
```

The commit label defaults to the folder's current git HEAD, so analyzing the same
repo before and after a change gives you two snapshots to compare under
**Review changes**. Nothing is installed or built — the analyzer only parses.

## Run it

```bash
pnpm install
pnpm test                 # 24 golden tests against the Express fixture
pnpm run analyze:fixture  # → artifacts/express-api.graph.json
pnpm dev:web              # canvas against the deployed API
```

Analyze any JS/TS repository:

```bash
cd packages/analyzer-js-ts
npx tsx src/cli.ts /path/to/repo --repository-id my-repo --commit-sha $(git -C /path/to/repo rev-parse HEAD)
```

Deploy. `account_id` is not committed, so set `CLOUDFLARE_ACCOUNT_ID` to your
Cloudflare account first (the wrangler default account may be a different one):

```bash
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
pnpm --filter @codinflow/api run db:migrate
pnpm --filter @codinflow/api run deploy
pnpm --filter @codinflow/web run deploy
```

## Next milestone

1. **Auth + tenancy** — the one thing blocking real repositories.
2. **GitHub App** — webhook signature validation, repo fetch, PR check.
3. **Sandbox analysis** — move the analyzer into an isolated Container; enforce
   `ANALYSIS_LIMITS`.
4. **AI summaries** — over facts that are already true, through the existing
   redaction layer.
5. **Scale** — benchmark 500/1k/5k nodes; add aggregate collapse nodes.
