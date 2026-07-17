import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { GraphNode, GraphView } from "@codinflow/graph-schema";

const elk = new ELK();

export const NODE_WIDTH = 230;
// Room for the header strip plus a body: kind, a short description and path.
export const NODE_HEIGHT = 112;

/** Symbol chips inside a file container: header + a one-line description. */
export const CHILD_WIDTH = 210;
export const CHILD_HEIGHT = 66;

/** Room for the file container's name, path and definitions list. */
export const CONTAINER_PADDING_X = 14;
export const CONTAINER_PADDING_BOTTOM = 14;

export type Positions = Record<string, { x: number; y: number }>;
export interface LayoutResult {
  positions: Positions;
  sizes: Record<string, { width: number; height: number }>;
}

/**
 * The file a node belongs in, following the parent chain.
 *
 * A method's parent is its class, not its file — without walking up, methods
 * would be laid out as peers of the files that contain them.
 */
export function containingFileId(
  node: GraphNode,
  byId: Map<string, GraphNode>,
  containerIds: Set<string>,
): string | undefined {
  let current = node.parentId;
  let hops = 0;

  while (current && hops < 8) {
    if (containerIds.has(current)) return byId.has(current) ? current : undefined;
    current = byId.get(current)?.parentId;
    hops += 1;
  }

  return undefined;
}

/**
 * Collapses each edge onto the top-level boxes it connects, dropping edges that
 * stay inside one file. Duplicates collapse into one, since ELK only needs to
 * know which containers relate, not how many times.
 */
function rootEdges(
  view: GraphView,
  byId: Map<string, GraphNode>,
  containerIds: Set<string>,
): Array<{ id: string; sources: string[]; targets: string[] }> {
  const seen = new Set<string>();
  const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];

  const topLevel = (nodeId: string): string | undefined => {
    if (!byId.has(nodeId)) return undefined;
    return containingFileId(byId.get(nodeId)!, byId, containerIds) ?? nodeId;
  };

  for (const edge of view.edges) {
    const source = topLevel(edge.sourceNodeId);
    const target = topLevel(edge.targetNodeId);
    if (!source || !target || source === target) continue;

    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({ id: `layout:${key}`, sources: [source], targets: [target] });
  }

  return edges;
}

export function containerHeaderHeight(file: GraphNode): number {
  const definitions = (file.metadata?.definitions as unknown[] | undefined)?.length ?? 0;
  const definitionRows = definitions === 0 ? 0 : Math.min(definitions, 6) + 1;
  return 52 + definitionRows * 17;
}

/**
 * ELK layered layout.
 *
 * Files lay out as compound nodes with their functions and classes nested
 * inside, so the picture reads the way the code is organized — a symbol is drawn
 * inside the file it lives in, rather than floating beside it.
 */
export async function layoutGraph(
  view: GraphView,
  direction: "RIGHT" | "DOWN",
  savedPositions?: Positions,
): Promise<LayoutResult> {
  if (view.nodes.length === 0) return { positions: {}, sizes: {} };

  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const containerIds = new Set(view.nodes.filter((node) => node.kind === "file").map((node) => node.id));

  const childrenOf = new Map<string, GraphNode[]>();
  const roots: GraphNode[] = [];

  for (const node of view.nodes) {
    const containerId = containingFileId(node, byId, containerIds);
    if (containerId) {
      const siblings = childrenOf.get(containerId) ?? [];
      siblings.push(node);
      childrenOf.set(containerId, siblings);
    } else {
      roots.push(node);
    }
  }

  const elkNodeFor = (node: GraphNode): ElkNode => {
    const children = childrenOf.get(node.id) ?? [];

    if (children.length === 0) {
      return { id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT };
    }

    return {
      id: node.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.padding": `[top=${containerHeaderHeight(node)},left=${CONTAINER_PADDING_X},bottom=${CONTAINER_PADDING_BOTTOM},right=${CONTAINER_PADDING_X}]`,
        "elk.spacing.nodeNode": "10",
        "elk.layered.spacing.nodeNodeBetweenLayers": "10",
      },
      children: children.map((child) => ({ id: child.id, width: CHILD_WIDTH, height: CHILD_HEIGHT })),
    };
  };

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      // SEPARATE_CHILDREN: each file lays its own symbols out and sizes around
      // them. INCLUDE_CHILDREN places children by the *root* layering, which
      // pushes them outside the container box they belong to. Edges that cross
      // containers are drawn by React Flow from the final positions either way,
      // so nothing is lost by keeping the hierarchies separate.
      "elk.hierarchyHandling": "SEPARATE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "48",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: roots.map(elkNodeFor),
    // ELK is given edges between top-level boxes only. It refuses to route an
    // edge that crosses hierarchy levels under SEPARATE_CHILDREN, and we do not
    // need it to: React Flow draws every real edge from the final positions.
    // What ELK is actually for here is ordering the containers sensibly.
    edges: rootEdges(view, byId, containerIds),
  };

  const result = await elk.layout(graph);
  const positions: Positions = {};
  const sizes: Record<string, { width: number; height: number }> = {};

  const walk = (node: ElkNode): void => {
    positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
    sizes[node.id] = { width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT };
    // Child coordinates stay relative to their parent, which is exactly what
    // React Flow expects for a parented node.
    for (const child of node.children ?? []) walk(child);
  };

  for (const child of result.children ?? []) walk(child);

  return { positions: { ...positions, ...savedPositions }, sizes };
}
