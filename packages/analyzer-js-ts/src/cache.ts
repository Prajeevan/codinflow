import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GraphSnapshot } from "@codinflow/graph-schema";
import { listSourceFiles } from "./program.js";

/**
 * Local warm-graph cache.
 *
 * `analyze` writes the full graph plus a manifest of per-file content hashes. A
 * later `status`/`query` re-hashes the working tree against that manifest to
 * decide, cheaply and without the compiler, whether the cached graph is still
 * good — and exactly which files (and therefore symbols) drifted since.
 */
const CACHE_DIR = ".codinflow";
const GRAPH_FILE = "graph.json";
const MANIFEST_FILE = "manifest.json";

export interface CacheManifest {
  generatedAt: string;
  commitSha: string;
  analyzerVersion: string;
  repositoryId: string;
  /** Repository-relative path → sha256 of the file's content at analysis time. */
  files: Record<string, string>;
}

export interface CachedGraph {
  snapshot: GraphSnapshot;
  manifest: CacheManifest;
}

/** File-level drift between a cached manifest and the current working tree. */
export interface Changes {
  changed: string[];
  added: string[];
  removed: string[];
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function cacheDir(rootDir: string): string {
  return path.join(rootDir, CACHE_DIR);
}

export function writeCache(rootDir: string, snapshot: GraphSnapshot): void {
  const dir = cacheDir(rootDir);
  mkdirSync(dir, { recursive: true });

  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(snapshot.sources ?? {})) {
    files[rel] = hashContent(content);
  }

  const manifest: CacheManifest = {
    generatedAt: snapshot.generatedAt,
    commitSha: snapshot.commitSha,
    analyzerVersion: snapshot.analyzerVersion,
    repositoryId: snapshot.repositoryId,
    files,
  };

  writeFileSync(path.join(dir, GRAPH_FILE), JSON.stringify(snapshot));
  writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

export function readCache(rootDir: string): CachedGraph | null {
  const dir = cacheDir(rootDir);
  const graphPath = path.join(dir, GRAPH_FILE);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!existsSync(graphPath) || !existsSync(manifestPath)) return null;

  try {
    return {
      snapshot: JSON.parse(readFileSync(graphPath, "utf8")) as GraphSnapshot,
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as CacheManifest,
    };
  } catch {
    return null;
  }
}

/**
 * What drifted since the graph was cached.
 *
 * `changed`/`removed` are exact (content hashes of the files the graph was built
 * from). `added` is a best-effort directory walk for source files the manifest
 * never saw — approximate for tsconfig `include`/`exclude` projects, which is
 * why it is reported separately.
 */
export function detectChanges(rootDir: string, manifest: CacheManifest): Changes {
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [rel, previous] of Object.entries(manifest.files)) {
    const absolute = path.join(rootDir, rel);
    if (!existsSync(absolute)) {
      removed.push(rel);
      continue;
    }
    if (hashContent(readFileSync(absolute, "utf8")) !== previous) changed.push(rel);
  }

  const known = new Set(Object.keys(manifest.files));
  const added = listSourceFiles(rootDir).filter((rel) => !known.has(rel));

  return {
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
  };
}

export function hasDrift(changes: Changes): boolean {
  return changes.changed.length > 0 || changes.added.length > 0 || changes.removed.length > 0;
}
