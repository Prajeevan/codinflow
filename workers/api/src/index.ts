import { Hono } from "hono";
import { cors } from "hono/cors";
import type { GraphSnapshot, NeighbourhoodQuery, NodeKind } from "@codinflow/graph-schema";
import { GraphStore, executionPath, nodeDetail, selectView } from "./graph-store.js";
import { diffSnapshots } from "@codinflow/graph-diff";

export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  CACHE: KVNamespace;
  AI: Ai;
  INGEST_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, service: "codinflow-api" }));

/** Root index. This worker is the data backend; the canvas lives elsewhere. */
app.get("/", (c) =>
  c.json({
    service: "codinflow-api",
    description: "Graph data backend for CodinFlow. Pair it with the CodinFlow web app.",
    endpoints: {
      health: "/api/health",
      repositories: "/api/v1/repositories",
      commits: "/api/v1/repositories/:repositoryId/commits",
      overview: "/api/v1/repositories/:repositoryId/overview",
      graph: "/api/v1/repositories/:repositoryId/graph?zoomLevel=2&maxNodes=300",
      executionPath: "/api/v1/repositories/:repositoryId/paths/:routeId",
      node: "/api/v1/repositories/:repositoryId/nodes/:nodeId",
      search: "/api/v1/repositories/:repositoryId/search?q=",
      diff: "/api/v1/repositories/:repositoryId/diff?base=&head=",
      ingest: "PUT /api/v1/repositories/:repositoryId/snapshots/:commitSha (requires bearer token)",
    },
    example: "/api/v1/repositories/fixture-express/overview",
  }),
);

app.notFound((c) => c.json({ error: "not found", hint: "See / for the endpoint index." }, 404));

/**
 * Ingests an analyzer snapshot.
 *
 * The analyzer needs a filesystem and the TypeScript compiler, so it runs
 * outside the Worker (locally or in CI today; an isolated Sandbox per BRIEF §12
 * later) and posts its result here. Writing the same commit twice is safe.
 */
app.put("/api/v1/repositories/:repositoryId/snapshots/:commitSha", async (c) => {
  // Fail closed. A missing INGEST_TOKEN must never mean "allow everyone" — this
  // endpoint writes to D1 and R2.
  const expected = c.env.INGEST_TOKEN;
  if (!expected) {
    return c.json({ error: "ingestion is not configured" }, 503);
  }
  if (!timingSafeEqual(c.req.header("authorization") ?? "", `Bearer ${expected}`)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const repositoryId = c.req.param("repositoryId");
  const commitSha = c.req.param("commitSha");
  const snapshot = (await c.req.json()) as GraphSnapshot;

  if (snapshot.repositoryId !== repositoryId || snapshot.commitSha !== commitSha) {
    return c.json({ error: "snapshot does not match the requested repository and commit" }, 400);
  }

  const store = new GraphStore(c.env.ARTIFACTS);
  const key = await store.put(snapshot);

  await c.env.DB.prepare(
    `INSERT INTO repositories (id, full_name, default_branch)
     VALUES (?1, ?2, 'main')
     ON CONFLICT (id) DO NOTHING`,
  )
    .bind(repositoryId, repositoryId)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO graph_snapshots
       (id, repository_id, commit_sha, r2_key, node_count, edge_count, resolved_call_ratio, frameworks, entry_points)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (repository_id, commit_sha) DO UPDATE SET
       r2_key = excluded.r2_key,
       node_count = excluded.node_count,
       edge_count = excluded.edge_count,
       resolved_call_ratio = excluded.resolved_call_ratio,
       frameworks = excluded.frameworks,
       entry_points = excluded.entry_points`,
  )
    .bind(
      `${repositoryId}:${commitSha}`,
      repositoryId,
      commitSha,
      key,
      snapshot.nodes.length,
      snapshot.edges.length,
      snapshot.stats.resolvedCallRatio,
      JSON.stringify(snapshot.frameworks),
      JSON.stringify(snapshot.entryPoints),
    )
    .run();

  // Symbol metadata lives in D1 so search never reads the R2 artifact.
  await c.env.DB.prepare(`DELETE FROM symbols WHERE repository_id = ?1 AND commit_sha = ?2`)
    .bind(repositoryId, commitSha)
    .run();

  const statements = snapshot.nodes.map((node) =>
    c.env.DB.prepare(
      `INSERT INTO symbols
         (id, repository_id, commit_sha, kind, name, qualified_name, file_path, start_line, end_line,
          signature, summary, tags, application_owned, analysis_confidence, source_fingerprint)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    ).bind(
      node.id,
      repositoryId,
      commitSha,
      node.kind,
      node.name,
      node.qualifiedName ?? null,
      node.filePath ?? null,
      node.source?.startLine ?? null,
      node.source?.endLine ?? null,
      node.signature ?? null,
      node.summary ?? null,
      JSON.stringify(node.tags),
      node.applicationOwned ? 1 : 0,
      node.analysisConfidence,
      node.sourceFingerprint ?? null,
    ),
  );

  for (const chunk of chunks(statements, 50)) {
    await c.env.DB.batch(chunk);
  }

  await c.env.CACHE.delete(`overview:v2:${repositoryId}:${commitSha}`);

  return c.json({ ok: true, key, nodes: snapshot.nodes.length, edges: snapshot.edges.length });
});

/**
 * Source of one file at one commit (BRIEF Flow D, source tab).
 *
 * Served only here, and only for a path the graph actually contains — the path
 * comes from a client, so it must never be able to reach an arbitrary key.
 */
app.get("/api/v1/repositories/:repositoryId/source", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const filePath = c.req.query("filePath");
  if (!filePath) return c.json({ error: "filePath is required" }, 400);

  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ error: "no analyzed commit for this repository" }, 404);

  const snapshot = await new GraphStore(c.env.ARTIFACTS).get(repositoryId, commitSha);
  if (!snapshot) return c.json({ error: "snapshot not found" }, 404);

  const known = snapshot.nodes.some((node) => node.kind === "file" && node.filePath === filePath);
  if (!known) return c.json({ error: "no such file in this snapshot" }, 404);

  const content = snapshot.sources?.[filePath];
  if (content === undefined) return c.json({ error: "source not captured for this snapshot" }, 404);

  return c.json({ filePath, commitSha, content });
});

/** Repository overview panel (BRIEF Flow B). */
app.get("/api/v1/repositories/:repositoryId/overview", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ error: "no analyzed commit for this repository" }, 404);

  // v2: route rows now carry httpMethod/framework/routeType; the key bump drops
  // overviews cached by the old handler that omitted them.
  const cacheKey = `overview:v2:${repositoryId}:${commitSha}`;
  const cached = await c.env.CACHE.get(cacheKey, "json");
  if (cached) return c.json(cached);

  const snapshot = await new GraphStore(c.env.ARTIFACTS).get(repositoryId, commitSha);
  if (!snapshot) return c.json({ error: "snapshot not found" }, 404);

  const overview = {
    repositoryId,
    commitSha,
    analyzerVersion: snapshot.analyzerVersion,
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    frameworks: snapshot.frameworks,
    entryPoints: snapshot.entryPoints,
    stats: snapshot.stats,
    warnings: snapshot.warnings,
    routes: snapshot.nodes
      .filter((node) => node.kind === "route")
      .map((node) => ({
        id: node.id,
        name: node.name,
        filePath: node.filePath,
        httpMethod: node.metadata?.httpMethod as string | undefined,
        framework: node.metadata?.framework as string | undefined,
        routeType: node.metadata?.routeType as string | undefined,
      })),
    externalSystems: snapshot.nodes
      .filter((node) => !node.applicationOwned && node.kind !== "module")
      .map((node) => ({ id: node.id, name: node.name, kind: node.kind })),
    environmentVariables: snapshot.nodes.filter((node) => node.kind === "environment_variable").map((node) => node.name),
    riskiestFunctions: snapshot.nodes
      .filter((node) => node.tags.includes("high-fan-in") || node.tags.includes("unresolved-dynamic-call"))
      .map((node) => ({ id: node.id, name: node.name, tags: node.tags })),
    analysisConfidence: {
      resolvedCallRatio: snapshot.stats.resolvedCallRatio,
      unresolvedDynamicCalls: snapshot.nodes.filter((node) => node.tags.includes("unresolved-dynamic-call")).length,
    },
  };

  await c.env.CACHE.put(cacheKey, JSON.stringify(overview), { expirationTtl: 3600 });
  return c.json(overview);
});

/** Bounded graph view. Never returns a whole repository (BRIEF §15). */
app.get("/api/v1/repositories/:repositoryId/graph", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ error: "no analyzed commit for this repository" }, 404);

  const snapshot = await new GraphStore(c.env.ARTIFACTS).get(repositoryId, commitSha);
  if (!snapshot) return c.json({ error: "snapshot not found" }, 404);

  const query: NeighbourhoodQuery = {
    commitSha,
    nodeId: c.req.query("nodeId"),
    depth: numberParam(c.req.query("depth")),
    direction: (c.req.query("direction") as "in" | "out" | "both" | undefined) ?? "both",
    zoomLevel: numberParam(c.req.query("zoomLevel")) as NeighbourhoodQuery["zoomLevel"],
    maxNodes: numberParam(c.req.query("maxNodes")),
    minConfidence: numberParam(c.req.query("minConfidence")),
    applicationOwnedOnly: c.req.query("applicationOwnedOnly") === "true",
    nodeKinds: listParam(c.req.query("nodeKinds")) as NodeKind[] | undefined,
    tags: listParam(c.req.query("tags")),
  };

  return c.json(selectView(snapshot, query));
});

/** Execution path for a route (BRIEF Flow C). */
app.get("/api/v1/repositories/:repositoryId/paths/:routeId", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ error: "no analyzed commit for this repository" }, 404);

  const snapshot = await new GraphStore(c.env.ARTIFACTS).get(repositoryId, commitSha);
  if (!snapshot) return c.json({ error: "snapshot not found" }, 404);

  return c.json(executionPath(snapshot, decodeURIComponent(c.req.param("routeId"))));
});

/** Function inspector (BRIEF Flow D). */
app.get("/api/v1/repositories/:repositoryId/nodes/:nodeId", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ error: "no analyzed commit for this repository" }, 404);

  const snapshot = await new GraphStore(c.env.ARTIFACTS).get(repositoryId, commitSha);
  if (!snapshot) return c.json({ error: "snapshot not found" }, 404);

  const detail = nodeDetail(snapshot, decodeURIComponent(c.req.param("nodeId")));
  if (!detail) return c.json({ error: "node not found" }, 404);

  return c.json(detail);
});

/** Symbol search, served from D1 metadata. */
app.get("/api/v1/repositories/:repositoryId/search", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const term = c.req.query("q")?.trim();
  if (!term) return c.json({ results: [] });

  const commitSha = await resolveCommit(c.env, repositoryId, c.req.query("commitSha"));
  if (!commitSha) return c.json({ results: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line, tags, analysis_confidence
     FROM symbols
     WHERE repository_id = ?1 AND commit_sha = ?2 AND (name LIKE ?3 OR qualified_name LIKE ?3 OR file_path LIKE ?3)
     ORDER BY application_owned DESC, length(name) ASC
     LIMIT 50`,
  )
    .bind(repositoryId, commitSha, `%${term}%`)
    .all();

  return c.json({ results });
});

/** Visual commit comparison (BRIEF Flow E). */
app.get("/api/v1/repositories/:repositoryId/diff", async (c) => {
  const repositoryId = c.req.param("repositoryId");
  const baseSha = c.req.query("base");
  const headSha = c.req.query("head");

  if (!baseSha || !headSha) return c.json({ error: "base and head are required" }, 400);

  const store = new GraphStore(c.env.ARTIFACTS);
  const [base, head] = await Promise.all([store.get(repositoryId, baseSha), store.get(repositoryId, headSha)]);

  if (!base) return c.json({ error: `no snapshot for base commit ${baseSha}` }, 404);
  if (!head) return c.json({ error: `no snapshot for head commit ${headSha}` }, 404);

  return c.json(diffSnapshots(base, head));
});

/**
 * One row per repository, carrying its most recent snapshot.
 *
 * Joining snapshots directly would repeat a repository once per analyzed commit,
 * which the picker would render as duplicates.
 */
app.get("/api/v1/repositories", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id,
            r.full_name,
            r.default_branch,
            s.commit_sha,
            s.node_count,
            s.edge_count,
            s.created_at,
            (SELECT COUNT(*) FROM graph_snapshots WHERE repository_id = r.id) AS snapshot_count
     FROM repositories r
     LEFT JOIN graph_snapshots s
       ON s.repository_id = r.id
      AND s.created_at = (SELECT MAX(created_at) FROM graph_snapshots WHERE repository_id = r.id)
     GROUP BY r.id
     ORDER BY s.created_at DESC`,
  ).all();

  return c.json({ repositories: results });
});

app.get("/api/v1/repositories/:repositoryId/commits", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT commit_sha, node_count, edge_count, resolved_call_ratio, created_at
     FROM graph_snapshots WHERE repository_id = ?1 ORDER BY created_at DESC`,
  )
    .bind(c.req.param("repositoryId"))
    .all();

  return c.json({ commits: results });
});

async function resolveCommit(env: Env, repositoryId: string, requested?: string): Promise<string | null> {
  if (requested) return requested;

  const row = await env.DB.prepare(
    `SELECT commit_sha FROM graph_snapshots WHERE repository_id = ?1 ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(repositoryId)
    .first<{ commit_sha: string }>();

  return row?.commit_sha ?? null;
}

/** Constant-time compare so the token cannot be recovered by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function numberParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listParam(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

export default app;
