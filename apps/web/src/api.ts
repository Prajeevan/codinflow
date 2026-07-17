import type { GraphEdge, GraphNode, GraphView } from "@codinflow/graph-schema";

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface Overview {
  repositoryId: string;
  commitSha: string;
  analyzerVersion: string;
  schemaVersion: string;
  generatedAt: string;
  frameworks: Array<{ name: string; confidence: number; evidence: string }>;
  entryPoints: string[];
  stats: {
    fileCount: number;
    functionCount: number;
    classCount: number;
    routeCount: number;
    externalApiCount: number;
    databaseCount: number;
    resolvedCallRatio: number;
  };
  warnings: Array<{ code: string; message: string }>;
  routes: Array<{
    id: string;
    name: string;
    filePath?: string;
    httpMethod?: string;
    framework?: string;
    routeType?: string;
  }>;
  externalSystems: Array<{ id: string; name: string; kind: string }>;
  environmentVariables: string[];
  riskiestFunctions: Array<{ id: string; name: string; tags: string[] }>;
  analysisConfidence: { resolvedCallRatio: number; unresolvedDynamicCalls: number };
}

export interface NodeDetail {
  node: GraphNode;
  incoming: Array<{ edge: GraphEdge; node?: GraphNode }>;
  outgoing: Array<{ edge: GraphEdge; node?: GraphNode }>;
}

export interface SearchResult {
  id: string;
  kind: string;
  name: string;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  tags: string;
}

export interface DiffChange {
  kind: string;
  removed?: boolean;
  nodeId?: string;
  edgeId?: string;
  name: string;
  detail: string;
  filePath?: string;
  line?: number;
}

export interface Diff {
  baseSha: string;
  headSha: string;
  changes: DiffChange[];
  blastRadius: Array<{ nodeId: string; name: string; level: string; reason: string }>;
  summary: string;
  riskLevel: "low" | "medium" | "high";
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const api = {
  overview: (repositoryId: string, commitSha?: string) =>
    request<Overview>(`/api/v1/repositories/${repositoryId}/overview${query({ commitSha })}`),

  graph: (repositoryId: string, params: Record<string, string | number | boolean | undefined>) =>
    request<GraphView>(`/api/v1/repositories/${repositoryId}/graph${query(params)}`),

  path: (repositoryId: string, routeId: string, commitSha?: string) =>
    request<GraphView>(
      `/api/v1/repositories/${repositoryId}/paths/${encodeURIComponent(routeId)}${query({ commitSha })}`,
    ),

  node: (repositoryId: string, nodeId: string, commitSha?: string) =>
    request<NodeDetail>(
      `/api/v1/repositories/${repositoryId}/nodes/${encodeURIComponent(nodeId)}${query({ commitSha })}`,
    ),

  search: (repositoryId: string, q: string, commitSha?: string) =>
    request<{ results: SearchResult[] }>(`/api/v1/repositories/${repositoryId}/search${query({ q, commitSha })}`),

  diff: (repositoryId: string, base: string, head: string) =>
    request<Diff>(`/api/v1/repositories/${repositoryId}/diff${query({ base, head })}`),

  source: (repositoryId: string, filePath: string, commitSha?: string) =>
    request<{ filePath: string; commitSha: string; content: string }>(
      `/api/v1/repositories/${repositoryId}/source${query({ filePath, commitSha })}`,
    ),

  repositories: () =>
    request<{ repositories: Array<{ id: string; full_name: string; commit_sha: string | null; node_count: number | null }> }>(
      `/api/v1/repositories`,
    ),

  commits: (repositoryId: string) =>
    request<{ commits: Array<{ commit_sha: string; node_count: number; created_at: string }> }>(
      `/api/v1/repositories/${repositoryId}/commits`,
    ),
};

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}
