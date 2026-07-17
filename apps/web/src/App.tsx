import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNode, GraphView, SemanticZoomLevel } from "@codinflow/graph-schema";
import { api } from "./api";
import { CodeNode } from "./renderer/CodeNode";
import { FileContainer } from "./renderer/FileContainer";
import { reactFlowAdapter, type ChangeState, type CodeNodeData } from "./renderer/adapter";
import { Inspector } from "./Inspector";
import { CodePanel } from "./CodePanel";
import { OverviewPanel } from "./OverviewPanel";
import { DiffPanel } from "./DiffPanel";
import { useTheme, type ThemeChoice } from "./useTheme";

const nodeTypes = { code: CodeNode, fileContainer: FileContainer };

/** Below this, node labels stop being readable — pan instead of shrinking. */
const MIN_READABLE_ZOOM = 0.62;

const ZOOM_LABELS: Record<SemanticZoomLevel, string> = {
  1: "System",
  2: "Features & routes",
  3: "Files & functions",
  4: "Everything",
  5: "Source",
};

const THEME_GLYPH: Record<ThemeChoice, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

type Mode = { kind: "overview" } | { kind: "path"; routeId: string } | { kind: "diff"; base: string; head: string };
interface OpenCode {
  filePath: string;
  title: string;
  highlight?: { startLine: number; endLine: number };
}

function Workspace() {
  const [repositoryId, setRepositoryId] = useState<string>("");
  const [commitSha, setCommitSha] = useState<string>("");
  // Files-and-functions is the default: it is the view that reads like the code.
  const [zoomLevel, setZoomLevel] = useState<SemanticZoomLevel>(3);
  const [mode, setMode] = useState<Mode>({ kind: "overview" });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<OpenCode | null>(null);
  const [applicationOwnedOnly, setApplicationOwnedOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const theme = useTheme();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CodeNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, setViewport } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);

  // Refs read inside the view effect without making it re-run: resizing the
  // canvas (e.g. opening/closing the code panel) must not rebuild the graph and
  // wipe the current selection, and a rebuild must re-apply the selected flag.
  const selectedNodeIdRef = useRef<string | null>(null);
  selectedNodeIdRef.current = selectedNodeId;
  const canvasSizeRef = useRef({ width: canvasWidth, height: canvasHeight });
  canvasSizeRef.current = { width: canvasWidth, height: canvasHeight };

  const repositories = useQuery({ queryKey: ["repositories"], queryFn: api.repositories });

  // Default to whichever repository was analyzed most recently.
  useEffect(() => {
    if (repositoryId || !repositories.data) return;
    const first = repositories.data.repositories[0];
    if (first) setRepositoryId(first.id);
  }, [repositories.data, repositoryId]);

  const commits = useQuery({
    queryKey: ["commits", repositoryId],
    queryFn: () => api.commits(repositoryId),
    enabled: Boolean(repositoryId),
  });

  useEffect(() => {
    if (!commits.data) return;
    const known = commits.data.commits.some((commit) => commit.commit_sha === commitSha);
    if (!known) setCommitSha(commits.data.commits[0]?.commit_sha ?? "");
  }, [commits.data, commitSha]);

  const overview = useQuery({
    queryKey: ["overview", repositoryId, commitSha],
    queryFn: () => api.overview(repositoryId, commitSha),
    enabled: Boolean(repositoryId && commitSha),
  });

  const diff = useQuery({
    queryKey: ["diff", repositoryId, mode],
    queryFn: () => api.diff(repositoryId, (mode as { base: string }).base, (mode as { head: string }).head),
    enabled: mode.kind === "diff",
  });

  const view = useQuery<GraphView>({
    queryKey: ["graph", repositoryId, commitSha, mode, zoomLevel, applicationOwnedOnly],
    queryFn: () => {
      if (mode.kind === "path") return api.path(repositoryId, mode.routeId, commitSha);
      return api.graph(repositoryId, {
        commitSha: mode.kind === "diff" ? mode.head : commitSha,
        zoomLevel,
        applicationOwnedOnly,
        maxNodes: 400,
      });
    },
    enabled: Boolean(repositoryId && commitSha),
  });

  const search = useQuery({
    queryKey: ["search", repositoryId, commitSha, searchTerm],
    queryFn: () => api.search(repositoryId, searchTerm, commitSha),
    enabled: Boolean(repositoryId) && searchTerm.trim().length > 1,
  });

  const changedNodeIds = useMemo(() => {
    const map = new Map<string, ChangeState>();
    if (mode.kind !== "diff" || !diff.data) return map;

    for (const change of diff.data.changes) {
      if (!change.nodeId) continue;
      if (change.kind.endsWith("_added")) map.set(change.nodeId, "added");
      else if (change.kind.endsWith("_removed")) map.set(change.nodeId, "removed");
      else map.set(change.nodeId, "changed");
    }
    return map;
  }, [mode, diff.data]);

  useEffect(() => {
    if (!view.data) return;
    let cancelled = false;

    void reactFlowAdapter.createView(view.data, { zoomLevel, changedNodeIds, direction: "RIGHT" }).then((renderable) => {
      if (cancelled) return;
      // Preserve the current selection across a rebuild, so a re-layout never
      // silently clears the highlighted node.
      const selectedId = selectedNodeIdRef.current;
      setNodes(
        selectedId ? renderable.nodes.map((node) => (node.id === selectedId ? { ...node, selected: true } : node)) : renderable.nodes,
      );
      setEdges(renderable.edges);

      // Frame from ELK's own coordinates: fitView would have to wait for React
      // Flow to measure, and reads stale dimensions when the node set swaps.
      //
      // MIN_READABLE_ZOOM is the point: fitting a whole repository on screen
      // shrinks every label into confetti. Below that we stop zooming out and
      // let the reader pan a legible map instead. Canvas size is read from a ref
      // so a resize (opening/closing the code panel) doesn't re-run this effect.
      const { width, height } = canvasSizeRef.current;
      if (renderable.nodes.length > 0 && width > 0) {
        const viewport = getViewportForBounds(boundsOf(renderable.nodes), width, height, MIN_READABLE_ZOOM, 1.2, 0.12);
        requestAnimationFrame(() => setViewport(viewport, { duration: 400 }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [view.data, zoomLevel, changedNodeIds, setNodes, setEdges, setViewport]);

  // React Flow drives the node's `selected` prop from its own internal selection,
  // which only updates on a physical canvas click. Mirror our selection into node
  // state so selecting from the code panel, inspector or search lights the node up
  // on the canvas too.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === selectedNodeId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedNodeId, setNodes]);

  const focusNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      if (nodes.some((node) => node.id === nodeId)) {
        void fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.3 });
      }
    },
    [nodes, fitView],
  );

  const showCode = useCallback(
    (node: GraphNode) => {
      if (!node.filePath) return;
      // Opening code keeps the node selected and frames it, so it stays obvious
      // on the canvas which block the source belongs to.
      setSelectedNodeId(node.id);
      setOpenCode({
        filePath: node.filePath,
        title: node.name,
        highlight: node.source ? { startLine: node.source.startLine, endLine: node.source.endLine } : undefined,
      });
      if (nodes.some((candidate) => candidate.id === node.id)) {
        void fitView({ nodes: [{ id: node.id }], duration: 400, maxZoom: 1.3 });
      }
    },
    [nodes, fitView],
  );

  // Symbols defined in the open file that are also drawn on the canvas. The code
  // view makes each one clickable, so reading source and reading the map stay in
  // sync in both directions.
  const fileSymbols = useMemo(() => {
    if (!openCode) return [];
    return nodes
      .map((node) => node.data.graphNode)
      .filter(
        (graphNode) =>
          graphNode.filePath === openCode.filePath &&
          graphNode.source !== undefined &&
          graphNode.kind !== "file" &&
          graphNode.kind !== "application",
      )
      .map((graphNode) => ({
        id: graphNode.id,
        name: graphNode.name,
        kind: graphNode.kind,
        startLine: graphNode.source!.startLine,
        endLine: graphNode.source!.endLine,
      }));
  }, [nodes, openCode]);

  const activeCommit = mode.kind === "diff" ? mode.head : commitSha;
  // A dot on "More" advertises that a hidden control is in a non-default state.
  const moreActive = applicationOwnedOnly || mode.kind !== "overview" || zoomLevel !== 3;

  if (repositories.isLoading) return <Splash message="Loading repositories…" />;
  if (repositories.data && repositories.data.repositories.length === 0) return <ConnectHelp />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">◈</span> CodinFlow
          <span className="plan-badge" title="Everything is free right now. A Pro plan with AI explanations and team features is coming.">
            Free · Pro soon
          </span>
        </div>

        <label className="controls">
          <select value={repositoryId} onChange={(event) => selectRepository(event.target.value)} aria-label="Repository">
            {(repositories.data?.repositories ?? []).map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.id}
              </option>
            ))}
          </select>
        </label>

        <div className="toolbar">
          <div className="search">
            <input
              type="search"
              placeholder="Search functions, routes, files…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {search.data && searchTerm.trim().length > 1 && (
              <ul className="search-results">
                {search.data.results.slice(0, 8).map((result) => (
                  <li key={result.id}>
                    <button type="button" onClick={() => focusNode(result.id)}>
                      <span className="result-kind">{result.kind}</span> {result.name}
                      {result.file_path && <span className="muted mono tiny"> {result.file_path}</span>}
                    </button>
                  </li>
                ))}
                {search.data.results.length === 0 && <li className="muted small pad">No matches</li>}
              </ul>
            )}
          </div>

          <div className="more">
            <button
              type="button"
              className="more-button"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              More
              {moreActive && <span className="dot" aria-hidden="true" />}
            </button>
            {moreOpen && (
              <>
                <div className="scrim" onClick={() => setMoreOpen(false)} />
                <div className="popover" role="menu">
                  <div className="menu-row">
                    <span className="menu-label">Detail</span>
                    <select
                      value={zoomLevel}
                      disabled={mode.kind === "path"}
                      onChange={(event) => setZoomLevel(Number(event.target.value) as SemanticZoomLevel)}
                    >
                      {([1, 2, 3, 4] as SemanticZoomLevel[]).map((level) => (
                        <option key={level} value={level}>
                          {ZOOM_LABELS[level]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="menu-row">
                    <span className="menu-label">Commit</span>
                    <select value={commitSha} onChange={(event) => setCommitSha(event.target.value)}>
                      {(commits.data?.commits ?? []).map((commit) => (
                        <option key={commit.commit_sha} value={commit.commit_sha}>
                          {commit.commit_sha}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="menu-row">
                    <label className="menu-toggle">
                      <input
                        type="checkbox"
                        checked={applicationOwnedOnly}
                        onChange={(event) => setApplicationOwnedOnly(event.target.checked)}
                      />
                      Our code only
                    </label>
                  </div>

                  {(commits.data?.commits.length ?? 0) > 1 && (
                    <div className="menu-row">
                      <button
                        type="button"
                        className={mode.kind === "diff" ? "active" : ""}
                        onClick={() => {
                          setMode((current) => (current.kind === "diff" ? { kind: "overview" } : latestDiff()));
                          setMoreOpen(false);
                        }}
                      >
                        {mode.kind === "diff" ? "Stop reviewing" : "Review changes"}
                      </button>
                    </div>
                  )}

                  {mode.kind !== "overview" && (
                    <div className="menu-row">
                      <button
                        type="button"
                        onClick={() => {
                          setMode({ kind: "overview" });
                          setMoreOpen(false);
                        }}
                      >
                        Back to map
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            className="toolbar-toggle"
            onClick={theme.cycle}
            title={`Theme: ${theme.choice}`}
            aria-label={`Theme: ${theme.choice}. Click to change.`}
          >
            {THEME_GLYPH[theme.choice]}
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="sidebar">
          {mode.kind === "diff" && diff.data ? (
            <DiffPanel diff={diff.data} onSelectNode={focusNode} />
          ) : (
            overview.data && (
              <OverviewPanel
                overview={overview.data}
                onFocusRoute={(routeId) => setMode({ kind: "path", routeId })}
                onSelectNode={focusNode}
              />
            )
          )}
          {overview.error && <p className="error pad">{String(overview.error)}</p>}
        </div>

        <main className="canvas">
          {mode.kind === "path" && (
            <div className="canvas-banner">
              Execution path · middleware, handler, services, data stores and error paths for this route.
            </div>
          )}
          {mode.kind === "diff" && (
            <div className="canvas-banner">
              Reviewing {(mode as { base: string }).base} → {(mode as { head: string }).head} · new and modified blocks
              are highlighted.
            </div>
          )}
          {view.data?.truncated && (
            <div className="canvas-banner warn">
              This view was truncated to stay readable. Narrow the filters or open a specific route.
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(event, node) => {
              setSelectedNodeId(node.id);
              // The code icon opens the source directly; anything else selects.
              if ((event.target as HTMLElement).classList.contains("code-icon")) {
                showCode((node.data as CodeNodeData).graphNode);
              }
            }}
            onNodeDoubleClick={(_event, node) => showCode((node.data as CodeNodeData).graphNode)}
            onPaneClick={() => setSelectedNodeId(null)}
            minZoom={0.05}
            maxZoom={2}
          >
            <Background gap={24} color="var(--canvas-dot)" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              bgColor="var(--minimap-bg)"
              nodeColor={(node) =>
                (node.data as CodeNodeData).graphNode.applicationOwned ? "var(--minimap-app)" : "var(--minimap-external)"
              }
              nodeStrokeColor="var(--minimap-stroke)"
              maskColor="var(--minimap-mask)"
              style={{ border: "1px solid var(--border)", borderRadius: 10 }}
            />
          </ReactFlow>
        </main>

        {openCode ? (
          <CodePanel
            repositoryId={repositoryId}
            commitSha={activeCommit}
            filePath={openCode.filePath}
            highlight={openCode.highlight}
            title={openCode.title}
            symbols={fileSymbols}
            selectedNodeId={selectedNodeId}
            onSelectSymbol={focusNode}
            onClose={() => setOpenCode(null)}
          />
        ) : (
          <Inspector
            repositoryId={repositoryId}
            commitSha={activeCommit}
            nodeId={selectedNodeId}
            onSelectNode={focusNode}
            onOpenCode={showCode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );

  function selectRepository(next: string): void {
    setRepositoryId(next);
    setCommitSha("");
    setMode({ kind: "overview" });
    setSelectedNodeId(null);
    setOpenCode(null);
  }

  /** Compare the two most recent snapshots. */
  function latestDiff(): Mode {
    const list = commits.data?.commits ?? [];
    return { kind: "diff", base: list[1]?.commit_sha ?? "", head: list[0]?.commit_sha ?? "" };
  }
}

function Splash({ message }: { message: string }) {
  return (
    <div className="splash">
      <span className="mark">◈</span>
      <p className="muted">{message}</p>
    </div>
  );
}

/** Shown when nothing has been analyzed yet — the app is empty without a repo. */
function ConnectHelp() {
  return (
    <div className="splash connect">
      <span className="mark">◈</span>
      <h1>Connect a repository</h1>
      <p className="muted">Analyze a local folder or a public GitHub repository, then reload this page.</p>
      <pre>
        {`# from the CodinFlow checkout
export CODINFLOW_API=https://codinflow-api.software-93f.workers.dev
export CODINFLOW_TOKEN=<your ingest token>

# a local folder
pnpm codinflow ~/code/my-app

# a public GitHub repository
pnpm codinflow honojs/hono`}
      </pre>
    </div>
  );
}

/** Bounding box of laid-out nodes, from ELK coordinates and node sizes. */
function boundsOf(nodes: Node<CodeNodeData>[]): { x: number; y: number; width: number; height: number } {
  // Children are positioned relative to their parent, so only roots set bounds.
  const roots = nodes.filter((node) => !node.parentId);
  const source = roots.length > 0 ? roots : nodes;

  return {
    x: Math.min(...source.map((node) => node.position.x)),
    y: Math.min(...source.map((node) => node.position.y)),
    width:
      Math.max(...source.map((node) => node.position.x + node.data.width)) -
      Math.min(...source.map((node) => node.position.x)),
    height:
      Math.max(...source.map((node) => node.position.y + node.data.height)) -
      Math.min(...source.map((node) => node.position.y)),
  };
}
