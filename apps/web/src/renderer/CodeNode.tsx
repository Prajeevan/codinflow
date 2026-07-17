import type { CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { GraphNode } from "@codinflow/graph-schema";
import type { CallInfo, CodeNodeData } from "./adapter";

/**
 * Visual grammar (BRIEF §7).
 *
 * Every kind carries a glyph and a shape, so the map stays readable without
 * relying on colour alone.
 */
// Accents are CSS custom properties so a single theme swap recolours every node
// without re-rendering React. Each token is defined for light and dark in
// styles.css; see `--kind-*` / `--http-*`.
const KIND_STYLE: Record<string, { glyph: string; accent: string; shape: string }> = {
  application: { glyph: "▣", accent: "var(--kind-application)", shape: "rounded" },
  file: { glyph: "▤", accent: "var(--kind-file)", shape: "rounded" },
  function: { glyph: "ƒ", accent: "var(--kind-function)", shape: "rounded" },
  method: { glyph: "ƒ", accent: "var(--kind-method)", shape: "rounded" },
  class: { glyph: "◆", accent: "var(--kind-class)", shape: "rounded" },
  interface: { glyph: "◇", accent: "var(--kind-interface)", shape: "rounded" },
  route: { glyph: "→", accent: "var(--kind-route)", shape: "pill" },
  middleware: { glyph: "⊞", accent: "var(--kind-middleware)", shape: "pill" },
  database: { glyph: "⛁", accent: "var(--kind-database)", shape: "cylinder" },
  external_api: { glyph: "☁", accent: "var(--kind-external_api)", shape: "cloud" },
  queue: { glyph: "≡", accent: "var(--kind-queue)", shape: "cylinder" },
  event: { glyph: "✦", accent: "var(--kind-event)", shape: "pill" },
  error: { glyph: "⚠", accent: "var(--kind-error)", shape: "rounded" },
  environment_variable: { glyph: "$", accent: "var(--kind-environment_variable)", shape: "pill" },
  condition: { glyph: "◈", accent: "var(--kind-condition)", shape: "rounded" },
  test: { glyph: "✓", accent: "var(--kind-test)", shape: "rounded" },
  module: { glyph: "▥", accent: "var(--kind-module)", shape: "rounded" },
};

const HTTP_COLORS: Record<string, string> = {
  GET: "var(--http-get)",
  POST: "var(--http-post)",
  PUT: "var(--http-put)",
  PATCH: "var(--http-patch)",
  DELETE: "var(--http-delete)",
};

/** Tags worth surfacing on the canvas; the rest live in the inspector. */
const HEADLINE_TAGS = new Set([
  "writes-database",
  "reads-database",
  "calls-external-api",
  "authentication",
  "route-handler",
  "middleware",
  "unresolved-dynamic-call",
]);

const CHANGE_LABEL: Record<string, string> = { added: "new", changed: "modified", removed: "removed" };

/** Symbol kinds that read as "does something" and deserve a description line. */
const DESCRIBABLE = new Set(["function", "method", "class"]);

/**
 * A short, factual line of what a symbol does — so a card is never blank.
 *
 * Prefers a real summary (the Pro AI explanation) when one exists; otherwise it
 * is derived only from proven facts: the inferred return type and behaviour tags.
 * Nothing here is invented — a richer natural-language description ("iterates
 * over TICKER", "gates authenticated users") is the AI summary, not this.
 */
function describeNode(graphNode: GraphNode): string | undefined {
  if (graphNode.summary) return graphNode.summary;
  if (!DESCRIBABLE.has(graphNode.kind)) return undefined;

  const tags = new Set(graphNode.tags);
  const parts: string[] = [];
  if (tags.has("authentication")) parts.push("auth-gated");
  if (tags.has("writes-database")) parts.push("writes data");
  else if (tags.has("reads-database")) parts.push("reads data");
  if (tags.has("calls-external-api")) parts.push("calls external API");
  if (tags.has("validation")) parts.push("validates input");

  const returns = returnDescriptor(graphNode.signature);
  if (returns) parts.push(returns);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Most calls listed inline on a card before collapsing to "+N more". */
const MAX_INLINE_CALLS = 4;

/**
 * The calls a function makes, as readable, clickable rows. A conditional call
 * shows its guard ("if is audio → transcode()"); a plain one just the callee.
 * Clicking a row selects that function on the canvas (handled in App via the
 * row's data-node-id).
 */
function CallList({ calls }: { calls: CallInfo[] }) {
  if (calls.length === 0) return null;
  const shown = calls.slice(0, MAX_INLINE_CALLS);

  return (
    <div className="node-calls">
      {shown.map((call, index) => (
        <button
          key={`${call.id}:${index}`}
          type="button"
          className="call-row"
          data-node-id={call.id}
          title={`Go to ${call.name}`}
        >
          {call.guard && <span className="call-guard">{call.guard}</span>}
          <span className="call-arrow" aria-hidden="true">
            →
          </span>
          <span className="call-name">{call.name}()</span>
        </button>
      ))}
      {calls.length > shown.length && <span className="call-more">+{calls.length - shown.length} more calls</span>}
    </div>
  );
}

/** Turn a signature's inferred return type into "returns …". */
function returnDescriptor(signature?: string): string | undefined {
  if (!signature) return undefined;
  const match = signature.match(/\):\s*(.+)$/);
  const returnType = match?.[1]?.trim();
  if (!returnType || /^(void|Promise<void>|undefined)$/.test(returnType)) return undefined;
  if (/\b(JSX\.Element|ReactElement|ReactNode|Element)\b/.test(returnType)) return "returns JSX";
  const clean = returnType.replace(/\s+/g, " ");
  return `returns ${clean.length > 24 ? `${clean.slice(0, 22)}…` : clean}`;
}

export function CodeNode({ data, selected }: NodeProps<Node<CodeNodeData>>) {
  const { graphNode, changeState, dimmed, calls } = data;
  const style = KIND_STYLE[graphNode.kind] ?? KIND_STYLE.function!;
  const httpMethod = graphNode.metadata?.httpMethod as string | undefined;
  const accent = httpMethod ? (HTTP_COLORS[httpMethod] ?? style.accent) : style.accent;
  const nested = Boolean(graphNode.parentId) && ["function", "method", "class"].includes(graphNode.kind);
  const headline = graphNode.tags.filter((tag) => HEADLINE_TAGS.has(tag));
  const description = describeNode(graphNode);

  return (
    <div
      className={[
        "code-node",
        nested ? "nested" : "",
        selected ? "selected" : "",
        dimmed ? "dimmed" : "",
        changeState ? `change-${changeState}` : "",
        graphNode.applicationOwned ? "" : "external",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--node-accent": accent } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header: a colour-coded icon and the name — what you scan first. */}
      <div className="node-header">
        <span className="node-icon" aria-hidden="true">
          {style.glyph}
        </span>
        <span className="node-title" title={graphNode.qualifiedName ?? graphNode.name}>
          {graphNode.name}
        </span>

        {changeState && <span className={`change-badge ${changeState}`}>{CHANGE_LABEL[changeState]}</span>}

        {/* Every symbol offers its code, one click away. */}
        {graphNode.filePath && (
          <span className="code-icon" title="Open source">
            {"</>"}
          </span>
        )}
      </div>

      {/* A nested chip has no body, so its description and calls sit under the header. */}
      {nested && (description || calls.length > 0) && (
        <div className="nested-body">
          {description && <div className="node-desc">{description}</div>}
          <CallList calls={calls} />
        </div>
      )}

      {!nested && (
        <div className="node-body">
          <div className="node-meta-row">
            {httpMethod && <span className={`route-method method-${httpMethod}`}>{httpMethod}</span>}
            <span className="node-kind">{graphNode.kind.replace(/_/g, " ")}</span>
          </div>

          {description && <div className="node-desc">{description}</div>}

          <CallList calls={calls} />

          {graphNode.filePath && <div className="node-path">{graphNode.filePath}</div>}

          {headline.length > 0 && (
            <div className="tags">
              {headline.slice(0, 3).map((tag) => (
                <span key={tag} className={`tag tag-${tag}`}>
                  {tag.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Uncertainty is shown on the node itself rather than hidden in a panel. */}
      {graphNode.analysisConfidence < 0.8 && (
        <span className="confidence" title={`Analysis confidence ${Math.round(graphNode.analysisConfidence * 100)}%`}>
          ~{Math.round(graphNode.analysisConfidence * 100)}%
        </span>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
