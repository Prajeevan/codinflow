import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FileDefinition } from "@codinflow/graph-schema";
import type { CodeNodeData } from "./adapter";

const KEYWORD_CLASS: Record<FileDefinition["keyword"], string> = {
  const: "kw-const",
  let: "kw-let",
  var: "kw-var",
  type: "kw-type",
  interface: "kw-type",
  enum: "kw-type",
};

/**
 * A file, drawn as the container its symbols live in.
 *
 * The header carries what a reviewer scans first: the filename, whether the
 * commit touched it, and the module-level definitions — then the functions and
 * classes are laid out inside.
 */
export function FileContainer({ data, selected }: NodeProps<Node<CodeNodeData>>) {
  const { graphNode, changeState, childChanges, dimmed } = data;
  const definitions = (graphNode.metadata?.definitions as FileDefinition[] | undefined) ?? [];
  const shown = definitions.slice(0, 6);
  const touched = changeState ?? (childChanges ? "changed" : undefined);

  return (
    <div
      className={[
        "file-container",
        selected ? "selected" : "",
        dimmed ? "dimmed" : "",
        touched ? `change-${touched}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle type="target" position={Position.Left} />

      <div className="file-header">
        <div className="file-title">
          <span className="file-glyph" aria-hidden="true">
            ▤
          </span>
          <span className="file-name">{graphNode.name}</span>

          {touched && <ChangeSummary changeState={changeState} childChanges={childChanges} />}
        </div>

        <div className="file-path">{graphNode.filePath}</div>

        {shown.length > 0 && (
          <div className="definitions">
            <div className="definitions-label">Definitions</div>
            {shown.map((definition) => (
              <div key={`${definition.name}:${definition.line}`} className="definition">
                <span className={`kw ${KEYWORD_CLASS[definition.keyword]}`}>{definition.keyword}</span>
                <span className="def-name">{definition.name}</span>
                {definition.exported && <span className="def-export">export</span>}
                <span className="def-line">:{definition.line}</span>
              </div>
            ))}
            {definitions.length > shown.length && (
              <div className="definition more">+{definitions.length - shown.length} more</div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ChangeSummary({
  changeState,
  childChanges,
}: {
  changeState?: string;
  childChanges?: { added: number; changed: number; removed: number };
}) {
  if (changeState === "added") return <span className="change-badge added">new file</span>;
  if (changeState === "removed") return <span className="change-badge removed">deleted</span>;

  if (!childChanges) return null;
  const parts: string[] = [];
  if (childChanges.added) parts.push(`+${childChanges.added}`);
  if (childChanges.changed) parts.push(`~${childChanges.changed}`);
  if (childChanges.removed) parts.push(`-${childChanges.removed}`);
  if (parts.length === 0) return null;

  return <span className="change-badge changed">{parts.join(" ")} changed</span>;
}
