import type { Edge, Node } from "@xyflow/react";
import type { GraphEdge, GraphNode, GraphView, SemanticZoomLevel } from "@codinflow/graph-schema";
import { CHILD_HEIGHT, NODE_HEIGHT, containingFileId, layoutGraph } from "./layout";

/** One outgoing call a function makes, rendered as a readable row on its card. */
export interface CallInfo {
  id: string;
  name: string;
  /** Prose guard for a conditional call, e.g. "if is audio". */
  guard?: string;
  conditional: boolean;
}

/** Kinds whose cards list the calls they make. */
const CALLERS = new Set(["function", "method"]);
const CALL_ROW_H = 20;
const CALLS_PAD = 10;
const MAX_INLINE_CALLS = 4;

/** Extra card height for a function's inline call list. */
function callAreaHeight(count: number): number {
  if (count === 0) return 0;
  return CALLS_PAD + Math.min(count, MAX_INLINE_CALLS) * CALL_ROW_H + (count > MAX_INLINE_CALLS ? CALL_ROW_H : 0);
}

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
  calls: CallInfo[];
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
    const containerIds = new Set(input.nodes.filter((node) => node.kind === "file").map((node) => node.id));
    const byId = new Map(input.nodes.map((node) => [node.id, node]));

    // What each function calls, from the graph's own call/await edges. Conditional
    // edges already carry a prose guard ("if is audio") and the exact condition.
    const callsByNode = new Map<string, CallInfo[]>();
    for (const edge of input.edges) {
      if (edge.kind !== "calls" && edge.kind !== "awaits") continue;
      const target = byId.get(edge.targetNodeId);
      // Only real function calls read as "name()". External services and data
      // stores are surfaced by the card's description and the inspector instead.
      if (!target || !CALLERS.has(target.kind)) continue;
      const list = callsByNode.get(edge.sourceNodeId) ?? [];
      const conditional = edge.metadata?.conditional === true;
      list.push({ id: target.id, name: target.name, guard: conditional ? edge.label : undefined, conditional });
      callsByNode.set(edge.sourceNodeId, list);
    }

    // Cards grow to fit their call list, so nothing is clipped.
    const heights = new Map<string, number>();
    for (const node of input.nodes) {
      if (!CALLERS.has(node.kind)) continue;
      const extra = callAreaHeight(callsByNode.get(node.id)?.length ?? 0);
      if (extra === 0) continue;
      const nested = Boolean(containingFileId(node, byId, containerIds));
      heights.set(node.id, (nested ? CHILD_HEIGHT : NODE_HEIGHT) + extra);
    }

    const { positions, sizes } = await layoutGraph(input, options.direction ?? "RIGHT", options.savedPositions, heights);

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
        // Only outer blocks move. A symbol lives inside its file, so dragging it
        // (or the lines) pans the canvas instead of tearing it out of place.
        draggable: !containerId,
        ...(containerId ? { parentId: containerId, extent: "parent" as const } : {}),
        // Containers must paint behind their children.
        ...(isContainer ? { zIndex: 0 } : {}),
        style: { width: size.width, height: size.height },
        data: {
          graphNode,
          calls: callsByNode.get(graphNode.id) ?? [],
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
