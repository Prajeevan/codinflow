import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isSourceFile } from "@codinflow/analyzer-core";
import type { AnalysisWarning, RepositoryFramework } from "@codinflow/graph-schema";

export interface LoadedProject {
  program: ts.Program;
  checker: ts.TypeChecker;
  rootDir: string;
  /** tsconfig `paths` prefixes — these point at the app's own source. */
  pathAliases: string[];
  frameworks: RepositoryFramework[];
  entryPoints: string[];
  warnings: AnalysisWarning[];
}

interface PackageJson {
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Order matters: more specific frameworks (SvelteKit, TanStack Start) are listed
// before their base library (Svelte, TanStack Router) so both chips can appear.
const FRAMEWORK_SIGNATURES: Array<{ dependency: string; name: string }> = [
  { dependency: "express", name: "Express" },
  { dependency: "hono", name: "Hono" },
  { dependency: "fastify", name: "Fastify" },
  { dependency: "@nestjs/core", name: "NestJS" },
  { dependency: "next", name: "Next.js" },
  { dependency: "react", name: "React" },
  { dependency: "@remix-run/node", name: "Remix" },
  { dependency: "@remix-run/react", name: "Remix" },
  { dependency: "@tanstack/react-start", name: "TanStack Start" },
  { dependency: "@tanstack/start", name: "TanStack Start" },
  { dependency: "@tanstack/react-router", name: "TanStack Router" },
  { dependency: "@sveltejs/kit", name: "SvelteKit" },
  { dependency: "svelte", name: "Svelte" },
  { dependency: "vue", name: "Vue" },
  { dependency: "nuxt", name: "Nuxt" },
];

/**
 * Loads a repository as a TypeScript Program.
 *
 * Repository lifecycle scripts are never executed and a broken or missing
 * tsconfig falls back to permissive defaults rather than failing the analysis —
 * real JavaScript repositories frequently have neither.
 */
export function loadProject(rootDir: string): LoadedProject {
  const warnings: AnalysisWarning[] = [];
  const absoluteRoot = path.resolve(rootDir);
  const tsconfigPath = ts.findConfigFile(absoluteRoot, ts.sys.fileExists, "tsconfig.json");

  let fileNames: string[] = [];
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };

  if (tsconfigPath && tsconfigPath.startsWith(absoluteRoot)) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (configFile.error) {
      warnings.push({
        code: "TSCONFIG_UNREADABLE",
        message: ts.flattenDiagnosticMessageText(configFile.error.messageText, " "),
        filePath: tsconfigPath,
      });
    } else {
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));

      if (parsed.errors.length > 0) {
        warnings.push({
          code: "TSCONFIG_INVALID",
          message: parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; "),
          filePath: tsconfigPath,
        });
      }

      fileNames = parsed.fileNames;
      options = { ...parsed.options, allowJs: true, noEmit: true, skipLibCheck: true };
    }
  } else {
    warnings.push({
      code: "TSCONFIG_MISSING",
      message: "No tsconfig.json found; analyzing with permissive JavaScript defaults.",
    });
  }

  if (fileNames.length === 0) {
    fileNames = discoverSourceFiles(absoluteRoot);
  }

  const relevant = fileNames.filter((file) => isSourceFile(path.relative(absoluteRoot, file)));
  const program = ts.createProgram({ rootNames: relevant, options });

  return {
    program,
    checker: program.getTypeChecker(),
    rootDir: absoluteRoot,
    pathAliases: Object.keys(options.paths ?? {}).map((pattern) => pattern.replace(/\*$/, "")),
    frameworks: detectFrameworks(absoluteRoot, warnings),
    entryPoints: detectEntryPoints(absoluteRoot, relevant),
    warnings,
  };
}

/**
 * Repository-relative source files, discovered without building a Program.
 *
 * Used by staleness checks to spot files added since a graph was cached, cheaply
 * — no type-checking, just a directory walk with the same ignore rules.
 */
export function listSourceFiles(rootDir: string): string[] {
  const absoluteRoot = path.resolve(rootDir);
  return discoverSourceFiles(absoluteRoot).map((file) => path.relative(absoluteRoot, file));
}

function discoverSourceFiles(rootDir: string): string[] {
  const entries = ts.sys.readDirectory(
    rootDir,
    [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    ["node_modules", "dist", "build", "out", ".next", ".turbo", "coverage", "vendor"],
    ["**/*"],
  );
  return entries.filter((entry) => isSourceFile(path.relative(rootDir, entry)));
}

function readPackageJson(rootDir: string): PackageJson | undefined {
  const packagePath = path.join(rootDir, "package.json");
  if (!existsSync(packagePath)) return undefined;
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

/**
 * Every dependency declared in the repository, including one level of workspace
 * packages (`apps/*`, `packages/*`). A Turborepo/pnpm monorepo declares `next`
 * in `apps/web/package.json`, not at the root, so reading only the root would
 * detect no framework and skip route extraction entirely.
 */
function collectDependencies(rootDir: string): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let found = false;

  const absorb = (dir: string): void => {
    const packageJson = readPackageJson(dir);
    if (!packageJson) return;
    found = true;
    Object.assign(merged, packageJson.dependencies, packageJson.devDependencies);
  };

  absorb(rootDir);
  for (const workspace of ["apps", "packages"]) {
    const workspaceDir = path.join(rootDir, workspace);
    if (!existsSync(workspaceDir)) continue;
    try {
      for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
        if (entry.isDirectory()) absorb(path.join(workspaceDir, entry.name));
      }
    } catch {
      /* unreadable workspace dir; the root deps still count */
    }
  }

  return found ? merged : undefined;
}

function detectFrameworks(rootDir: string, warnings: AnalysisWarning[]): RepositoryFramework[] {
  const dependencies = collectDependencies(rootDir);

  if (!dependencies) {
    warnings.push({ code: "PACKAGE_JSON_MISSING", message: "No package.json; framework detection skipped." });
    return [];
  }

  // Some frameworks have several package signatures (Remix ships split packages);
  // keep only the first match per framework name so a chip is not shown twice.
  const seen = new Set<string>();
  const frameworks: RepositoryFramework[] = [];
  for (const signature of FRAMEWORK_SIGNATURES) {
    if (!(signature.dependency in dependencies) || seen.has(signature.name)) continue;
    seen.add(signature.name);
    frameworks.push({
      name: signature.name,
      confidence: 0.95,
      evidence: `package.json declares "${signature.dependency}"`,
    });
  }
  return frameworks;
}

function detectEntryPoints(rootDir: string, files: string[]): string[] {
  const packageJson = readPackageJson(rootDir);
  const candidates = new Set<string>();

  for (const declared of [packageJson?.main, packageJson?.module]) {
    if (declared) {
      candidates.add(path.relative(rootDir, path.resolve(rootDir, declared)));
    }
  }

  for (const conventional of ["src/index.ts", "src/index.js", "src/main.ts", "src/server.ts", "src/worker.ts"]) {
    if (files.some((file) => path.relative(rootDir, file) === conventional)) {
      candidates.add(conventional);
    }
  }

  return [...candidates];
}
