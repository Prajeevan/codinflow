import type { GraphNode, GraphSnapshot } from "@codinflow/graph-schema";
import { guardText } from "./query.js";

/**
 * `codinflow impact` — transitive blast radius of changing a symbol or file.
 *
 * Walks incoming caller edges (calls/awaits/routes_to/runs_before) from the
 * target until it runs out of callers, then adds the files that import the
 * target's file (their type-checking is invalidated by a signature change).
 * Everything reported is a proven edge, not a guess.
 */

const CALLER_EDGES = new Set(["calls", "awaits", "routes_to"]);
const SYMBOL_KINDS = new Set(["function", "method", "class"]);

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export interface ImpactCaller {
  id: string;
  name: string;
  kind: string;
  filePath?: string;
  line?: number;
  /** Guard on the edge that first reached this caller, if conditional. */
  guard?: string;
  /** 1 = calls the target directly, 2 = calls a direct caller, … */
  depth: number;
}

export interface ImpactReport {
  target: {
    id: string;
    name: string;
    kind: string;
    filePath?: string;
    startLine?: number;
    exported: boolean;
  };
  /** Transitive callers, breadth-first — routes included. */
  callers: ImpactCaller[];
  /** Routes from which the target is reachable. */
  affectedRoutes: Array<{ name: string; framework?: string; file?: string }>;
  /** Files that import the target's file — a signature change invalidates them. */
  importers: string[];
  /** Union: target file + caller files + importers. */
  affectedFiles: string[];
  testFiles: string[];
  guardedCallerCount: number;
  maxDepthReached: number;
  relevantFiles: string[];
}

export function buildImpact(snapshot: GraphSnapshot, target: GraphNode, maxDepth = 12): ImpactReport {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

  // Impact of a file = impact of every symbol defined in it.
  const seeds =
    target.kind === "file"
      ? snapshot.nodes.filter((node) => SYMBOL_KINDS.has(node.kind) && node.filePath === target.filePath)
      : [target];

  // Who is affected by a change to node X:
  //   A --calls/awaits--> X        → A (the caller) — walk the edge backwards.
  //   route --routes_to--> X       → the route — backwards too.
  //   X --runs_before--> route     → the route (its behaviour depends on the
  //     middleware), NOT the other way — so runs_before is walked FORWARDS.
  const affectedBy = new Map<string, Array<{ edge: (typeof snapshot.edges)[number]; affectedId: string }>>();
  const index = (key: string, edge: (typeof snapshot.edges)[number], affectedId: string): void => {
    const list = affectedBy.get(key) ?? [];
    list.push({ edge, affectedId });
    affectedBy.set(key, list);
  };
  for (const edge of snapshot.edges) {
    if (CALLER_EDGES.has(edge.kind)) index(edge.targetNodeId, edge, edge.sourceNodeId);
    else if (edge.kind === "runs_before") index(edge.sourceNodeId, edge, edge.targetNodeId);
  }

  const visited = new Set(seeds.map((seed) => seed.id));
  const callers: ImpactCaller[] = [];
  let frontier = seeds.map((seed) => seed.id);
  let depth = 0;
  let maxDepthReached = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const { edge, affectedId } of affectedBy.get(id) ?? []) {
        if (visited.has(affectedId)) continue;
        visited.add(affectedId);
        const caller = byId.get(affectedId);
        if (!caller || caller.kind === "application") continue;
        callers.push({
          id: caller.id,
          name: caller.name,
          kind: caller.kind,
          filePath: caller.filePath,
          line: edge.sourceLocation?.line,
          guard: guardText(edge),
          depth,
        });
        maxDepthReached = depth;
        next.push(caller.id);
      }
    }
    frontier = next;
  }

  const affectedRoutes = callers
    .filter((caller) => caller.kind === "route")
    .map((caller) => {
      const node = byId.get(caller.id);
      return {
        name: caller.name,
        framework: typeof node?.metadata?.framework === "string" ? node.metadata.framework : undefined,
        file: caller.filePath,
      };
    });

  // File-level import dependents of the target's file.
  const targetFilePaths = new Set(seeds.map((seed) => seed.filePath).filter((p): p is string => p !== undefined));
  if (target.filePath) targetFilePaths.add(target.filePath);
  const fileNodeIds = new Set(
    snapshot.nodes.filter((node) => node.kind === "file" && node.filePath && targetFilePaths.has(node.filePath)).map((n) => n.id),
  );
  const importers = [
    ...new Set(
      snapshot.edges
        .filter((edge) => edge.kind === "imports" && fileNodeIds.has(edge.targetNodeId))
        .map((edge) => byId.get(edge.sourceNodeId)?.filePath)
        .filter((filePath): filePath is string => filePath !== undefined),
    ),
  ].sort();

  const affectedFiles = [
    ...new Set([
      ...targetFilePaths,
      ...callers.map((caller) => caller.filePath).filter((filePath): filePath is string => filePath !== undefined),
      ...importers,
    ]),
  ].sort();

  return {
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      filePath: target.filePath,
      startLine: target.source?.startLine,
      exported: target.visibility === "public" || target.metadata?.exported === true,
    },
    callers,
    affectedRoutes,
    importers,
    affectedFiles,
    testFiles: affectedFiles.filter((filePath) => TEST_FILE.test(filePath)),
    guardedCallerCount: callers.filter((caller) => caller.guard !== undefined).length,
    maxDepthReached,
    relevantFiles: affectedFiles,
  };
}
