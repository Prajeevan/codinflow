import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GraphEdge, GraphNode, GraphSnapshot, GraphView } from "@codinflow/graph-schema";

/**
 * The local viewer server (`codinflow --ui`).
 *
 * Serves the embedded canvas app and answers, from a single in-memory snapshot,
 * the same endpoints the app calls against the hosted API — so no database, no
 * upload and no token. The view functions mirror workers/api/src/graph-store.ts.
 */

const DEFAULT_MAX_NODES = 300;
const HARD_MAX_NODES = 2000;

interface GraphQuery {
  zoomLevel?: number;
  maxNodes?: number;
  applicationOwnedOnly?: boolean;
  nodeId?: string;
  depth?: number;
  direction?: "in" | "out" | "both";
}

function selectView(snapshot: GraphSnapshot, query: GraphQuery): GraphView {
  const maxNodes = Math.min(query.maxNodes ?? DEFAULT_MAX_NODES, HARD_MAX_NODES);
  let nodes = snapshot.nodes;

  if (query.applicationOwnedOnly) nodes = nodes.filter((node) => node.applicationOwned);
  if (query.zoomLevel) nodes = nodes.filter((node) => node.zoomLevel <= query.zoomLevel!);
  if (query.nodeId) nodes = neighbourhood(snapshot, query.nodeId, query.depth ?? 1, query.direction ?? "both", nodes);

  const truncated = nodes.length > maxNodes;
  const selected = nodes.slice(0, maxNodes);
  const ids = new Set(selected.map((node) => node.id));
  const edges = snapshot.edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId));

  return { nodes: selected, edges, truncated, nextCursor: truncated ? String(maxNodes) : undefined };
}

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
      if (outward && !visited.has(edge.targetNodeId)) (visited.add(edge.targetNodeId), next.push(edge.targetNodeId));
      if (inward && !visited.has(edge.sourceNodeId)) (visited.add(edge.sourceNodeId), next.push(edge.sourceNodeId));
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

function executionPath(snapshot: GraphSnapshot, routeId: string): GraphView {
  const nodeIds = new Set<string>([routeId]);
  const edges: GraphEdge[] = [];

  for (const edge of snapshot.edges) {
    if (edge.kind === "runs_before" && edge.targetNodeId === routeId) {
      nodeIds.add(edge.sourceNodeId);
      edges.push(edge);
    }
  }

  const queue = [routeId];
  const followed = ["routes_to", "calls", "awaits", "reads", "writes", "throws"];
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
  const seen = new Set<string>();
  return {
    nodes: [...nodeIds].map((id) => byId.get(id)).filter((node): node is GraphNode => node !== undefined),
    edges: edges.filter((edge) => (seen.has(edge.id) ? false : (seen.add(edge.id), true))),
    truncated: false,
  };
}

function nodeDetail(snapshot: GraphSnapshot, nodeId: string) {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const byId = new Map(snapshot.nodes.map((candidate) => [candidate.id, candidate]));
  return {
    node,
    incoming: snapshot.edges.filter((e) => e.targetNodeId === nodeId).map((edge) => ({ edge, node: byId.get(edge.sourceNodeId) })),
    outgoing: snapshot.edges.filter((e) => e.sourceNodeId === nodeId).map((edge) => ({ edge, node: byId.get(edge.targetNodeId) })),
  };
}

function overview(snapshot: GraphSnapshot) {
  return {
    repositoryId: snapshot.repositoryId,
    commitSha: snapshot.commitSha,
    analyzerVersion: snapshot.analyzerVersion,
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    frameworks: snapshot.frameworks,
    entryPoints: snapshot.entryPoints,
    stats: snapshot.stats,
    warnings: snapshot.warnings,
    routes: snapshot.nodes
      .filter((node) => node.kind === "route")
      .map((node) => ({
        id: node.id,
        name: node.name,
        filePath: node.filePath,
        httpMethod: node.metadata?.httpMethod as string | undefined,
        framework: node.metadata?.framework as string | undefined,
        routeType: node.metadata?.routeType as string | undefined,
      })),
    externalSystems: snapshot.nodes
      .filter((node) => !node.applicationOwned && node.kind !== "module")
      .map((node) => ({ id: node.id, name: node.name, kind: node.kind })),
    environmentVariables: snapshot.nodes.filter((node) => node.kind === "environment_variable").map((node) => node.name),
    riskiestFunctions: snapshot.nodes
      .filter((node) => node.tags.includes("high-fan-in") || node.tags.includes("unresolved-dynamic-call"))
      .map((node) => ({ id: node.id, name: node.name, tags: node.tags })),
    analysisConfidence: {
      resolvedCallRatio: snapshot.stats.resolvedCallRatio,
      unresolvedDynamicCalls: snapshot.nodes.filter((node) => node.tags.includes("unresolved-dynamic-call")).length,
    },
  };
}

function searchNodes(snapshot: GraphSnapshot, term: string) {
  const q = term.toLowerCase();
  return snapshot.nodes
    .filter(
      (node) =>
        node.name.toLowerCase().includes(q) ||
        (node.qualifiedName ?? "").toLowerCase().includes(q) ||
        (node.filePath ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => Number(b.applicationOwned) - Number(a.applicationOwned) || a.name.length - b.name.length)
    .slice(0, 50)
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualified_name: node.qualifiedName ?? null,
      file_path: node.filePath ?? null,
      start_line: node.source?.startLine ?? null,
      tags: node.tags.join(","),
    }));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export interface LocalServer {
  url: string;
  close: () => void;
}

export function startLocalServer(options: {
  snapshot: GraphSnapshot;
  webDir: string;
  host?: string;
  port?: number;
}): Promise<LocalServer> {
  const { snapshot, webDir } = options;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9338;

  if (!existsSync(path.join(webDir, "index.html"))) {
    throw new Error(`no embedded UI at ${webDir}. This build of codinflow does not include the viewer.`);
  }

  // The app runs in single-project local mode: this flag hides the repo picker.
  const indexHtml = readFileSync(path.join(webDir, "index.html"), "utf8").replace(
    "<head>",
    `<head><script>window.__CODINFLOW_LOCAL__=true</script>`,
  );

  const server = createServer((req, res) => handle(req, res, snapshot, webDir, indexHtml));

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => resolve({ url: `http://${host}:${port}`, close: () => server.close() }));
  });
}

function handle(req: IncomingMessage, res: ServerResponse, snapshot: GraphSnapshot, webDir: string, indexHtml: string): void {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname.startsWith("/api/v1/")) {
    // Decode PER SEGMENT: a node/route id (e.g. "repo:route:PAGE:/products") is
    // sent url-encoded, so its internal "/" must not be treated as a separator.
    const parts = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    return api(parts, url.searchParams, snapshot, res);
  }
  return serveStatic(decodeURIComponent(url.pathname), webDir, indexHtml, res);
}

// parts: ["api", "v1", "repositories", <id>, <section>, <arg>]
function api(parts: string[], params: URLSearchParams, snapshot: GraphSnapshot, res: ServerResponse): void {
  if (parts.length === 3 && parts[2] === "repositories") {
    return json(res, {
      repositories: [
        { id: snapshot.repositoryId, full_name: snapshot.repositoryId, commit_sha: snapshot.commitSha, node_count: snapshot.nodes.length },
      ],
    });
  }

  const section = parts[4];
  const arg = parts[5];

  if (section === "commits") {
    return json(res, {
      commits: [{ commit_sha: snapshot.commitSha, node_count: snapshot.nodes.length, created_at: snapshot.generatedAt }],
    });
  }
  if (section === "overview") return json(res, overview(snapshot));
  if (section === "graph") {
    return json(res, selectView(snapshot, {
      zoomLevel: numberParam(params.get("zoomLevel")),
      maxNodes: numberParam(params.get("maxNodes")),
      applicationOwnedOnly: params.get("applicationOwnedOnly") === "true",
      nodeId: params.get("nodeId") ?? undefined,
      depth: numberParam(params.get("depth")),
      direction: (params.get("direction") as "in" | "out" | "both" | null) ?? undefined,
    }));
  }
  if (section === "paths" && arg) return json(res, executionPath(snapshot, arg));
  if (section === "nodes" && arg) {
    const detail = nodeDetail(snapshot, arg);
    return detail ? json(res, detail) : json(res, { error: "node not found" }, 404);
  }
  if (section === "search") return json(res, { results: params.get("q") ? searchNodes(snapshot, params.get("q")!.trim()) : [] });
  if (section === "source") {
    const filePath = params.get("filePath") ?? "";
    const content = snapshot.sources?.[filePath];
    return content === undefined
      ? json(res, { error: "source not found" }, 404)
      : json(res, { filePath, commitSha: snapshot.commitSha, content });
  }
  if (section === "diff") return json(res, { error: "diff needs two commits; local mode has one" }, 400);

  return json(res, { error: "not found" }, 404);
}

function serveStatic(pathname: string, webDir: string, indexHtml: string, res: ServerResponse): void {
  if (pathname === "/" || pathname === "/index.html") return send(res, 200, MIME[".html"]!, indexHtml);

  const filePath = path.join(webDir, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  if (filePath.startsWith(webDir) && existsSync(filePath) && !filePath.endsWith(path.sep)) {
    return send(res, 200, MIME[path.extname(filePath)] ?? "application/octet-stream", readFileSync(filePath));
  }
  // SPA fallback — any unknown route renders the app.
  return send(res, 200, MIME[".html"]!, indexHtml);
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  send(res, status, MIME[".json"]!, JSON.stringify(value));
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Best-effort "open this URL in the browser" across platforms. */
export function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}
