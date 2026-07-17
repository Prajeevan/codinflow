import type { GraphEdge, GraphNode, GraphSnapshot } from "@codinflow/graph-schema";
import type { Changes } from "./cache.js";

/** Relationship views a query can ask for. */
export type OutputKind = "calls" | "usedBy" | "importedBy" | "reads" | "writes" | "throws" | "external";

export const DEFAULT_OUTPUTS: OutputKind[] = ["calls", "usedBy", "importedBy"];
const KNOWN_OUTPUTS = new Set<OutputKind>(["calls", "usedBy", "importedBy", "reads", "writes", "throws", "external"]);

const CALLABLE = new Set(["function", "method", "class"]);
const CALLER_EDGES = new Set(["calls", "awaits", "routes_to", "runs_before"]);

export interface CallOut {
  id: string;
  name: string;
  filePath?: string;
  line?: number;
  guard?: string;
  conditional: boolean;
}

export interface FileGroup {
  file: string;
  callers: Array<{ id: string; name: string; line?: number }>;
}

export interface SymbolRef {
  id: string;
  name: string;
  kind: string;
  filePath?: string;
  line?: number;
}

export interface SymbolReport {
  symbol: {
    id: string;
    name: string;
    qualifiedName?: string;
    kind: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    exported: boolean;
    signature?: string;
    description: string;
  };
  calls?: CallOut[];
  usedBy?: FileGroup[];
  importedBy?: FileGroup[];
  reads?: SymbolRef[];
  writes?: SymbolRef[];
  throws?: SymbolRef[];
  external?: SymbolRef[];
  /** Files this report depends on — used to decide whether drift affects it. */
  relevantFiles: string[];
}

export function parseOutputs(raw: string | undefined): OutputKind[] {
  if (!raw) return DEFAULT_OUTPUTS;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean) as OutputKind[];
  const valid = parts.filter((part) => KNOWN_OUTPUTS.has(part));
  return valid.length > 0 ? valid : DEFAULT_OUTPUTS;
}

/** Function/method/class nodes matching a name (a trailing `()` is tolerated). */
export function findSymbols(snapshot: GraphSnapshot, query: string): GraphNode[] {
  const bare = query.replace(/\(\)\s*$/, "").trim();
  return snapshot.nodes.filter(
    (node) => CALLABLE.has(node.kind) && (node.name === bare || node.qualifiedName === bare),
  );
}

export function buildReport(snapshot: GraphSnapshot, node: GraphNode, outputs: OutputKind[]): SymbolReport {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const outgoing = snapshot.edges.filter((edge) => edge.sourceNodeId === node.id);
  const incoming = snapshot.edges.filter((edge) => edge.targetNodeId === node.id);
  const want = new Set(outputs);
  const exported = node.visibility === "public" || node.metadata?.exported === true;

  const relevant = new Set<string>();
  if (node.filePath) relevant.add(node.filePath);

  const report: SymbolReport = {
    symbol: {
      id: node.id,
      name: node.name,
      qualifiedName: node.qualifiedName,
      kind: node.kind,
      filePath: node.filePath,
      startLine: node.source?.startLine,
      endLine: node.source?.endLine,
      exported,
      signature: node.signature,
      description: node.summary ?? describe(node),
    },
    relevantFiles: [],
  };

  if (want.has("calls")) {
    report.calls = outgoing
      .filter((edge) => (edge.kind === "calls" || edge.kind === "awaits") && CALLABLE.has(byId.get(edge.targetNodeId)?.kind ?? ""))
      .map((edge) => {
        const target = byId.get(edge.targetNodeId)!;
        if (target.filePath) relevant.add(target.filePath);
        return {
          id: target.id,
          name: target.name,
          filePath: target.filePath,
          line: edge.sourceLocation?.line,
          guard: edge.metadata?.conditional ? edge.label : undefined,
          conditional: edge.metadata?.conditional === true,
        };
      });
  }

  if (want.has("usedBy") || want.has("importedBy")) {
    const callers = incoming.filter((edge) => CALLER_EDGES.has(edge.kind));
    const grouped = groupByFile(callers, byId);
    for (const group of grouped) relevant.add(group.file);
    if (want.has("usedBy")) report.usedBy = grouped;
    // "Imported by" is the same call sites, framed for an export: any file that
    // calls an exported symbol must import it.
    if (want.has("importedBy")) report.importedBy = grouped;
  }

  if (want.has("reads")) report.reads = refs(outgoing.filter((e) => e.kind === "reads"), byId);
  if (want.has("writes")) report.writes = refs(outgoing.filter((e) => e.kind === "writes"), byId);
  if (want.has("throws")) report.throws = refs(outgoing.filter((e) => e.kind === "throws"), byId);
  if (want.has("external")) {
    report.external = refs(
      outgoing.filter((e) => byId.get(e.targetNodeId)?.kind === "external_api"),
      byId,
    );
  }

  report.relevantFiles = [...relevant].sort();
  return report;
}

export type Verdict = "fresh" | "stale-unaffected" | "stale-affected";

export interface Staleness {
  verdict: Verdict;
  graphGeneratedAt: string;
  ageSeconds: number;
  changed: string[];
  added: string[];
  removed: string[];
  /** The subset of changed/added/removed files this report actually depends on. */
  affectedFiles: string[];
}

export function stalenessFor(
  changes: Changes,
  generatedAt: string,
  nowMs: number,
  relevantFiles: string[],
): Staleness {
  const drifted = new Set([...changes.changed, ...changes.added, ...changes.removed]);
  const relevant = new Set(relevantFiles);
  const affectedFiles = [...drifted].filter((file) => relevant.has(file)).sort();
  const anyDrift = drifted.size > 0;

  const verdict: Verdict = affectedFiles.length > 0 ? "stale-affected" : anyDrift ? "stale-unaffected" : "fresh";

  return {
    verdict,
    graphGeneratedAt: generatedAt,
    ageSeconds: Math.max(0, Math.round((nowMs - Date.parse(generatedAt)) / 1000)),
    changed: changes.changed,
    added: changes.added,
    removed: changes.removed,
    affectedFiles,
  };
}

function groupByFile(edges: GraphEdge[], byId: Map<string, GraphNode>): FileGroup[] {
  const groups = new Map<string, FileGroup["callers"]>();
  for (const edge of edges) {
    const caller = byId.get(edge.sourceNodeId);
    const file = caller?.filePath ?? edge.sourceLocation?.filePath ?? "unknown";
    const list = groups.get(file) ?? [];
    list.push({ id: caller?.id ?? edge.sourceNodeId, name: caller?.name ?? "unknown", line: edge.sourceLocation?.line });
    groups.set(file, list);
  }
  return [...groups.entries()].map(([file, callers]) => ({ file, callers }));
}

function refs(edges: GraphEdge[], byId: Map<string, GraphNode>): SymbolRef[] {
  return edges.map((edge) => {
    const target = byId.get(edge.targetNodeId);
    return {
      id: edge.targetNodeId,
      name: target?.name ?? "unknown",
      kind: target?.kind ?? "unknown",
      filePath: target?.filePath,
      line: edge.sourceLocation?.line,
    };
  });
}

/** A factual one-line description from proven facts (mirrors the canvas card). */
function describe(node: GraphNode): string {
  const parts: string[] = [];
  const tags = new Set(node.tags);
  if (tags.has("authentication")) parts.push("auth-gated");
  if (tags.has("writes-database")) parts.push("writes data");
  else if (tags.has("reads-database")) parts.push("reads data");
  if (tags.has("calls-external-api")) parts.push("calls external API");
  if (tags.has("validation")) parts.push("validates input");

  const match = node.signature?.match(/\):\s*(.+)$/);
  const returnType = match?.[1]?.trim();
  if (returnType && !/^(void|Promise<void>|undefined)$/.test(returnType)) {
    parts.push(/\b(JSX\.Element|ReactElement|ReactNode|Element)\b/.test(returnType) ? "returns JSX" : `returns ${returnType}`);
  }

  return parts.join(" · ") || node.kind.replace(/_/g, " ");
}
