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

## Requirements

Node.js >= 18. `typescript` is installed automatically as a dependency.

## License

MIT
