---
name: codinflow
description: >-
  Map a JS/TS codebase's real structure with type-resolved analysis instead of
  grep — repo orientation (map), who calls/imports a function (query), the full
  story of a symbol (describe), the blast radius of a change (impact), and what
  runs when a route is hit (trace). Use before renaming or refactoring a
  symbol, when tracing how something is used across aliased imports and
  re-exports, or to understand an unfamiliar repository.
---

# codinflow — code intelligence for agents

`codinflow` analyzes a JavaScript/TypeScript repository with the TypeScript
compiler into a behaviour graph, then answers structural questions precisely:
it is alias-aware and distinguishes a definition from a call from a type
reference — things a text search cannot.

> This file is embedded in the `codinflow` npm package. Regenerate it any time
> with `npx codinflow skill > SKILL.md`, or install it with
> `npx codinflow skill install`.

## When to use this (and when not to)

Use it for:
- **Orienting in an unfamiliar repo** — one `map` beats twenty file reads.
- **Who calls / imports a symbol**, type-resolved — accurate on ambiguous names
  where grep floods you with false hits, and across aliased imports / re-exports.
- **What a function touches** in one shot: callees (with guard conditions),
  database reads/writes, external API calls, whether it is auth-gated, what it throws.
- **Impact / blast radius** before renaming or changing a function or file.
- **Route behaviour** — middleware order and the guarded call chain of an endpoint.

Do NOT use it for:
- A single lexical search — grep is faster for that.
- Fully dynamic dispatch (it can miss runtime-resolved calls). It is
  **complementary to grep, not a replacement**.

## Setup (once per repo)

```bash
npx codinflow .          # analyze the current repo; caches a graph in .codinflow/
```

## Verbs (all accept --json; prefer it and parse the result)

```bash
npx codinflow map --json .                  # repo orientation: routes, hotspot files, boundaries, env vars
npx codinflow query --fn <name> --json .    # who calls/imports it — with the guard each call sits behind
npx codinflow describe <name> --json .      # everything known about one symbol: signature, traits, callers, callees, reads/writes/throws
npx codinflow impact <name> --json .        # blast radius: transitive callers → routes, importing files, test files
npx codinflow impact --file src/db.ts --json .   # blast radius of a whole file
npx codinflow trace "POST /api/orders" --json .  # middleware order + guarded call tree + db/external/env touches
```

Typical agent flow: `map` once to orient → `describe`/`query` while reading →
`impact` before editing → `trace` when debugging an endpoint.

Notes:
- `query --output` accepts: `calls, usedBy, importedBy, reads, writes, throws, external`.
- `impact`/`trace` accept `--depth <n>` (defaults 12 / 8).
- `trace` matches a route by `"METHOD /path"`, a path, or a fragment; on no
  match it lists the known routes.
- Guards are verbatim source (`if (!isValidShopifyOrder(order))`) — grep-able.

## ALWAYS check staleness before trusting a cached answer

Every answer carries `staleness.verdict`:
- **fresh** — trust it.
- **stale-unaffected** — the graph is old, but no file this answer depends on
  changed; still trust it.
- **stale-affected** — a file this answer depends on changed; re-run with `--refresh`.

If you just edited files yourself, treat earlier answers as stale: re-run the
query with `--refresh`, or run `npx codinflow status .` first to see what drifted.

## Check drift explicitly

```bash
npx codinflow status .   # lists files + symbols changed since the graph
```

## Show a human the visual map

```bash
npx codinflow --ui .     # opens the canvas locally in a browser — no account, no upload
```

## Rules

1. Prefer `--json` and parse the result; do not scrape human output.
2. After editing code, re-run with `--refresh` before relying on caller/callee data.
3. For "find this string" use grep; for "who really calls/imports X, and what does X touch" use codinflow.
4. Before a rename or signature change, run `impact` and check the files it lists — including the type-invalidation list.
