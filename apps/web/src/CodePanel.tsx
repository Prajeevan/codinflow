import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** A symbol defined in this file that also exists on the canvas. */
export interface FileSymbol {
  id: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
}

interface CodePanelProps {
  repositoryId: string;
  commitSha: string;
  filePath: string;
  highlight?: { startLine: number; endLine: number };
  title: string;
  symbols: FileSymbol[];
  selectedNodeId: string | null;
  onSelectSymbol: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * Read-only source view (BRIEF Flow D).
 *
 * Scrolls to and highlights the selected symbol's lines, so clicking a block on
 * the canvas lands on the code it was derived from — and clicking a function in
 * the source selects it back on the canvas, keeping both views in sync.
 */
export function CodePanel({
  repositoryId,
  commitSha,
  filePath,
  highlight,
  title,
  symbols,
  selectedNodeId,
  onSelectSymbol,
  onClose,
}: CodePanelProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["source", repositoryId, commitSha, filePath],
    queryFn: () => api.source(repositoryId, filePath, commitSha),
  });

  // The active symbol is whatever is selected on the canvas, when it lives in
  // this file — so selecting a node re-highlights the right lines here.
  const activeSymbol = useMemo(
    () => symbols.find((symbol) => symbol.id === selectedNodeId) ?? null,
    [symbols, selectedNodeId],
  );
  const activeRange = activeSymbol
    ? { startLine: activeSymbol.startLine, endLine: activeSymbol.endLine }
    : highlight;

  // For each line, the innermost symbol that owns it. Nested definitions win
  // over the enclosing one, so clicking a method selects the method, not its class.
  const ownerByLine = useMemo(() => {
    const owner = new Map<number, FileSymbol>();
    const span = (symbol: FileSymbol) => symbol.endLine - symbol.startLine;
    for (const symbol of symbols) {
      for (let line = symbol.startLine; line <= symbol.endLine; line += 1) {
        const current = owner.get(line);
        if (!current || span(symbol) < span(current)) owner.set(line, symbol);
      }
    }
    return owner;
  }, [symbols]);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [data, activeRange?.startLine]);

  const lines = data?.content.split("\n") ?? [];

  return (
    <aside className="code-panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p className="mono tiny muted">
            {filePath}
            {activeRange ? `:${activeRange.startLine}-${activeRange.endLine}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close code">
          ✕
        </button>
      </header>

      {isLoading && <p className="muted small pad">Loading source…</p>}
      {error && <p className="error pad">{String(error)}</p>}

      {data && (
        <div className="code-scroll">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const owner = ownerByLine.get(lineNumber);
            const isHighlighted =
              activeRange !== undefined && lineNumber >= activeRange.startLine && lineNumber <= activeRange.endLine;
            const isFirst = activeRange !== undefined && lineNumber === activeRange.startLine;
            const isOwnerStart = owner !== undefined && lineNumber === owner.startLine;

            return (
              <div
                key={lineNumber}
                ref={isFirst ? highlightRef : undefined}
                className={[
                  "code-line",
                  isHighlighted ? "highlighted" : "",
                  owner ? "in-symbol" : "",
                  isOwnerStart ? "symbol-start" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={owner ? () => onSelectSymbol(owner.id) : undefined}
                title={owner ? `Select ${owner.name} on the canvas` : undefined}
              >
                <span className="line-no">{lineNumber}</span>
                <code>{line || " "}</code>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
