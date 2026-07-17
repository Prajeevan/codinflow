#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyzeRepository } from "./extract.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "repository-id": { type: "string" },
    "commit-sha": { type: "string" },
    out: { type: "string" },
    api: { type: "string" },
    token: { type: "string" },
    branch: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const USAGE = `
codinflow — analyze a JavaScript/TypeScript repository into a behaviour graph

  analyze <path-or-github-url> [options]

Options
  --repository-id <id>   Name it in the UI (default: folder or repo name)
  --commit-sha <sha>     Commit to label this snapshot (default: current git HEAD)
  --branch <name>        Branch to clone, for a GitHub URL
  --out <file>           Write the graph JSON here
  --api <url>            Upload to a CodinFlow API and make it visible in the app
  --token <token>        Bearer token for --api (or set CODINFLOW_TOKEN)

Examples
  # a local folder, uploaded to the hosted app
  codinflow analyze ./my-app --api https://codinflow-api.software-93f.workers.dev --token $CODINFLOW_TOKEN

  # a public GitHub repository
  codinflow analyze https://github.com/honojs/hono --api $CODINFLOW_API --token $CODINFLOW_TOKEN

  # just write the graph to a file
  codinflow analyze ./my-app --out graph.json
`;

// `analyze` is an optional leading verb: `codinflow analyze <path>` and
// `codinflow <path>` both work, so following the help text can never fail.
const operands = positionals[0] === "analyze" ? positionals.slice(1) : positionals;

if (values.help || operands.length === 0) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const target = operands[0]!;

/**
 * The directory the user actually typed the command in.
 *
 * A package manager runs scripts with cwd set to the package, so a relative path
 * the user passed would otherwise resolve against the wrong directory. INIT_CWD
 * is where they were standing.
 */
const invocationDir = process.env.INIT_CWD ?? process.cwd();

/**
 * Clones a GitHub repository shallowly.
 *
 * `--depth 1` keeps the fetch small, and no repository script is ever executed:
 * we clone and parse, never install or build.
 */
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

if (values.out) {
  const outPath = path.resolve(invocationDir, values.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.error(`wrote ${outPath}`);
}

const api = values.api ?? process.env.CODINFLOW_API;
const token = values.token ?? process.env.CODINFLOW_TOKEN;

if (api) {
  if (!token) {
    console.error("--api needs --token (or CODINFLOW_TOKEN). Ingestion is authenticated.");
    process.exit(1);
  }

  const url = `${api.replace(/\/$/, "")}/api/v1/repositories/${encodeURIComponent(repositoryId)}/snapshots/${encodeURIComponent(commitSha)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    console.error(`upload failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  console.error(`uploaded → open the app and pick "${repositoryId}"`);
}

if (!values.out && !api) {
  process.stdout.write(JSON.stringify(snapshot, null, 2));
}

if (cloned) {
  console.error(`(clone left in ${rootDir})`);
}
