/**
 * Repositories are untrusted input (BRIEF §8, §16). These limits and ignore
 * rules bound what the analyzer will read at all.
 */

export const ANALYSIS_LIMITS = {
  maxFileBytes: 1_000_000,
  maxFileCount: 20_000,
  maxTotalBytes: 200_000_000,
  maxAnalysisMs: 300_000,
} as const;

const IGNORED_DIRECTORIES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".wrangler",
  "coverage",
  "vendor",
  ".venv",
];

const IGNORED_PATTERNS = [/\.min\.js$/, /\.bundle\.js$/, /\.d\.ts$/, /\.map$/, /-lock\.(json|yaml)$/];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function shouldIgnorePath(relativePath: string): boolean {
  const segments = relativePath.split("/");

  if (segments.some((segment) => IGNORED_DIRECTORIES.includes(segment))) {
    return true;
  }

  return IGNORED_PATTERNS.some((pattern) => pattern.test(relativePath));
}

export function isSourceFile(relativePath: string): boolean {
  if (shouldIgnorePath(relativePath)) {
    return false;
  }
  return SOURCE_EXTENSIONS.some((extension) => relativePath.endsWith(extension));
}

export function isTestFile(relativePath: string): boolean {
  return /(\.|-)(test|spec)\.[cm]?[jt]sx?$/.test(relativePath) || relativePath.includes("__tests__/");
}
