# codinflow

Turn any JavaScript/TypeScript repository into a visual, human-readable map of
application behaviour — routes, functions, data stores, external calls and how
they connect — extracted with the TypeScript compiler (real types, not guesses).

## Run it (no install)

```bash
npx codinflow ./my-app --out graph.json
bunx codinflow ./my-app --out graph.json
pnpm dlx codinflow ./my-app --out graph.json
```

A public GitHub repository, by `owner/repo` shorthand or full URL:

```bash
npx codinflow honojs/hono --out hono.graph.json
```

Upload to a CodinFlow API so it shows up in the visual canvas:

```bash
npx codinflow ./my-app \
  --api https://codinflow-api.software-93f.workers.dev \
  --token "$CODINFLOW_TOKEN"
```

## Options

| Flag | Meaning |
| --- | --- |
| `--repository-id <id>` | Name it in the UI (default: folder or repo name) |
| `--commit-sha <sha>` | Label this snapshot (default: current git HEAD) |
| `--branch <name>` | Branch to clone, for a GitHub URL |
| `--out <file>` | Write the graph JSON to this file |
| `--api <url>` | Upload to a CodinFlow API |
| `--token <token>` | Bearer token for `--api` (or set `CODINFLOW_TOKEN`) |

The first argument is a local path (use `./`) or a GitHub `owner/repo` / URL. A
leading `analyze` verb is optional: `codinflow analyze ./my-app` also works.

Cloning a remote repo runs `git clone --depth 1` and nothing else — repositories
are parsed, never installed or built.

## Query a symbol (for humans and AI agents)

`analyze` on a local folder caches a warm graph in `.codinflow/`. `status` and
`query` read it — and, crucially, report **how stale it is** versus the working
tree, so an answer is never silently out of date.

```bash
codinflow status ./my-app          # is the cached graph current?
codinflow query --fn getRouter --output importedBy,usedBy,calls ./my-app
codinflow query --fn getRouter --json ./my-app     # machine-readable
codinflow query --fn getRouter --refresh ./my-app  # re-analyze first, guaranteed fresh
```

`--output` is a comma list of: `calls`, `usedBy`, `importedBy`, `reads`,
`writes`, `throws`, `external` (default `calls,usedBy,importedBy`).

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
