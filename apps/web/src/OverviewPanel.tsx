import type { Overview } from "./api";
import { FrameworkIcon } from "./icons/frameworks";

interface OverviewPanelProps {
  overview: Overview;
  onFocusRoute: (routeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

type Route = Overview["routes"][number];

/** Most routes a single framework group lists before collapsing to "+N more". */
const ROUTES_PER_GROUP = 40;

/** Application overview (BRIEF Flow B): what is this app, and where does it start? */
export function OverviewPanel({ overview, onFocusRoute, onSelectNode }: OverviewPanelProps) {
  const { stats } = overview;

  return (
    <div className="panel">
      <h2>Application</h2>

      <div className="frameworks">
        {overview.frameworks.map((framework) => (
          <span key={framework.name} className="chip" title={framework.evidence}>
            <FrameworkIcon name={framework.name} size={15} />
            {framework.name}
          </span>
        ))}
        {overview.frameworks.length === 0 && <span className="muted small">No framework detected</span>}
      </div>

      <dl className="stats">
        <Stat label="Files" value={stats.fileCount} />
        <Stat label="Functions" value={stats.functionCount} />
        <Stat label="Classes" value={stats.classCount} />
        <Stat label="Routes" value={stats.routeCount} />
        <Stat label="External APIs" value={stats.externalApiCount} />
        <Stat label="Data stores" value={stats.databaseCount} />
      </dl>

      <Section title="Entry points">
        <ul className="plain mono small">
          {overview.entryPoints.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
          {overview.entryPoints.length === 0 && <li className="muted">None detected</li>}
        </ul>
      </Section>

      <Section title={`Routes (${overview.routes.length})`}>
        {overview.routes.length === 0 ? (
          <p className="muted small">No routes detected.</p>
        ) : (
          <>
            <RouteList routes={overview.routes} onFocusRoute={onFocusRoute} />
            <p className="muted tiny">Select a route to trace its execution path.</p>
          </>
        )}
      </Section>

      <Section title="External systems">
        <ul className="plain">
          {overview.externalSystems.map((system) => (
            <li key={system.id}>
              <button type="button" className="link" onClick={() => onSelectNode(system.id)}>
                {system.name}
              </button>
              <span className="muted tiny"> {system.kind.replace(/_/g, " ")}</span>
            </li>
          ))}
          {overview.externalSystems.length === 0 && <li className="muted small">None detected</li>}
        </ul>
      </Section>

      <Section title="Environment variables">
        <div className="tags">
          {overview.environmentVariables.map((name) => (
            <span key={name} className="tag">
              {name}
            </span>
          ))}
        </div>
      </Section>

      {/* Confidence is surfaced in the default view, not buried (BRIEF rule 16). */}
      <Section title="Analysis confidence">
        <p className="small">
          {Math.round(overview.analysisConfidence.resolvedCallRatio * 100)}% of call sites resolved to a definition.
        </p>
        {overview.analysisConfidence.unresolvedDynamicCalls > 0 ? (
          <p className="warning small">
            {overview.analysisConfidence.unresolvedDynamicCalls} function(s) contain dynamic calls that could not be
            resolved. Their outgoing edges may be incomplete.
          </p>
        ) : (
          <p className="muted small">No unresolved dynamic calls detected.</p>
        )}
        <p className="muted tiny">
          analyzer {overview.analyzerVersion} · schema {overview.schemaVersion}
        </p>
      </Section>

      {overview.warnings.length > 0 && (
        <Section title="Warnings">
          <ul className="plain small">
            {overview.warnings.map((warning) => (
              <li key={warning.code} className="warning">
                {warning.message}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/**
 * Routes grouped by the framework that declares them. Real apps expose hundreds
 * of routes, so each group is capped and the rest collapse to a count rather
 * than flooding the sidebar.
 */
function RouteList({ routes, onFocusRoute }: { routes: Route[]; onFocusRoute: (id: string) => void }) {
  const groups = new Map<string, Route[]>();
  for (const route of routes) {
    const key = route.framework ?? "Routes";
    const list = groups.get(key) ?? [];
    list.push(route);
    groups.set(key, list);
  }

  const grouped = groups.size > 1;

  return (
    <div className="route-groups">
      {[...groups.entries()].map(([framework, group]) => (
        <div key={framework}>
          {grouped && (
            <div className="route-group-label">
              {framework !== "Routes" && <FrameworkIcon name={framework} size={14} />}
              {framework} · {group.length}
            </div>
          )}
          <ul className="routes">
            {group.slice(0, ROUTES_PER_GROUP).map((route) => (
              <li key={route.id}>
                <button type="button" className="route-row" onClick={() => onFocusRoute(route.id)} title={route.filePath}>
                  <span className={`route-method method-${methodOf(route)}`}>{methodOf(route)}</span>
                  <span className="route-path">{pathOf(route)}</span>
                </button>
              </li>
            ))}
            {group.length > ROUTES_PER_GROUP && (
              <li className="route-more">+{group.length - ROUTES_PER_GROUP} more</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The HTTP method, from metadata or parsed from the "GET /x" name. */
function methodOf(route: Route): string {
  return route.httpMethod ?? route.name.split(/\s/, 1)[0] ?? "ANY";
}

/** The route path, from metadata-derived name or the name's second token. */
function pathOf(route: Route): string {
  const fromName = route.name.replace(/^\S+\s+/, "");
  return fromName || route.name;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
