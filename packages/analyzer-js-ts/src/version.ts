/** Bump when extraction behaviour changes; snapshots record this (BRIEF rule 15). */
export const ANALYZER_NAME = "analyzer-js-ts";
export const ANALYZER_VERSION = "0.2.0";

/**
 * The published `codinflow` CLI version. esbuild replaces
 * `__CODINFLOW_CLI_VERSION__` with the package.json version at build time (see
 * packages/cli/build.mjs); running from source (tsx) leaves it undefined, so we
 * fall back to "dev".
 */
declare const __CODINFLOW_CLI_VERSION__: string | undefined;
export const CLI_VERSION: string =
  typeof __CODINFLOW_CLI_VERSION__ !== "undefined" ? __CODINFLOW_CLI_VERSION__ : "dev";
