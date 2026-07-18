# CodinFlow

Turn every repository and commit into a visual, human-readable map of application
behaviour.

---

## CLI — analyze any repo (no install, no account)

The analyzer ships as the [`codinflow`](https://www.npmjs.com/package/codinflow)
package. Run it with your package manager's runner:

```bash
npx codinflow --ui ./my-app                    # open the visual canvas locally
npx codinflow ./my-app --out graph.json        # local folder → graph JSON
bunx codinflow honojs/hono --out hono.json      # a public GitHub repo
```

Once a repo is analyzed (the graph is cached in `.codinflow/`), ask it questions
— every answer is type-resolved, guard-aware, and carries a staleness verdict:

```bash
npx codinflow map .                     # orientation: routes, hotspot files, boundaries
npx codinflow query --fn getRouter .    # who calls/imports it, and behind which guards
npx codinflow describe createOrder .    # one symbol's full story: callers, callees, reads/writes/throws
npx codinflow impact getRouter .        # blast radius: transitive callers → routes, importers, tests
npx codinflow trace "POST /api/orders" .  # middleware order + guarded call tree + db/external touches
```

All verbs take `--json` for agents; `npx codinflow skill install` teaches
Claude Code (and friends) how to use them. Full flags: `npx codinflow --help`,
or see [`packages/cli`](packages/cli).

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

Stated plainly, because a map you cannot trust is worse than no map.

The **CLI** (`npx codinflow`, including `--ui`) is entirely local — it parses
your code, writes a cache under `.codinflow/`, and serves the viewer from your
own machine. No account, no network, nothing to secure. What it doesn't do yet:

- **No AI summaries.** Summaries are deterministic and fact-derived. The
  redaction and prompt-injection-defence layer exists; no model is wired in.
- **Not benchmarked above ~300 nodes** in the canvas with our custom node type.

The optional **self-hosted server** (`workers/api` + `apps/web`) is a team-canvas
experiment, not a hardened product. If you deploy it, treat it as such:

- **No authentication or tenant isolation.** The ingest endpoint is guarded only
  by a bearer token; anyone who reaches the API can read every stored graph.
  Don't expose it publicly or point it at private source you can't share.
- **No GitHub App, webhook, or PR check**, and **no repository fetching** by the
  server — snapshots are pushed to it via `PUT` by the CLI.

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

## Connect a repository (self-hosted stack)

For local, single-repo viewing you never need a server — `codinflow --ui` does
it all. If you deploy your own API + web app (see below), you can push
snapshots to it so a whole team browses them:

```bash
export CODINFLOW_API=<your API URL>
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
pnpm test                 # golden tests across the workspace (Express fixture + verbs)
pnpm run analyze:fixture  # → artifacts/express-api.graph.json
pnpm dev:api              # local API worker (wrangler dev)
pnpm dev:web              # canvas, proxied to the local API (or set CODINFLOW_API)
```

Analyze any JS/TS repository:

```bash
cd packages/analyzer-js-ts
npx tsx src/cli.ts /path/to/repo --repository-id my-repo --commit-sha $(git -C /path/to/repo rev-parse HEAD)
```

There are two release paths, kept separate:

```bash
# 1. Cloudflare — deploy the hosted stack (API worker + web app).
#    account_id is not committed, so point wrangler at the right account first.
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
pnpm deploy

# 2. npm — publish the `codinflow` CLI (no Cloudflare involved).
pnpm publish:cli                    # add `-- --otp=123456` if npm asks for 2FA
```

First-time API setup also needs the schema: `pnpm --filter @codinflow/api run db:migrate`.

## Next milestone

1. **Auth + tenancy** — the one thing blocking real repositories.
2. **GitHub App** — webhook signature validation, repo fetch, PR check.
3. **Sandbox analysis** — move the analyzer into an isolated Container; enforce
   `ANALYSIS_LIMITS`.
4. **AI summaries** — over facts that are already true, through the existing
   redaction layer.
5. **Scale** — benchmark 500/1k/5k nodes; add aggregate collapse nodes.
