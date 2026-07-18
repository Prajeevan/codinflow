# codinflow

**Code intelligence for Claude Code and AI agents.** Ask a JS/TS repo precise
questions — who calls this, what breaks if I change it, what runs when this route
is hit — and get answers from the TypeScript compiler's resolved call graph, not a
text search. grep floods an agent with 40 ambiguous matches; codinflow returns the
one correct, type-resolved answer, so it gets there in fewer reads and fewer tokens.

Entirely local: no install, no account, no server.

## Give your agent the tools

```bash
npx codinflow skill install    # writes .claude/skills/codinflow — Claude Code learns the verbs
npx codinflow .                # analyze the current repo (caches a graph in .codinflow/)
```

## See it as a visual map (for humans)

```bash
npx codinflow --ui          # analyze the current folder and open the visual canvas
npx codinflow --ui ./my-app
```

This analyzes the folder, starts a local server (default `http://127.0.0.1:9338`)
and opens the interactive canvas in your browser — files, functions, routes,
data stores and how they connect. Entirely local: no upload, no token, no hosted
service. Re-running reuses the cached graph when your code hasn't changed.

## Analyze to a file / pipe

```bash
npx codinflow ./my-app --out graph.json
bunx codinflow ./my-app --out graph.json
pnpm dlx codinflow ./my-app --json | jq .stats
```

A public GitHub repository, by `owner/repo` shorthand or full URL:

```bash
npx codinflow honojs/hono --out hono.graph.json
```

Upload to a self-hosted CodinFlow API so it shows up in a shared canvas
(the local `--ui` needs none of this):

```bash
npx codinflow ./my-app \
  --api "$CODINFLOW_API" \
  --token "$CODINFLOW_TOKEN"
```

## Options

| Flag | Meaning |
| --- | --- |
| `--repository-id <id>` | Name it in the UI (default: folder or repo name) |
| `--commit-sha <sha>` | Label this snapshot (default: current git HEAD) |
| `--branch <name>` | Branch to clone, for a GitHub URL |
| `--out <file>` | Write the graph JSON to this file |
| `--api <url>` | Upload to a self-hosted CodinFlow API |
| `--token <token>` | Bearer token for `--api` (or set `CODINFLOW_TOKEN`) |
| `--fn <name>` | Symbol for `query` (also the first operand of `describe`/`impact`) |
| `--file <path>` | For `impact`: a whole file instead of a symbol |
| `--route <route>` | For `trace` (also its first operand) |
| `--depth <n>` | Max walk depth for `impact` (12) / `trace` (8) |
| `--json` | Machine-readable output, on every query verb |
| `--refresh` | Re-analyze before answering — guaranteed fresh |

The first argument is a local path (use `./`) or a GitHub `owner/repo` / URL. A
leading `analyze` verb is optional: `codinflow analyze ./my-app` also works.

Cloning a remote repo runs `git clone --depth 1` and nothing else — repositories
are parsed, never installed or built.

## Ask the codebase questions (for humans and AI agents)

`analyze` on a local folder caches a warm graph in `.codinflow/`. Every query
verb reads it — and, crucially, reports **how stale it is** versus the working
tree, so an answer is never silently out of date.

```bash
codinflow map ./my-app             # orientation: routes, hotspot files, boundaries, env vars
codinflow query --fn getRouter ./my-app   # who calls/imports it — and behind which guards
codinflow describe createOrder ./my-app   # one symbol's full story: signature, traits,
                                          #   callers, callees, reads/writes/throws/external
codinflow impact getRouter ./my-app       # blast radius: transitive callers → routes,
                                          #   importing files (type invalidation), test files
codinflow impact --file src/db.ts ./my-app
codinflow trace "POST /api/orders" ./my-app  # middleware order + guarded call tree
                                             #   + db/external/env touches
codinflow status ./my-app          # is the cached graph current?
```

All of it is type-resolved, and guards are verbatim source — `impact` will tell
you a caller only runs `if (!isValidShopifyOrder(order))`. Add `--json` to any
verb for machine-readable output, `--refresh` to re-analyze first.

For `query`, `--output` is a comma list of: `calls`, `usedBy`, `importedBy`,
`reads`, `writes`, `throws`, `external` (default `calls,usedBy,importedBy`).

AI agents: `npx codinflow skill install` writes a `.claude/skills/codinflow`
skill that teaches Claude Code (and compatible agents) the whole flow —
`map` to orient, `describe`/`query` while reading, `impact` before editing,
`trace` when debugging an endpoint.

### Staleness is first-class

Every `query` answer carries a verdict, computed by hashing the working tree
against the cached graph (cheap — no compiler):

- **fresh** — nothing changed since the graph; answer at full confidence.
- **stale-unaffected** — the graph is old, but no file this answer depends on
  changed, so it still holds.
- **stale-affected** — a file this answer depends on changed; re-run with
  `--refresh`.

This is what makes the cache trustworthy for an AI agent: type-resolved
"who calls / imports this" in one structured call, and it tells you when it might
be wrong. `--json` emits the report plus the `staleness` block for programmatic
use.

## Requirements

Node.js >= 18. `typescript` is installed automatically as a dependency.

## License

MIT
