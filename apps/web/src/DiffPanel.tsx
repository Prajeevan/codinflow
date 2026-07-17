import type { Diff, DiffChange } from "./api";

interface DiffPanelProps {
  diff: Diff;
  onSelectNode: (nodeId: string) => void;
}

const IMPACT_LABEL: Record<string, string> = {
  directly_affected: "Directly affected",
  probably_affected: "Probably affected",
  potentially_affected: "Potentially affected",
};

/** Commit review (BRIEF Flow E): behavioural changes, not line changes. */
export function DiffPanel({ diff, onSelectNode }: DiffPanelProps) {
  const behavioural = diff.changes.filter((change) => !change.kind.startsWith("edge_"));
  const relationships = diff.changes.filter((change) => change.kind.startsWith("edge_"));

  return (
    <div className="panel">
      <header className="diff-header">
        <h2>Commit comparison</h2>
        <span className={`risk risk-${diff.riskLevel}`}>{diff.riskLevel} risk</span>
      </header>

      <p className="mono tiny muted">
        {diff.baseSha} → {diff.headSha}
      </p>

      <section className="panel-section">
        <h3>Summary</h3>
        <p className="summary">{diff.summary}</p>
        <p className="muted tiny">
          Built from the classified changes below — every sentence corresponds to an entry you can open.
        </p>
      </section>

      <ChangeList title="Behavioural changes" changes={behavioural} onSelectNode={onSelectNode} />
      <ChangeList title="Relationship changes" changes={relationships} onSelectNode={onSelectNode} />

      <section className="panel-section">
        <h3>Blast radius ({diff.blastRadius.length})</h3>
        {diff.blastRadius.length === 0 ? (
          <p className="muted small">Nothing else calls the changed symbols.</p>
        ) : (
          <ul className="plain">
            {diff.blastRadius.map((entry) => (
              <li key={entry.nodeId}>
                <button type="button" className="link" onClick={() => onSelectNode(entry.nodeId)}>
                  {entry.name}
                </button>
                <span className={`impact impact-${entry.level}`}>{IMPACT_LABEL[entry.level] ?? entry.level}</span>
                <p className="muted tiny">{entry.reason}</p>
              </li>
            ))}
          </ul>
        )}
        {/* Blast radius is graded, never asserted as certainty (BRIEF §11). */}
        <p className="muted tiny">
          Static reachability only. Dynamic dispatch and runtime wiring are not captured.
        </p>
      </section>
    </div>
  );
}

function ChangeList({
  title,
  changes,
  onSelectNode,
}: {
  title: string;
  changes: DiffChange[];
  onSelectNode: (nodeId: string) => void;
}) {
  if (changes.length === 0) return null;

  return (
    <section className="panel-section">
      <h3>
        {title} ({changes.length})
      </h3>
      <ul className="plain changes">
        {changes.map((change, index) => (
          <li key={`${change.kind}-${change.nodeId ?? change.edgeId ?? index}`}>
            <span className={`change-kind ${changeTone(change.kind)}`}>{change.kind.replace(/_/g, " ")}</span>
            {change.nodeId ? (
              <button type="button" className="link" onClick={() => onSelectNode(change.nodeId!)}>
                {change.name}
              </button>
            ) : (
              <span className="name">{change.name}</span>
            )}
            <p className="detail">{change.detail}</p>
            {change.filePath && (
              <p className="muted mono tiny">
                {change.filePath}:{change.line}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function changeTone(kind: string): string {
  if (kind === "authentication_changed") return "danger";
  if (kind.endsWith("_removed")) return "removed";
  if (kind.endsWith("_added")) return "added";
  return "changed";
}
