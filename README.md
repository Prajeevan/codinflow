# CodinFlow

**Code intelligence for Claude Code and AI agents.** Point it at a JS/TS repo and
ask precise questions — who calls this, what breaks if I change it, what runs when
this route is hit — and get answers grep can't give, because they come from the
TypeScript compiler's resolved call graph, not text matching.

One CLI, entirely local: no install, no account, no server. Humans get the same
graph as a visual map (`--ui`); agents get it as JSON, plus a `staleness` verdict
on every answer.

## grep floods, codinflow answers

```text
$ grep -rn getRouter src/           40 hits — comments, a type import, an unrelated
                                    getRouterConfig, three aliased re-exports…

$ codinflow query --fn getRouter .  the ONE function that calls it, the file that
                                    imports it, and the guard it sits behind
```

grep finds a *string*; codinflow answers the *question*. It's alias-aware and tells
a definition from a call from a type reference — so an agent gets one correct answer
instead of a page of matches to read and rule out. That's what actually saves an
agent time: **fewer file reads, fewer wrong turns, fewer tokens** to a *correct*
answer.

> It won't out-race ripgrep to a raw string match — a full-repo compile is slower
> than grep. It's faster to the *answer*, not to a match. Use grep to find a
> string; use codinflow to learn who really calls/imports a symbol and what it
> touches. They're complementary.

## Give your agent the tools

```bash
npx codinflow skill install    # writes .claude/skills/codinflow — Claude Code learns the verbs
npx codinflow .                # analyze the current repo (caches a graph in .codinflow/)
```

Then, in any analyzed repo, the agent (or you) asks:

```bash
npx codinflow map .                       # orient: routes, hotspot files, boundaries, env vars — one screen, not 20 file reads
npx codinflow query --fn getRouter .      # who calls/imports it, and behind which guards
npx codinflow describe createOrder .      # one symbol's full story: callers, callees, reads/writes/throws
npx codinflow impact getRouter .          # blast radius: transitive callers → routes, importers, tests — run before a refactor
npx codinflow trace "POST /api/orders" .  # what runs when a route is hit: middleware order, guarded call tree, db/external touches
```

Every verb takes `--json`. Every answer is type-resolved and carries a **staleness
verdict** — `fresh` / `stale-unaffected` / `stale-affected` — computed against the
working tree, so an agent knows when a cached answer is still true and when to
re-analyze. That's the part a raw AST dump can't do: an answer that tells you when
it has gone stale. `--refresh` re-analyzes first when you want a guaranteed-current
result.

Full flags: `npx codinflow --help`, or see [`packages/cli`](packages/cli).

## A visual map for humans

The same graph, for the human on the team:

```bash
npx codinflow --ui              # analyze the current folder and open the map in your browser
npx codinflow --ui ./my-app     # some other folder
```

Opens a local canvas (`http://127.0.0.1:9338`): files as containers of their
functions and classes, routes with their handlers, data stores and external
services, semantic zoom, search, and click-through to the real source. No upload,
no token, everything on your machine. `Ctrl+C` to stop.

You can also just take the raw graph:

```bash
npx codinflow ./my-app --out graph.json   # write the full graph as JSON
bunx codinflow honojs/hono --out g.json    # a public GitHub repo (shallow clone, parse only)
npx codinflow . --json | jq .stats         # pipe it anywhere
```

## What it extracts

- **Analyzer** — files, functions, classes, methods, imports, calls, awaits,
  conditions, throws, env reads, and routes + middleware ordering for
  **Express, Hono, Fastify, Next.js, SvelteKit, and TanStack**. Conditional edges
  keep the verbatim source expression (`if (!isValidShopifyOrder(order))`) next to
  their prose label.
- **Dependency boundaries** — `node_modules` never becomes graph nodes. Third-party
  packages collapse to named boundaries (PostgreSQL, Shopify Admin API); templated
  URLs are constant-folded so a real service is named rather than "External HTTP API".
- **Traceability** — every node and edge carries `provenance` (analyzer, version,
  language, evidence type) and a confidence score. Nothing inferred is ever
  presented as a proven relationship.
- **Commit intelligence** — stable symbol identity across commits and behavioural
  change classification: removing auth middleware is classified as an authentication
  change and leads the summary, which a line diff buries.

The analyzer is covered by golden tests against known-behaviour fixtures, and run
regularly against real third-party repos.

## What is not built

Stated plainly, because a map you cannot trust is worse than no map.

The **CLI** (`npx codinflow`, including `--ui`) is entirely local — it parses your
code, writes a cache under `.codinflow/`, and serves the viewer from your own
machine. No account, no network, nothing to secure. What it doesn't do yet:

- **No AI summaries.** Summaries are deterministic and fact-derived. The redaction
  and prompt-injection-defence layer exists; no model is wired in.
- **JS/TS only.** The graph schema is language-neutral, but the only adapter today
  is the TypeScript compiler one.
- **Not benchmarked above ~300 nodes** in the canvas with our custom node type.

The optional **self-hosted server** (`workers/api` + `apps/web`, see below) is a
team-canvas experiment, not a hardened product. If you deploy it: it has **no
authentication or tenant isolation** (the ingest endpoint is guarded only by a
bearer token — anyone who reaches the API can read every stored graph), and **no
GitHub App, webhook, PR check, or server-side repo fetching**. Don't expose it
publicly or point it at private source you can't share.

---

## Contributing / running from source

```bash
pnpm install
pnpm test                 # golden tests across the workspace (fixtures + verbs)
pnpm run analyze:fixture  # → artifacts/express-api.graph.json

# run the CLI straight from source, against any repo:
cd packages/analyzer-js-ts
npx tsx src/cli.ts map /path/to/repo
```

(`--ui` from source needs the canvas bundle — build it once with
`node packages/cli/build.mjs`, then `codinflow --ui` works from the built package.)

Repo layout:

```
packages/graph-schema     canonical, renderer-independent node/edge types
packages/analyzer-core    symbol identity, boundaries, ignore rules, redaction
packages/analyzer-js-ts   TS Compiler API extraction, framework adapters, CLI verbs
packages/cli              the published `codinflow` npm package (bundles the above + viewer)
workers/api               optional Hono server: stores graphs, serves views + diff
apps/web                  React Flow + ELK canvas (embedded in the CLI; also the server's UI)
fixtures/                 known-behaviour repos the golden tests analyze
```

## Optional: self-hosted team canvas

Everything above is local. If you want a shared canvas where a team browses graphs
and compares commits ("Review changes"), you can deploy the bundled server and push
snapshots to it. This is optional and unsecured — see the warning above.

```bash
# deploy the API worker + web app to your own Cloudflare account
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
export CODINFLOW_API=<your API worker URL>   # baked into the web build
pnpm deploy
pnpm --filter @codinflow/api run db:migrate   # first-time schema setup

# then push snapshots from the CLI
export CODINFLOW_TOKEN=<ingest token>         # workers/api/.dev.vars
pnpm codinflow ~/code/my-app --api "$CODINFLOW_API" --token "$CODINFLOW_TOKEN"
```

Analyzing the same repo before and after a change gives you two snapshots to
compare under **Review changes** (the local `--ui` shows a single snapshot).

## Roadmap

1. **More languages** — the schema is language-neutral; Python and Java adapters next.
2. **AI summaries** — over facts that are already true, through the existing
   redaction layer; BYO-key in the CLI so your key never leaves your machine.
3. **MCP server** — `codinflow mcp`, analyze-once/query-many, so agents call the
   verbs natively instead of shelling out.
4. **Scale** — benchmark 500 / 1k / 5k nodes; aggregate collapse nodes in the canvas.

## License

MIT
