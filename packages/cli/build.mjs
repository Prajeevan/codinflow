import { execSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Resolve everything relative to this file, so the build works from any CWD.
const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(pkgDir, "..", "..");
const skipWeb = process.argv.includes("--skip-web");

// 1. Build the canvas app in embedded mode (same-origin API) and vendor it into
//    the package as ./web, so `codinflow --ui` serves it with no hosted backend.
if (!skipWeb) {
  execSync("pnpm --filter @codinflow/web run build:embedded", { cwd: repoRoot, stdio: "inherit" });
  const embeddedDist = path.join(repoRoot, "apps", "web", "dist-embedded");
  if (!existsSync(path.join(embeddedDist, "index.html"))) {
    throw new Error(`embedded web build produced no index.html at ${embeddedDist}`);
  }
  rmSync(path.join(pkgDir, "web"), { recursive: true, force: true });
  cpSync(embeddedDist, path.join(pkgDir, "web"), { recursive: true });
}

// 2. Bundle the CLI (and its workspace deps) into one file. `typescript` stays
//    external — it is a declared runtime dependency. The package version is baked
//    in so `codinflow --version` reports the real published version.
const cliVersion = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
await build({
  entryPoints: [path.join(pkgDir, "..", "analyzer-js-ts", "src", "cli.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(pkgDir, "dist", "cli.js"),
  external: ["typescript"],
  define: { __CODINFLOW_CLI_VERSION__: JSON.stringify(cliVersion) },
  logLevel: "info",
});

// Guarantee exactly one shebang, whatever esbuild does with the source one.
const out = path.join(pkgDir, "dist", "cli.js");
const code = readFileSync(out, "utf8").replace(/^#![^\n]*\n/, "");
writeFileSync(out, `#!/usr/bin/env node\n${code}`);
chmodSync(out, 0o755);
