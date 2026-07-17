import type {
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  GraphView,
  NeighbourhoodQuery,
} from "@codinflow/graph-schema";

/** R2 keys are tenant-scoped so one repository can never read another's graph. */
export function snapshotKey(repositoryId: string, commitSha: string): string {
  return `graphs/${repositoryId}/${commitSha}.json`;
}

const DEFAULT_MAX_NODES = 300;
const HARD_MAX_NODES = 2000;

export class GraphStore {
  constructor(private readonly artifacts: R2Bucket) {}

  async put(snapshot: GraphSnapshot): Promise<string> {
    const key = snapshotKey(snapshot.repositoryId, snapshot.commitSha);
    await this.artifacts.put(key, JSON.stringify(snapshot), {
      httpMetadata: { contentType: "application/json" },
    });
    return key;
  }

  async get(repositoryId: string, commitSha: string): Promise<GraphSnapshot | null> {
    const object = await this.artifacts.get(snapshotKey(repositoryId, commitSha));
    if (!object) return null;
    return (await object.json()) as GraphSnapshot;
  }
}

/**
 * Selects a bounded view of a snapshot.
 *
 * Every graph response goes through here: there is deliberately no path that
 * returns an entire repository graph to a browser (BRIEF §15).
 */
export function selectView(snapshot: GraphSnapshot, query: NeighbourhoodQuery): GraphView {
  const maxNodes = Math.min(query.maxNodes ?? DEFAULT_MAX_NODES, HARD_MAX_NODES);

  let nodes = snapshot.nodes;

  if (query.applicationOwnedOnly) {
    nodes = nodes.filter((node) => node.applicationOwned);
  }
  if (query.zoomLevel) {
    nodes = nodes.filter((node) => node.zoomLevel <= query.zoomLevel!);
  }
  if (query.nodeKinds?.length) {
    nodes = nodes.filter((node) => query.nodeKinds!.includes(node.kind));
  }
  if (query.tags?.length) {
    nodes = nodes.filter((node) => query.tags!.some((tag) => node.tags.includes(tag)));
  }
  if (query.minConfidence !== undefined) {
    nodes = nodes.filter((node) => node.analysisConfidence >= query.minConfidence!);
  }

  if (query.nodeId) {
    nodes = neighbourhood(snapshot, query.nodeId, query.depth ?? 1, query.direction ?? "both", nodes);
  }

  const truncated = nodes.length > maxNodes;
  const selected = nodes.slice(0, maxNodes);
  const ids = new Set(selected.map((node) => node.id));

  let edges = snapshot.edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId));
  if (query.edgeKinds?.length) {
    edges = edges.filter((edge) => query.edgeKinds!.includes(edge.kind));
  }
  if (query.minConfidence !== undefined) {
    edges = edges.filter((edge) => edge.analysisConfidence >= query.minConfidence!);
  }

  return {
    nodes: selected,
    edges,
    truncated,
    nextCursor: truncated ? String(maxNodes) : undefined,
  };
}

/** Breadth-first expansion from a node, bounded by depth. */
function neighbourhood(
  snapshot: GraphSnapshot,
  rootId: string,
  depth: number,
  direction: "in" | "out" | "both",
  candidates: GraphNode[],
): GraphNode[] {
  const allowed = new Set(candidates.map((node) => node.id));
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];

    for (const edge of snapshot.edges) {
      const outward = direction !== "in" && frontier.includes(edge.sourceNodeId);
      const inward = direction !== "out" && frontier.includes(edge.targetNodeId);

      if (outward && !visited.has(edge.targetNodeId)) {
        visited.add(edge.targetNodeId);
        next.push(edge.targetNodeId);
      }
      if (inward && !visited.has(edge.sourceNodeId)) {
        visited.add(edge.sourceNodeId);
        next.push(edge.sourceNodeId);
      }
    }

    if (next.length === 0) break;
    frontier = next;
  }

  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return [...visited]
    .filter((id) => id === rootId || allowed.has(id))
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => node !== undefined);
}

/**
 * Traces the execution path reachable from a route: middleware first (they run
 * before the handler), then everything the handler reaches.
 */
export function executionPath(snapshot: GraphSnapshot, routeId: string): GraphView {
  const nodeIds = new Set<string>([routeId]);
  const edges: GraphEdge[] = [];

  for (const edge of snapshot.edges) {
    if (edge.kind === "runs_before" && edge.targetNodeId === routeId) {
      nodeIds.add(edge.sourceNodeId);
      edges.push(edge);
    }
  }

  const queue = [routeId];
  const followed: GraphEdge["kind"][] = ["routes_to", "calls", "awaits", "reads", "writes", "throws"];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const edge of snapshot.edges) {
      if (edge.sourceNodeId !== current || !followed.includes(edge.kind)) continue;

      edges.push(edge);
      if (!nodeIds.has(edge.targetNodeId)) {
        nodeIds.add(edge.targetNodeId);
        queue.push(edge.targetNodeId);
      }
    }
  }

  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

  return {
    nodes: [...nodeIds].map((id) => byId.get(id)).filter((node): node is GraphNode => node !== undefined),
    edges: dedupe(edges),
    truncated: false,
  };
}

function dedupe(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
}

export interface NodeDetail {
  node: GraphNode;
  incoming: Array<{ edge: GraphEdge; node: GraphNode | undefined }>;
  outgoing: Array<{ edge: GraphEdge; node: GraphNode | undefined }>;
}

export function nodeDetail(snapshot: GraphSnapshot, nodeId: string): NodeDetail | null {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const byId = new Map(snapshot.nodes.map((candidate) => [candidate.id, candidate]));

  return {
    node,
    incoming: snapshot.edges
      .filter((edge) => edge.targetNodeId === nodeId)
      .map((edge) => ({ edge, node: byId.get(edge.sourceNodeId) })),
    outgoing: snapshot.edges
      .filter((edge) => edge.sourceNodeId === nodeId)
      .map((edge) => ({ edge, node: byId.get(edge.targetNodeId) })),
  };
}
