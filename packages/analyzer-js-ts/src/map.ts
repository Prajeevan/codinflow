import type { GraphSnapshot, GraphStats } from "@codinflow/graph-schema";

/**
 * `codinflow map` — one-shot repository orientation.
 *
 * Everything here is aggregation over the snapshot; no new analysis. The point
 * is that an agent's first command in an unfamiliar repo returns the shape of
 * the codebase (routes, hotspots, boundaries) instead of twenty file reads.
 */

const SYMBOL_KINDS = new Set(["function", "method", "class"]);
const TRAFFIC_EDGES = new Set(["calls", "awaits", "imports", "routes_to", "runs_before"]);

/** Notable tags → the short trait words shown on a file line. */
const TRAIT_WORDS: Record<string, string> = {
  authentication: "auth",
  "writes-database": "writes db",
  "reads-database": "reads db",
  "calls-external-api": "external API",
  validation: "validation",
  "emits-event": "events",
  "uses-env-var": "env",
};

export interface MapRoute {
  method?: string;
  path?: string;
  name: string;
  framework: string;
  routeType?: string;
  file?: string;
  handler?: string;
}

export interface MapFile {
  path: string;
  lineCount?: number;
  symbolCount: number;
  exports: string[];
  traits: string[];
  routeCount: number;
  fanIn: number;
  fanOut: number;
}

export interface RepoMap {
  repositoryId: string;
  commitSha: string;
  generatedAt: string;
  frameworks: string[];
  entryPoints: string[];
  stats: GraphStats;
  routesByFramework: Record<string, MapRoute[]>;
  /** All application files, ordered by cross-file traffic (fanIn + fanOut). */
  files: MapFile[];
  externalSystems: Array<{ name: string; kind: string }>;
  dependencies: string[];
  environmentVariables: string[];
  warningCount: number;
}

export function buildMap(snapshot: GraphSnapshot): RepoMap {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const files = new Map<string, MapFile>();
  for (const node of snapshot.nodes) {
    if (node.kind !== "file" || !node.filePath) continue;
    files.set(node.filePath, {
      path: node.filePath,
      lineCount: typeof node.metadata?.lineCount === "number" ? node.metadata.lineCount : undefined,
      symbolCount: 0,
      exports: [],
      traits: [],
      routeCount: 0,
      fanIn: 0,
      fanOut: 0,
    });
  }

  const traitSets = new Map<string, Set<string>>();
  for (const node of snapshot.nodes) {
    if (!node.filePath || !SYMBOL_KINDS.has(node.kind)) continue;
    const file = files.get(node.filePath);
    if (!file) continue;
    file.symbolCount += 1;
    if (node.visibility === "public") file.exports.push(node.name);
    const traits = traitSets.get(node.filePath) ?? new Set<string>();
    for (const tag of node.tags) if (TRAIT_WORDS[tag]) traits.add(TRAIT_WORDS[tag]);
    traitSets.set(node.filePath, traits);
  }
  for (const [filePath, traits] of traitSets) {
    const file = files.get(filePath);
    if (file) file.traits = [...traits];
  }

  // Cross-file traffic: an edge whose endpoints live in different files.
  for (const edge of snapshot.edges) {
    if (!TRAFFIC_EDGES.has(edge.kind)) continue;
    const sourceFile = byId.get(edge.sourceNodeId)?.filePath;
    const targetFile = byId.get(edge.targetNodeId)?.filePath;
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue;
    const source = files.get(sourceFile);
    const target = files.get(targetFile);
    if (source) source.fanOut += 1;
    if (target) target.fanIn += 1;
  }

  const handlerByRoute = new Map<string, string>();
  for (const edge of snapshot.edges) {
    if (edge.kind !== "routes_to") continue;
    const handler = byId.get(edge.targetNodeId);
    if (handler) handlerByRoute.set(edge.sourceNodeId, handler.name);
  }

  const routesByFramework: Record<string, MapRoute[]> = {};
  for (const node of snapshot.nodes) {
    if (node.kind !== "route") continue;
    const framework = typeof node.metadata?.framework === "string" ? node.metadata.framework : "unknown";
    const route: MapRoute = {
      method: typeof node.metadata?.httpMethod === "string" ? node.metadata.httpMethod : undefined,
      path: typeof node.metadata?.path === "string" ? node.metadata.path : undefined,
      name: node.name,
      framework,
      routeType: typeof node.metadata?.routeType === "string" ? node.metadata.routeType : undefined,
      file: node.filePath,
      handler: handlerByRoute.get(node.id),
    };
    (routesByFramework[framework] ??= []).push(route);
    if (node.filePath) {
      const file = files.get(node.filePath);
      if (file) file.routeCount += 1;
    }
  }

  return {
    repositoryId: snapshot.repositoryId,
    commitSha: snapshot.commitSha,
    generatedAt: snapshot.generatedAt,
    frameworks: snapshot.frameworks.map((framework) => framework.name),
    entryPoints: snapshot.entryPoints,
    stats: snapshot.stats,
    routesByFramework,
    files: [...files.values()].sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut)),
    externalSystems: snapshot.nodes
      .filter((node) => !node.applicationOwned && node.kind !== "module")
      .map((node) => ({ name: node.name, kind: node.kind })),
    dependencies: snapshot.nodes.filter((node) => !node.applicationOwned && node.kind === "module").map((node) => node.name),
    environmentVariables: snapshot.nodes.filter((node) => node.kind === "environment_variable").map((node) => node.name),
    warningCount: snapshot.warnings.length,
  };
}

/** Every file the map depends on — any drift makes the map stale-affected. */
export function mapRelevantFiles(map: RepoMap): string[] {
  return map.files.map((file) => file.path).sort();
}
