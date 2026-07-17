import type { GraphEdge, GraphNode, GraphSnapshot } from "@codinflow/graph-schema";

export type ChangeKind =
  | "node_added"
  | "node_removed"
  | "node_signature_changed"
  | "node_implementation_changed"
  | "edge_added"
  | "edge_removed"
  | "edge_condition_changed"
  | "external_api_added"
  | "external_api_removed"
  | "database_write_added"
  | "database_read_added"
  | "route_added"
  | "route_removed"
  | "authentication_changed"
  | "error_path_changed"
  | "async_behaviour_changed"
  | "environment_variable_added";

export interface Change {
  kind: ChangeKind;
  /** Whether this change removed something, for kinds that cover both. */
  removed?: boolean;
  nodeId?: string;
  edgeId?: string;
  name: string;
  detail: string;
  /** Source evidence for the change, so the summary is never unfalsifiable. */
  filePath?: string;
  line?: number;
}

export type ImpactLevel = "directly_affected" | "probably_affected" | "potentially_affected";

export interface BlastRadiusEntry {
  nodeId: string;
  name: string;
  level: ImpactLevel;
  reason: string;
}

export interface GraphDiff {
  baseSha: string;
  headSha: string;
  changes: Change[];
  blastRadius: BlastRadiusEntry[];
  summary: string;
  riskLevel: "low" | "medium" | "high";
}

/**
 * Compares two snapshots (BRIEF §11).
 *
 * Node identity is stable across commits by construction, so a matching id means
 * the same symbol; the body fingerprint then distinguishes "unchanged" from
 * "implementation changed".
 */
export function diffSnapshots(base: GraphSnapshot, head: GraphSnapshot): GraphDiff {
  const changes: Change[] = [];

  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const headNodes = new Map(head.nodes.map((node) => [node.id, node]));

  for (const node of head.nodes) {
    const previous = baseNodes.get(node.id);

    if (!previous) {
      changes.push({
        kind: nodeAddedKind(node),
        nodeId: node.id,
        name: node.name,
        detail: `${node.kind} "${node.name}" was added.`,
        filePath: node.filePath,
        line: node.source?.startLine,
      });
      continue;
    }

    if (previous.signature !== node.signature) {
      changes.push({
        kind: "node_signature_changed",
        nodeId: node.id,
        name: node.name,
        detail: `Signature changed from ${previous.signature ?? "unknown"} to ${node.signature ?? "unknown"}.`,
        filePath: node.filePath,
        line: node.source?.startLine,
      });
    } else if (previous.sourceFingerprint !== node.sourceFingerprint) {
      changes.push({
        kind: "node_implementation_changed",
        nodeId: node.id,
        name: node.name,
        detail: `Implementation of "${node.name}" changed.`,
        filePath: node.filePath,
        line: node.source?.startLine,
      });
    }

    const wasAsync = previous.tags.includes("async");
    const isAsync = node.tags.includes("async");
    if (wasAsync !== isAsync) {
      changes.push({
        kind: "async_behaviour_changed",
        nodeId: node.id,
        name: node.name,
        detail: `"${node.name}" became ${isAsync ? "asynchronous" : "synchronous"}.`,
        filePath: node.filePath,
        line: node.source?.startLine,
      });
    }
  }

  for (const node of base.nodes) {
    if (headNodes.has(node.id)) continue;
    changes.push({
      kind: nodeRemovedKind(node),
      nodeId: node.id,
      name: node.name,
      detail: `${node.kind} "${node.name}" was removed.`,
      filePath: node.filePath,
      line: node.source?.startLine,
    });
  }

  changes.push(...diffEdges(base, head, headNodes));

  const blastRadius = calculateBlastRadius(head, changes);

  return {
    baseSha: base.commitSha,
    headSha: head.commitSha,
    changes,
    blastRadius,
    summary: summarize(changes, headNodes),
    riskLevel: riskOf(changes),
  };
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.kind}`;
}

function diffEdges(base: GraphSnapshot, head: GraphSnapshot, headNodes: Map<string, GraphNode>): Change[] {
  const changes: Change[] = [];
  const baseEdges = new Map(base.edges.map((edge) => [edgeKey(edge), edge]));
  const headEdges = new Map(head.edges.map((edge) => [edgeKey(edge), edge]));

  for (const [key, edge] of headEdges) {
    const previous = baseEdges.get(key);
    const target = headNodes.get(edge.targetNodeId);
    const source = headNodes.get(edge.sourceNodeId);

    if (!previous) {
      changes.push({
        kind: edgeAddedKind(edge, source, target),
        edgeId: edge.id,
        name: `${source?.name ?? edge.sourceNodeId} → ${target?.name ?? edge.targetNodeId}`,
        detail: edge.label ?? `New ${edge.kind} relationship.`,
        filePath: edge.sourceLocation?.filePath,
        line: edge.sourceLocation?.line,
      });
      continue;
    }

    if (previous.condition !== edge.condition) {
      changes.push({
        kind: "edge_condition_changed",
        edgeId: edge.id,
        name: `${source?.name ?? "?"} → ${target?.name ?? "?"}`,
        detail: `Condition changed from \`${previous.condition ?? "none"}\` to \`${edge.condition ?? "none"}\`.`,
        filePath: edge.sourceLocation?.filePath,
        line: edge.sourceLocation?.line,
      });
    }
  }

  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));

  for (const [key, edge] of baseEdges) {
    if (headEdges.has(key)) continue;

    const source = baseNodes.get(edge.sourceNodeId);
    const target = baseNodes.get(edge.targetNodeId);

    changes.push({
      kind: edgeRemovedKind(edge, source),
      removed: true,
      edgeId: edge.id,
      name: `${source?.name ?? "?"} → ${target?.name ?? "?"}`,
      detail: `Relationship removed: ${edge.label ?? edge.kind}.`,
      filePath: edge.sourceLocation?.filePath,
      line: edge.sourceLocation?.line,
    });
  }

  return changes;
}

function nodeAddedKind(node: GraphNode): ChangeKind {
  if (node.kind === "route") return "route_added";
  if (node.kind === "external_api") return "external_api_added";
  if (node.kind === "environment_variable") return "environment_variable_added";
  return "node_added";
}

function nodeRemovedKind(node: GraphNode): ChangeKind {
  if (node.kind === "route") return "route_removed";
  if (node.kind === "external_api") return "external_api_removed";
  return "node_removed";
}

function edgeAddedKind(
  edge: GraphEdge,
  source: GraphNode | undefined,
  target: GraphNode | undefined,
): ChangeKind {
  if (edge.kind === "writes" && target?.kind === "database") return "database_write_added";
  if (edge.kind === "reads" && target?.kind === "database") return "database_read_added";
  if (edge.kind === "calls" && target?.kind === "external_api") return "external_api_added";
  if (edge.kind === "throws") return "error_path_changed";
  if (edge.kind === "runs_before" && isAuthentication(source)) return "authentication_changed";
  return "edge_added";
}

/**
 * Losing a `runs_before` edge from an auth middleware means a route stopped
 * being authenticated — the single most important thing a reviewer can be told,
 * so it must not be flattened into a generic "relationship removed".
 */
function edgeRemovedKind(edge: GraphEdge, source: GraphNode | undefined): ChangeKind {
  if (edge.kind === "runs_before" && isAuthentication(source)) return "authentication_changed";
  if (edge.kind === "writes" || edge.kind === "reads") return "edge_removed";
  if (edge.kind === "throws") return "error_path_changed";
  return "edge_removed";
}

function isAuthentication(node: GraphNode | undefined): boolean {
  if (!node) return false;
  return node.tags.includes("authentication") || node.tags.includes("authorization");
}

/**
 * Blast radius (BRIEF §11).
 *
 * Reported in graded tiers, never as certainty: callers of a changed symbol are
 * directly affected, their callers probably, and anything two hops out only
 * potentially.
 */
function calculateBlastRadius(head: GraphSnapshot, changes: Change[]): BlastRadiusEntry[] {
  const changed = new Set(changes.map((change) => change.nodeId).filter((id): id is string => Boolean(id)));
  const byId = new Map(head.nodes.map((node) => [node.id, node]));
  const entries = new Map<string, BlastRadiusEntry>();

  const callersOf = (id: string): string[] =>
    head.edges
      .filter((edge) => edge.targetNodeId === id && ["calls", "awaits", "routes_to"].includes(edge.kind))
      .map((edge) => edge.sourceNodeId);

  const levels: ImpactLevel[] = ["directly_affected", "probably_affected", "potentially_affected"];
  let frontier = [...changed];

  for (const level of levels) {
    const next: string[] = [];

    for (const id of frontier) {
      for (const callerId of callersOf(id)) {
        if (changed.has(callerId) || entries.has(callerId)) continue;

        const node = byId.get(callerId);
        if (!node) continue;

        entries.set(callerId, {
          nodeId: callerId,
          name: node.name,
          level,
          reason: `Calls ${byId.get(id)?.name ?? id}, which changed.`,
        });
        next.push(callerId);
      }
    }

    if (next.length === 0) break;
    frontier = next;
  }

  return [...entries.values()];
}

/**
 * Deterministic prose summary built only from classified changes.
 *
 * No model is involved: every clause here corresponds to a change record the
 * reader can open. AI summarization is layered on top of this, never underneath.
 */
function summarize(changes: Change[], headNodes: Map<string, GraphNode>): string {
  if (changes.length === 0) return "No behavioural changes detected between these commits.";

  const sentences: string[] = [];
  const count = (kind: ChangeKind): Change[] => changes.filter((change) => change.kind === kind);

  // Authentication leads the summary: it is the change a reviewer most needs to
  // see, and it is easy to miss in a line-based diff.
  const authRemoved = count("authentication_changed").filter((change) => change.removed);
  if (authRemoved.length > 0) {
    sentences.push(
      `Removes authentication from ${authRemoved.length} route${plural(authRemoved.length)}: ${names(authRemoved)}.`,
    );
  }

  const authAdded = count("authentication_changed").filter((change) => !change.removed);
  if (authAdded.length > 0) {
    sentences.push(`Adds authentication to ${authAdded.length} route${plural(authAdded.length)}.`);
  }

  const routesAdded = count("route_added");
  if (routesAdded.length > 0) {
    sentences.push(`Adds ${routesAdded.length} route${plural(routesAdded.length)}: ${names(routesAdded)}.`);
  }

  const routesRemoved = count("route_removed");
  if (routesRemoved.length > 0) {
    sentences.push(`Removes ${routesRemoved.length} route${plural(routesRemoved.length)}: ${names(routesRemoved)}.`);
  }

  const externalAdded = count("external_api_added");
  if (externalAdded.length > 0) {
    sentences.push(`Introduces ${externalAdded.length} new external API call${plural(externalAdded.length)}.`);
  }

  const writesAdded = count("database_write_added");
  if (writesAdded.length > 0) {
    sentences.push(`Introduces ${writesAdded.length} new database write${plural(writesAdded.length)}.`);
  }

  const conditionChanges = count("edge_condition_changed");
  if (conditionChanges.length > 0) {
    sentences.push(`Changes ${conditionChanges.length} branch condition${plural(conditionChanges.length)}.`);
  }

  const implementationChanges = count("node_implementation_changed");
  if (implementationChanges.length > 0) {
    sentences.push(
      `Modifies the implementation of ${names(implementationChanges.slice(0, 3))}${
        implementationChanges.length > 3 ? ` and ${implementationChanges.length - 3} more` : ""
      }.`,
    );
  }

  const signatureChanges = count("node_signature_changed");
  if (signatureChanges.length > 0) {
    sentences.push(`Changes the signature of ${names(signatureChanges)}.`);
  }

  const added = count("node_added").filter((change) => headNodes.get(change.nodeId ?? "")?.kind === "function");
  if (added.length > 0) {
    sentences.push(`Adds ${added.length} function${plural(added.length)}: ${names(added.slice(0, 5))}.`);
  }

  const removed = count("node_removed");
  if (removed.length > 0) {
    sentences.push(`Removes ${removed.length} symbol${plural(removed.length)}.`);
  }

  return sentences.join(" ");
}

function names(changes: Change[]): string {
  return changes.map((change) => `\`${change.name}\``).join(", ");
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function riskOf(changes: Change[]): "low" | "medium" | "high" {
  const highRisk: ChangeKind[] = [
    "authentication_changed",
    "route_removed",
    "external_api_added",
    "database_write_added",
    "node_signature_changed",
  ];

  if (changes.some((change) => highRisk.includes(change.kind))) return "high";
  if (changes.length > 10) return "medium";
  return "low";
}
