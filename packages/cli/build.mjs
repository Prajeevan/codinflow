import { build } from "esbuild";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

// Bundle the analyzer CLI (and its workspace dependencies) into a single file so
// the published package runs via `npx` / `bunx` / `pnpm dlx` with no workspace
// linking. `typescript` stays external — it is a declared runtime dependency.
await build({
  entryPoints: ["../analyzer-js-ts/src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  external: ["typescript"],
  logLevel: "info",
});

// Guarantee exactly one shebang, whatever esbuild does with the source one.
let code = readFileSync("dist/cli.js", "utf8").replace(/^#![^\n]*\n/, "");
writeFileSync("dist/cli.js", `#!/usr/bin/env node\n${code}`);
chmodSync("dist/cli.js", 0o755);
