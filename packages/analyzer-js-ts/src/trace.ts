import type { GraphNode, GraphSnapshot } from "@codinflow/graph-schema";
import { guardText } from "./query.js";

/**
 * `codinflow trace` — what actually happens when a route is hit.
 *
 * Middleware in execution order (runs_before chain), then the guarded call
 * tree from the handler, with database / external / env / throw touches
 * collected along the way. Mirrors the canvas execution-path view, in text.
 */

const CALLABLE = new Set(["function", "method", "class"]);
/** Node kinds that end a branch and land in the touches summary. */
const LEAF_KINDS = new Set(["database", "external_api", "error", "environment_variable", "queue", "event"]);

export interface TraceStep {
  id: string;
  name: string;
  kind: string;
  filePath?: string;
  line?: number;
  guard?: string;
  edgeKind: string;
  depth: number;
  /** True when this node already appeared earlier in the trace (cycle/repeat). */
  repeated?: boolean;
  children: TraceStep[];
}

export interface RouteTrace {
  route: {
    id: string;
    name: string;
    method?: string;
    path?: string;
    framework?: string;
    routeType?: string;
    file?: string;
  };
  /** Middleware that runs before the handler, in execution order. */
  middleware: Array<{ name: string; filePath?: string; tags: string[] }>;
  steps: TraceStep[];
  touches: {
    reads: string[];
    writes: string[];
    external: string[];
    throws: string[];
    env: string[];
  };
  truncatedAtDepth: boolean;
  relevantFiles: string[];
}

/** Route nodes matching "GET /api/orders", "/api/orders", or just "orders". */
export function findRouteNodes(snapshot: GraphSnapshot, query: string): GraphNode[] {
  const q = query.trim().toLowerCase();
  const routes = snapshot.nodes.filter((node) => node.kind === "route");
  const exact = routes.filter(
    (node) => node.name.toLowerCase() === q || String(node.metadata?.path ?? "").toLowerCase() === q,
  );
  if (exact.length > 0) return exact;
  return routes.filter(
    (node) => node.name.toLowerCase().includes(q) || String(node.metadata?.path ?? "").toLowerCase().includes(q),
  );
}

export function buildTrace(snapshot: GraphSnapshot, route: GraphNode, maxDepth = 8): RouteTrace {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof snapshot.edges>();
  const incomingRunsBefore = new Map<string, typeof snapshot.edges>();
  for (const edge of snapshot.edges) {
    const list = outgoing.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.sourceNodeId, list);
    if (edge.kind === "runs_before") {
      const inList = incomingRunsBefore.get(edge.targetNodeId) ?? [];
      inList.push(edge);
      incomingRunsBefore.set(edge.targetNodeId, inList);
    }
  }

  // Middleware chain: walk runs_before edges backwards from the route, then
  // reverse so the list reads in execution order. The application root is the
  // chain's start, not a middleware — skip it.
  const middleware: RouteTrace["middleware"] = [];
  const seenMiddleware = new Set<string>([route.id]);
  let cursor: string | undefined = route.id;
  while (cursor !== undefined) {
    const predecessorEdge = (incomingRunsBefore.get(cursor) ?? []).find(
      (edge) => !seenMiddleware.has(edge.sourceNodeId),
    );
    if (!predecessorEdge) break;
    const predecessor = byId.get(predecessorEdge.sourceNodeId);
    seenMiddleware.add(predecessorEdge.sourceNodeId);
    if (!predecessor || predecessor.kind === "application") break;
    middleware.push({ name: predecessor.name, filePath: predecessor.filePath, tags: predecessor.tags });
    cursor = predecessor.id;
  }
  middleware.reverse();

  const touches: RouteTrace["touches"] = { reads: [], writes: [], external: [], throws: [], env: [] };
  const relevantFiles = new Set<string>();
  if (route.filePath) relevantFiles.add(route.filePath);
  for (const step of middleware) if (step.filePath) relevantFiles.add(step.filePath);

  const touch = (list: string[], entry: string): void => {
    if (!list.includes(entry)) list.push(entry);
  };

  const visited = new Set<string>([route.id]);
  let truncatedAtDepth = false;

  const walk = (nodeId: string, depth: number): TraceStep[] => {
    const from = byId.get(nodeId);
    const steps: TraceStep[] = [];
    for (const edge of outgoing.get(nodeId) ?? []) {
      const target = byId.get(edge.targetNodeId);
      if (!target) continue;

      if (LEAF_KINDS.has(target.kind) || edge.kind === "reads" || edge.kind === "writes" || edge.kind === "throws") {
        const via = from?.name ?? "unknown";
        if (target.kind === "environment_variable") touch(touches.env, `${target.name} (${via})`);
        else if (target.kind === "external_api") touch(touches.external, `${target.name} (${via})`);
        else if (edge.kind === "throws" || target.kind === "error") touch(touches.throws, `${target.name} (${via})`);
        else if (edge.kind === "writes") touch(touches.writes, `${target.name} (${via})`);
        else if (edge.kind === "reads") touch(touches.reads, `${target.name} (${via})`);
        else continue;
        steps.push({
          id: target.id,
          name: target.name,
          kind: target.kind,
          filePath: target.filePath,
          line: edge.sourceLocation?.line,
          guard: guardText(edge),
          edgeKind: edge.kind,
          depth,
          children: [],
        });
        continue;
      }

      const follow =
        edge.kind === "routes_to" || ((edge.kind === "calls" || edge.kind === "awaits") && CALLABLE.has(target.kind));
      if (!follow) continue;

      if (target.filePath) relevantFiles.add(target.filePath);
      const repeated = visited.has(target.id);
      const step: TraceStep = {
        id: target.id,
        name: target.name,
        kind: target.kind,
        filePath: target.filePath,
        line: edge.sourceLocation?.line,
        guard: guardText(edge),
        edgeKind: edge.kind,
        depth,
        repeated: repeated || undefined,
        children: [],
      };
      if (!repeated) {
        visited.add(target.id);
        if (depth >= maxDepth) truncatedAtDepth = true;
        else step.children = walk(target.id, depth + 1);
      }
      steps.push(step);
    }
    return steps;
  };

  const steps = walk(route.id, 1);

  return {
    route: {
      id: route.id,
      name: route.name,
      method: typeof route.metadata?.httpMethod === "string" ? route.metadata.httpMethod : undefined,
      path: typeof route.metadata?.path === "string" ? route.metadata.path : undefined,
      framework: typeof route.metadata?.framework === "string" ? route.metadata.framework : undefined,
      routeType: typeof route.metadata?.routeType === "string" ? route.metadata.routeType : undefined,
      file: route.filePath,
    },
    middleware,
    steps,
    touches,
    truncatedAtDepth,
    relevantFiles: [...relevantFiles].sort(),
  };
}
