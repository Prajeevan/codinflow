/**
 * The codinflow agent skill, embedded so `codinflow skill` can print or install
 * it without shipping a separate file. Keep in sync with skills/codinflow/SKILL.md.
 */
export const SKILL_MD = `---
name: codinflow
description: >-
  Map a JS/TS codebase's real structure with type-resolved analysis instead of
  grep — who calls/imports a function, what a function touches (database,
  external APIs, auth, throws), and the blast radius of a change. Use before
  renaming or refactoring a symbol, when tracing how something is used across
  aliased imports and re-exports, or to understand an unfamiliar repository.
---

# codinflow — code intelligence for agents

\`codinflow\` analyzes a JavaScript/TypeScript repository with the TypeScript
compiler into a behaviour graph, then answers structural questions precisely:
it is alias-aware and distinguishes a definition from a call from a type
reference — things a text search cannot.

## When to use this (and when not to)

Use it for:
- **Who calls / imports a symbol**, type-resolved — accurate on ambiguous names
  where grep floods you with false hits, and across aliased imports / re-exports.
- **What a function touches** in one shot: callees (with guard conditions),
  database reads/writes, external API calls, whether it is auth-gated, what it throws.
- **Impact / blast radius** before renaming or changing a function.

Do NOT use it for:
- A single lexical search — grep is faster for that.
- Fully dynamic dispatch (it can miss runtime-resolved calls). It is
  **complementary to grep, not a replacement**.

## Setup (once per repo)

\`\`\`bash
npx codinflow .          # analyze the current repo; caches a graph in .codinflow/
\`\`\`

## Query a symbol (use --json and parse it)

\`\`\`bash
npx codinflow query --fn <name> --output importedBy,usedBy,calls --json .
\`\`\`

Returns \`{ query, staleness, matches: [{ symbol, calls, usedBy, importedBy, reads, writes, throws }] }\`.
\`--output\` accepts: \`calls, usedBy, importedBy, reads, writes, throws, external\`.

## ALWAYS check staleness before trusting a cached answer

Every query carries \`staleness.verdict\`:
- **fresh** — trust it.
- **stale-unaffected** — the graph is old, but no file this answer depends on
  changed; still trust it.
- **stale-affected** — a file this answer depends on changed; re-run with \`--refresh\`.

If you just edited files yourself, treat earlier answers as stale: re-run the
query with \`--refresh\`, or run \`npx codinflow status .\` first to see what drifted.

## Check drift explicitly

\`\`\`bash
npx codinflow status .   # lists files + symbols changed since the graph
\`\`\`

## Show a human the visual map

\`\`\`bash
npx codinflow --ui .     # opens the canvas locally in a browser — no account, no upload
\`\`\`

## Rules

1. Prefer \`--json\` and parse the result; do not scrape human output.
2. After editing code, re-run with \`--refresh\` before relying on caller/callee data.
3. For "find this string" use grep; for "who really calls/imports X, and what does X touch" use codinflow.
`;
