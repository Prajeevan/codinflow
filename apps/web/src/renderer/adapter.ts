import type { Edge, Node } from "@xyflow/react";
import type { GraphEdge, GraphNode, GraphView, SemanticZoomLevel } from "@codinflow/graph-schema";
import { containingFileId, layoutGraph } from "./layout";

/**
 * Renderer adapter (AST-and-CANVAS decision).
 *
 * The canonical graph never becomes React Flow's types anywhere else in the app.
 * Swapping in a Canvas/WebGL renderer later means writing another implementation
 * of this interface — not touching analysis or persisted data.
 */
export interface GraphRendererAdapter {
  createView(input: GraphView, options: RenderOptions): Promise<RenderableGraph>;
}

export type ChangeState = "added" | "removed" | "changed";

export interface RenderOptions {
  zoomLevel: SemanticZoomLevel;
  highlightedNodeIds?: Set<string>;
  changedNodeIds?: Map<string, ChangeState>;
  direction?: "RIGHT" | "DOWN";
  savedPositions?: Record<string, { x: number; y: number }>;
}

export interface RenderableGraph {
  nodes: Node<CodeNodeData>[];
  edges: Edge[];
}

export interface CodeNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  changeState?: ChangeState;
  /** Change states of the symbols inside a file, summarized on its header. */
  childChanges?: { added: number; changed: number; removed: number };
  dimmed: boolean;
  isContainer: boolean;
  width: number;
  height: number;
}

export const reactFlowAdapter: GraphRendererAdapter = {
  async createView(input, options) {
    const { positions, sizes } = await layoutGraph(input, options.direction ?? "RIGHT", options.savedPositions);

    const containerIds = new Set(input.nodes.filter((node) => node.kind === "file").map((node) => node.id));
    const byId = new Map(input.nodes.map((node) => [node.id, node]));

    const childChangesByFile = summarizeChildChanges(input.nodes, byId, containerIds, options.changedNodeIds);

    const nodes: Node<CodeNodeData>[] = input.nodes.map((graphNode) => {
      const containerId = containingFileId(graphNode, byId, containerIds);
      const size = sizes[graphNode.id] ?? { width: 230, height: 112 };
      // A file with nothing inside it draws as a plain node, not an empty box.
      const isContainer = containerIds.has(graphNode.id) && hasAnyChild(input.nodes, byId, containerIds, graphNode.id);

      return {
        id: graphNode.id,
        type: isContainer ? "fileContainer" : "code",
        position: positions[graphNode.id] ?? { x: 0, y: 0 },
        ...(containerId ? { parentId: containerId, extent: "parent" as const } : {}),
        // Containers must paint behind their children.
        ...(isContainer ? { zIndex: 0 } : {}),
        style: { width: size.width, height: size.height },
        data: {
          graphNode,
          changeState: options.changedNodeIds?.get(graphNode.id),
          childChanges: childChangesByFile.get(graphNode.id),
          dimmed: options.highlightedNodeIds ? !options.highlightedNodeIds.has(graphNode.id) : false,
          isContainer,
          width: size.width,
          height: size.height,
        },
      };
    });

    // React Flow requires a parent to be listed before its children.
    nodes.sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));

    return { nodes, edges: input.edges.map((edge) => toRenderableEdge(edge, options)) };
  },
};

function hasAnyChild(
  nodes: GraphNode[],
  byId: Map<string, GraphNode>,
  containerIds: Set<string>,
  id: string,
): boolean {
  return nodes.some((node) => node.id !== id && containingFileId(node, byId, containerIds) === id);
}

/**
 * Rolls each file's symbol changes up to its header, so a reviewer can see which
 * files a commit touched without opening them.
 */
function summarizeChildChanges(
  nodes: GraphNode[],
  byId: Map<string, GraphNode>,
  containerIds: Set<string>,
  changed?: Map<string, ChangeState>,
): Map<string, { added: number; changed: number; removed: number }> {
  const summary = new Map<string, { added: number; changed: number; removed: number }>();
  if (!changed || changed.size === 0) return summary;

  for (const node of nodes) {
    const containerId = containingFileId(node, byId, containerIds);
    if (!containerId) continue;

    const state = changed.get(node.id);
    if (!state) continue;

    const entry = summary.get(containerId) ?? { added: 0, changed: 0, removed: 0 };
    entry[state] += 1;
    summary.set(containerId, entry);
  }

  return summary;
}

function toRenderableEdge(edge: GraphEdge, options: RenderOptions): Edge {
  const conditional = edge.metadata?.conditional === true;
  const dimmed = options.highlightedNodeIds
    ? !(options.highlightedNodeIds.has(edge.sourceNodeId) && options.highlightedNodeIds.has(edge.targetNodeId))
    : false;

  // Import edges are structure, not behaviour. They are the densest edges in any
  // real repository, so they stay quiet and unlabelled.
  const structural = edge.kind === "imports" || edge.kind === "depends_on";

  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: structural ? undefined : edge.label,
    type: "smoothstep",
    animated: conditional,
    zIndex: 1,
    data: { edge },
    labelStyle: { fontSize: 10, fill: dimmed ? "var(--text-subtle)" : "var(--edge-label-fg)" },
    labelBgStyle: { fill: "var(--edge-label-bg)", fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    style: {
      stroke: dimmed ? "var(--edge-dimmed, var(--border))" : edgeColor(edge),
      strokeWidth: conditional ? 2 : 1.5,
      // Inferred relationships are dashed, so certainty is visible at a glance
      // rather than implied by a solid line.
      strokeDasharray: edge.provenance.evidenceType === "framework_inferred" ? "6 3" : undefined,
      opacity: dimmed ? 0.2 : structural ? 0.35 : 1,
    },
  };
}

function edgeColor(edge: GraphEdge): string {
  switch (edge.kind) {
    case "writes":
      return "var(--h-orange)";
    case "reads":
      return "var(--h-sky)";
    case "throws":
      return "var(--h-red)";
    case "routes_to":
      return "var(--h-violet)";
    case "runs_before":
      return "var(--h-amber)";
    case "depends_on":
    case "imports":
      return "var(--border-strong)";
    default:
      return edge.metadata?.conditional === true ? "var(--h-green)" : "var(--h-slate)";
  }
}
