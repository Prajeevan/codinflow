/**
 * Canonical, language-neutral code graph schema.
 *
 * Renderer-independent by contract: nothing in this package may import from
 * @xyflow/react, ELK, or any storage layer. Language adapters (JS/TS today,
 * Python/Java later) all emit exactly these types.
 */

export const GRAPH_SCHEMA_VERSION = "1.0.0" as const;

export type Language = "javascript" | "typescript";

export type NodeKind =
  | "application"
  | "module"
  | "file"
  | "class"
  | "interface"
  | "function"
  | "method"
  | "route"
  | "middleware"
  | "database"
  | "query"
  | "external_api"
  | "queue"
  | "event"
  | "job"
  | "configuration"
  | "environment_variable"
  | "test"
  | "error"
  | "condition";

export type EdgeKind =
  | "imports"
  | "exports"
  | "calls"
  | "awaits"
  | "instantiates"
  | "extends"
  | "implements"
  | "reads"
  | "writes"
  | "returns"
  | "throws"
  | "catches"
  | "emits"
  | "subscribes"
  | "routes_to"
  | "runs_before"
  | "runs_after"
  | "validates"
  | "transforms"
  | "tests"
  | "depends_on";

/**
 * How a fact was established. The product must never present an inference as a
 * proven relationship, so every node and edge carries this.
 */
export type EvidenceType =
  | "syntactic"
  | "semantic"
  | "framework_inferred"
  | "ai_generated";

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

/** Provenance recorded on every graph fact. */
export interface Provenance {
  analyzer: string;
  analyzerVersion: string;
  language: Language;
  evidenceType: EvidenceType;
}

export type SemanticZoomLevel = 1 | 2 | 3 | 4 | 5;

export interface GraphNode {
  id: string;
  repositoryId: string;
  commitSha: string;
  language: Language;
  kind: NodeKind;
  name: string;
  qualifiedName?: string;
  parentId?: string;
  filePath?: string;
  source?: SourceRange;
  signature?: string;
  summary?: string;
  tags: string[];
  visibility?: "private" | "internal" | "public";
  frameworkRole?: string;
  analysisConfidence: number;
  sourceFingerprint?: string;
  provenance: Provenance;
  /** Lowest semantic zoom level at which this node should be shown. */
  zoomLevel: SemanticZoomLevel;
  /** True for code the team owns; false for collapsed dependency boundaries. */
  applicationOwned: boolean;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  repositoryId: string;
  commitSha: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: EdgeKind;
  label?: string;
  /** Exact source expression for a conditional edge, verbatim. */
  condition?: string;
  sourceLocation?: SourceLocation;
  analysisConfidence: number;
  provenance: Provenance;
  metadata: Record<string, unknown>;
}

export interface RepositoryFramework {
  name: string;
  confidence: number;
  evidence: string;
}

export interface GraphSnapshot {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  repositoryId: string;
  commitSha: string;
  analyzerVersion: string;
  generatedAt: string;
  frameworks: RepositoryFramework[];
  entryPoints: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  warnings: AnalysisWarning[];
  /**
   * File contents, keyed by repository-relative path.
   *
   * Kept out of every graph response and served only by the source endpoint —
   * the canvas must never ship a repository's code just to draw boxes.
   */
  sources?: Record<string, string>;
}

/** A module-level declaration, listed on its file rather than given a node. */
export interface FileDefinition {
  name: string;
  keyword: "const" | "let" | "var" | "type" | "interface" | "enum";
  line: number;
  exported: boolean;
  typeText?: string;
}

export interface GraphStats {
  fileCount: number;
  functionCount: number;
  classCount: number;
  routeCount: number;
  externalApiCount: number;
  databaseCount: number;
  /** Share of call expressions the type checker resolved to a definition. */
  resolvedCallRatio: number;
}

export interface AnalysisWarning {
  code: string;
  message: string;
  filePath?: string;
}

/** Node tags applied by the analyzer. Filterable in the UI. */
export const TAGS = {
  ASYNC: "async",
  EXPORTED: "exported",
  ROUTE_HANDLER: "route-handler",
  MIDDLEWARE: "middleware",
  CALLS_EXTERNAL_API: "calls-external-api",
  READS_DATABASE: "reads-database",
  WRITES_DATABASE: "writes-database",
  EMITS_EVENT: "emits-event",
  USES_ENV_VAR: "uses-env-var",
  AUTHENTICATION: "authentication",
  VALIDATION: "validation",
  ERROR_HANDLING: "error-handling",
  RECURSIVE: "recursive",
  HIGH_FAN_IN: "high-fan-in",
  HIGH_FAN_OUT: "high-fan-out",
  NO_TESTS_DETECTED: "no-tests-detected",
  UNRESOLVED_DYNAMIC_CALL: "unresolved-dynamic-call",
} as const;

export type Tag = (typeof TAGS)[keyof typeof TAGS];

/** Query contract for graph endpoints. Never returns a whole repository. */
export interface NeighbourhoodQuery {
  commitSha: string;
  nodeId?: string;
  depth?: number;
  direction?: "in" | "out" | "both";
  nodeKinds?: NodeKind[];
  edgeKinds?: EdgeKind[];
  tags?: string[];
  zoomLevel?: SemanticZoomLevel;
  maxNodes?: number;
  minConfidence?: number;
  applicationOwnedOnly?: boolean;
  cursor?: string;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  nextCursor?: string;
}
