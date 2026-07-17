#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { GraphSnapshot } from "@codinflow/graph-schema";
import { analyzeRepository } from "./extract.js";
import { cacheDir, detectChanges, hasDrift, readCache, writeCache, type Changes } from "./cache.js";
import { buildReport, findSymbols, parseOutputs, stalenessFor } from "./query.js";
import { openBrowser, startLocalServer } from "./local-server.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "repository-id": { type: "string" },
    "commit-sha": { type: "string" },
    out: { type: "string" },
    api: { type: "string" },
    token: { type: "string" },
    branch: { type: "string" },
    fn: { type: "string" },
    output: { type: "string" },
    json: { type: "boolean" },
    refresh: { type: "boolean" },
    ui: { type: "boolean" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const USAGE = `
codinflow — analyze a JavaScript/TypeScript repository into a behaviour graph

  codinflow [analyze] <path-or-github-url> [options]   analyze a repo
  codinflow --ui [path]                                open the visual canvas locally (no token)
  codinflow status [path]                              is the cached graph still current?
  codinflow query --fn <name> [path] [options]         what calls / is-used-by a function

Analyze options
  --repository-id <id>   Name it in the UI (default: folder or repo name)
  --commit-sha <sha>     Commit to label this snapshot (default: current git HEAD)
  --branch <name>        Branch to clone, for a GitHub URL
  --out <file>           Write the graph JSON here
  --api <url>            Upload to a CodinFlow API and make it visible in the app
  --token <token>        Bearer token for --api (or set CODINFLOW_TOKEN)

Query options
  --fn <name>            Function/method/class to inspect (a trailing () is fine)
  --output <list>        Comma list: calls,usedBy,importedBy,reads,writes,throws,external
  --refresh              Re-analyze before answering (guarantees a fresh result)
  --json                 Machine-readable output (for status and query)

Analyze caches a warm graph in <path>/.codinflow. status and query read it and
report how stale it is versus the working tree, so an answer is never silently old.

Examples
  codinflow analyze ./my-app
  codinflow status ./my-app
  codinflow query --fn getRouter --output importedBy,usedBy,calls --json ./my-app
`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const VERBS = new Set(["analyze", "status", "query", "ui"]);
const hasVerb = positionals[0] !== undefined && VERBS.has(positionals[0]);
const verb = hasVerb ? positionals[0]! : "analyze";
const operands = hasVerb ? positionals.slice(1) : positionals;

/**
 * The directory the user actually typed the command in. A package manager runs
 * scripts with cwd set to the package, so a relative path the user passed would
 * otherwise resolve against the wrong directory. INIT_CWD is where they stood.
 */
const invocationDir = process.env.INIT_CWD ?? process.cwd();

if (verb === "ui" || values.ui) await runUi();
else if (verb === "status") await runStatus();
else if (verb === "query") await runQuery();
else await runAnalyze();

// ---------------------------------------------------------------------------

async function runAnalyze(): Promise<void> {
  // No path given → analyze the current folder.
  const target = operands[0] ?? ".";
  const { dir: rootDir, cloned } = cloneIfRemote(target);
  if (!existsSync(rootDir)) {
    console.error(`no such directory: ${rootDir}`);
    process.exit(1);
  }

  const repositoryId = values["repository-id"] ?? path.basename(rootDir).replace(/[^\w.-]/g, "-");
  const commitSha = values["commit-sha"] ?? gitSha(rootDir) ?? "workdir";

  console.error(`analyzing ${rootDir}`);
  const started = Date.now();
  const snapshot = analyzeRepository({ rootDir, repositoryId, commitSha });
  const duration = Date.now() - started;

  console.error(
    [
      ``,
      `  repository   ${repositoryId} @ ${commitSha}`,
      `  analyzed in  ${duration}ms`,
      `  graph        ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges`,
      `  frameworks   ${snapshot.frameworks.map((f) => f.name).join(", ") || "none detected"}`,
      `  routes       ${snapshot.stats.routeCount}`,
      `  calls resolved ${Math.round(snapshot.stats.resolvedCallRatio * 100)}%`,
      snapshot.warnings.length > 0 ? `  warnings     ${snapshot.warnings.length} (see graph.warnings)` : ``,
      ``,
    ]
      .filter((line) => line !== ``)
      .join("\n"),
  );

  // A local repo gets a warm-graph cache for `status`/`query`; a throwaway clone
  // does not (its temp dir vanishes).
  if (!cloned) {
    writeCache(rootDir, snapshot);
    console.error(`cached graph → ${path.join(rootDir, ".codinflow")} (add .codinflow/ to .gitignore)`);
  }

  if (values.out) {
    const outPath = path.resolve(invocationDir, values.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.error(`wrote ${outPath}`);
  }

  await maybeUpload(snapshot, repositoryId, commitSha);

  if (!values.out && !values.api && !process.env.CODINFLOW_API) {
    // Raw JSON only when it's being captured (piped/redirected) or asked for.
    // An interactive run gets a readable summary instead of a wall of JSON.
    if (values.json || !process.stdout.isTTY) {
      process.stdout.write(JSON.stringify(snapshot, null, 2));
    } else {
      console.error(analyzeGuidance(snapshot, operands[0] ?? ".", !cloned));
    }
  }

  if (cloned) console.error(`(clone left in ${rootDir})`);
}

async function runStatus(): Promise<void> {
  const rootDir = path.resolve(invocationDir, operands[0] ?? ".");
  const cached = readCache(rootDir);
  if (!cached) {
    fail(`no cached graph in ${cacheDir(rootDir)}. Run: codinflow analyze ${operands[0] ?? "."}`);
  }

  const changes = detectChanges(rootDir, cached.manifest);
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(cached.manifest.generatedAt)) / 1000));
  const affectedSymbols = symbolsInFiles(cached.snapshot, new Set([...changes.changed, ...changes.removed]));

  if (values.json) {
    printJson({
      graphGeneratedAt: cached.manifest.generatedAt,
      commitSha: cached.manifest.commitSha,
      ageSeconds,
      current: !hasDrift(changes),
      ...changes,
      staleSymbols: affectedSymbols,
    });
    return;
  }

  const line = (label: string, items: string[]) =>
    items.length ? console.error(`  ${label} (${items.length}):\n${items.map((i) => `    ${i}`).join("\n")}`) : undefined;

  console.error(`\n  graph      ${cached.manifest.repositoryId} @ ${cached.manifest.commitSha}`);
  console.error(`  cached     ${humanAge(ageSeconds)} ago (${cached.manifest.generatedAt})`);
  if (!hasDrift(changes)) {
    console.error(`  status     ✓ current — no source files changed since the graph\n`);
    return;
  }
  console.error(`  status     ⚠ stale — the working tree drifted since the graph`);
  line("changed", changes.changed);
  line("added", changes.added);
  line("removed", changes.removed);
  if (affectedSymbols.length) {
    console.error(`  possibly-stale symbols (${affectedSymbols.length}): ${affectedSymbols.slice(0, 12).join(", ")}${affectedSymbols.length > 12 ? "…" : ""}`);
  }
  console.error(`  → refresh with: codinflow analyze ${operands[0] ?? "."}\n`);
}

async function runQuery(): Promise<void> {
  if (!values.fn) fail("query needs --fn <name>. Example: codinflow query --fn getRouter ./my-app");

  const rootDir = path.resolve(invocationDir, operands[0] ?? ".");
  const outputs = parseOutputs(values.output);

  let snapshot: GraphSnapshot;
  let changes: Changes;

  if (values.refresh) {
    if (!existsSync(rootDir)) fail(`no such directory: ${rootDir}`);
    const repositoryId = values["repository-id"] ?? path.basename(rootDir).replace(/[^\w.-]/g, "-");
    const commitSha = values["commit-sha"] ?? gitSha(rootDir) ?? "workdir";
    console.error(`refreshing graph for ${rootDir}…`);
    snapshot = analyzeRepository({ rootDir, repositoryId, commitSha });
    writeCache(rootDir, snapshot);
    changes = { changed: [], added: [], removed: [] };
  } else {
    const cached = readCache(rootDir);
    if (!cached) {
      fail(`no cached graph in ${cacheDir(rootDir)}. Run: codinflow analyze ${operands[0] ?? "."} (or pass --refresh)`);
    }
    snapshot = cached.snapshot;
    changes = detectChanges(rootDir, cached.manifest);
  }

  const matches = findSymbols(snapshot, values.fn);
  const reports = matches.map((node) => buildReport(snapshot, node, outputs));
  const relevantFiles = [...new Set(reports.flatMap((report) => report.relevantFiles))];
  const staleness = stalenessFor(changes, snapshot.generatedAt, Date.now(), relevantFiles);

  if (values.json) {
    printJson({ query: { fn: values.fn, outputs }, staleness, matchCount: matches.length, matches: reports });
    return;
  }

  printQueryHuman(values.fn, reports, staleness);
}

// ---------------------------------------------------------------------------

async function runUi(): Promise<void> {
  const { dir: rootDir, cloned } = cloneIfRemote(operands[0] ?? ".");
  if (!existsSync(rootDir)) fail(`no such directory: ${rootDir}`);

  // Reuse the cached graph when the working tree hasn't drifted; otherwise
  // re-analyze and refresh the cache (the hash check the user asked for).
  let snapshot: GraphSnapshot;
  const cached = cloned ? null : readCache(rootDir);
  if (cached && !hasDrift(detectChanges(rootDir, cached.manifest))) {
    snapshot = cached.snapshot;
    console.error(`using cached graph (${snapshot.nodes.length} nodes) — current with the working tree`);
  } else {
    const repositoryId = values["repository-id"] ?? path.basename(rootDir).replace(/[^\w.-]/g, "-");
    const commitSha = values["commit-sha"] ?? gitSha(rootDir) ?? "workdir";
    console.error(`analyzing ${rootDir}…`);
    snapshot = analyzeRepository({ rootDir, repositoryId, commitSha });
    if (!cloned) writeCache(rootDir, snapshot);
    console.error(`analyzed ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges`);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = process.env.CODINFLOW_WEB_DIR ?? path.join(here, "..", "web");
  const port = values.port ? Number(values.port) : 9338;

  const server = await startLocalServer({ snapshot, webDir, port }).catch((error): never =>
    fail(String(error instanceof Error ? error.message : error)),
  );

  console.error(`\n  CodinFlow UI → ${server.url}`);
  console.error(`  Serving ${snapshot.repositoryId} locally. No upload, no token.`);
  console.error(`  Ctrl+C to stop.\n`);
  openBrowser(server.url);

  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
}

async function maybeUpload(snapshot: GraphSnapshot, repositoryId: string, commitSha: string): Promise<void> {
  const api = values.api ?? process.env.CODINFLOW_API;
  const token = values.token ?? process.env.CODINFLOW_TOKEN;
  if (!api) return;

  if (!token) fail("--api needs --token (or CODINFLOW_TOKEN). Ingestion is authenticated.");

  const url = `${api.replace(/\/$/, "")}/api/v1/repositories/${encodeURIComponent(repositoryId)}/snapshots/${encodeURIComponent(commitSha)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) fail(`upload failed: ${response.status} ${await response.text()}`);
  console.error(`uploaded → open the app and pick "${repositoryId}"`);
}

function cloneIfRemote(input: string): { dir: string; cloned: boolean } {
  const isRemote = /^(https?:\/\/|git@)/.test(input) || /^[\w.-]+\/[\w.-]+$/.test(input);
  if (!isRemote) return { dir: path.resolve(invocationDir, input), cloned: false };

  const url = input.startsWith("http") || input.startsWith("git@") ? input : `https://github.com/${input}`;
  const dir = mkdtempSync(path.join(tmpdir(), "codinflow-"));

  console.error(`cloning ${url}…`);
  const args = ["clone", "--depth", "1", "--quiet"];
  if (values.branch) args.push("--branch", values.branch);
  args.push(url, dir);
  execFileSync("git", args, { stdio: ["ignore", "ignore", "inherit"] });
  return { dir, cloned: true };
}

function gitSha(dir: string): string | undefined {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function symbolsInFiles(snapshot: GraphSnapshot, files: Set<string>): string[] {
  if (files.size === 0) return [];
  return snapshot.nodes
    .filter((node) => ["function", "method", "class"].includes(node.kind) && node.filePath && files.has(node.filePath))
    .map((node) => node.name)
    .sort();
}

function printQueryHuman(fn: string, reports: ReturnType<typeof buildReport>[], staleness: ReturnType<typeof stalenessFor>): void {
  const banner =
    staleness.verdict === "fresh"
      ? `✓ graph current`
      : staleness.verdict === "stale-affected"
        ? `⚠ graph ${humanAge(staleness.ageSeconds)} old — files this answer depends on CHANGED: ${staleness.affectedFiles.join(", ")}. Re-run with --refresh.`
        : `~ graph ${humanAge(staleness.ageSeconds)} old, but nothing this answer depends on changed.`;
  console.error(`\n${banner}\n`);

  if (reports.length === 0) {
    console.error(`  no function/method/class named "${fn}" in the graph.`);
    if (staleness.verdict !== "fresh") console.error(`  (the graph is stale — it may have been added since; try --refresh.)`);
    console.error("");
    return;
  }

  for (const report of reports) {
    const s = report.symbol;
    console.error(`  ${s.name}${s.exported ? " (exported)" : ""} — ${s.kind}`);
    console.error(`  ${s.description}`);
    if (s.filePath) console.error(`  ${s.filePath}${s.startLine ? `:${s.startLine}` : ""}`);

    if (report.importedBy?.length) {
      console.error(`\n  Imported by (${report.importedBy.length} file${report.importedBy.length === 1 ? "" : "s"}):`);
      for (const group of report.importedBy) {
        console.error(`    ${group.file} — ${group.callers.map((c) => `${c.name}${c.line ? `:${c.line}` : ""}`).join(", ")}`);
      }
    } else if (report.usedBy?.length) {
      console.error(`\n  Used by (${report.usedBy.length} file${report.usedBy.length === 1 ? "" : "s"}):`);
      for (const group of report.usedBy) {
        console.error(`    ${group.file} — ${group.callers.map((c) => c.name).join(", ")}`);
      }
    }

    if (report.calls?.length) {
      console.error(`\n  Calls:`);
      for (const call of report.calls) {
        console.error(`    ${call.guard ? `${call.guard} → ` : "→ "}${call.name}()`);
      }
    }
    console.error("");
  }
}

/** What to do next after an interactive analyze — instead of dumping JSON. */
function analyzeGuidance(snapshot: GraphSnapshot, where: string, cached: boolean): string {
  const exported = snapshot.nodes
    .filter((n) => ["function", "method", "class"].includes(n.kind) && n.visibility === "public")
    .map((n) => n.name);

  const lines = [``];
  if (exported.length > 0) {
    lines.push(`  Exported symbols (${exported.length}): ${exported.slice(0, 8).join(", ")}${exported.length > 8 ? "…" : ""}`, ``);
  }

  if (cached) {
    lines.push(
      `  Explore it (graph cached in ${where}/.codinflow):`,
      `    codinflow query --fn <name> ${where}     who calls / imports a function`,
      `    codinflow status ${where}                 has the code changed since?`,
      ``,
    );
  }

  lines.push(
    `  See it in the visual app (needs an ingest token):`,
    `    codinflow ${where} --api https://codinflow-api.software-93f.workers.dev --token $CODINFLOW_TOKEN`,
    `    then open https://codinflow.software-93f.workers.dev`,
    ``,
    `  Save or pipe the raw graph:  codinflow ${where} --out graph.json   ·   codinflow ${where} --json`,
    ``,
  );

  return lines.join("\n");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function humanAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
