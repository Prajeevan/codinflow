-- CodinFlow D1 schema.
-- Relational metadata only. Graph payloads live in R2 (BRIEF §12) — a snapshot
-- row stores the key of its artifact, never the artifact itself.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  is_private INTEGER NOT NULL DEFAULT 1,
  installation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, full_name)
);

CREATE TABLE IF NOT EXISTS commits (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  branch TEXT,
  message TEXT,
  author TEXT,
  committed_at TEXT,
  PRIMARY KEY (repository_id, sha)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  analyzer_version TEXT,
  schema_version TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  -- One run per repo+commit+analyzer version makes re-delivery idempotent.
  UNIQUE (repository_id, commit_sha, analyzer_version)
);

CREATE TABLE IF NOT EXISTS graph_snapshots (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  analysis_run_id TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  resolved_call_ratio REAL,
  frameworks TEXT,
  entry_points TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, commit_sha)
);

-- Searchable symbol metadata. Kept in D1 so search and node lookup never
-- require reading a whole graph artifact out of R2.
CREATE TABLE IF NOT EXISTS symbols (
  id TEXT NOT NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,
  summary TEXT,
  tags TEXT,
  application_owned INTEGER NOT NULL DEFAULT 1,
  analysis_confidence REAL NOT NULL DEFAULT 1,
  source_fingerprint TEXT,
  PRIMARY KEY (repository_id, commit_sha, id)
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols (repository_id, commit_sha, name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols (repository_id, commit_sha, kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols (repository_id, commit_sha, file_path);

CREATE TABLE IF NOT EXISTS node_changes (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  node_id TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  match_method TEXT,
  confidence REAL,
  detail TEXT,
  PRIMARY KEY (repository_id, base_sha, head_sha, node_id, change_kind)
);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  commit_sha TEXT,
  -- Manual node positions survive re-layout (BRIEF §7).
  viewport TEXT,
  filters TEXT,
  positions TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summaries (
  node_id TEXT NOT NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  -- Facts the summary was generated from, so a reader can check it.
  evidence TEXT NOT NULL,
  -- Regenerate only when the underlying facts change (BRIEF §10).
  facts_fingerprint TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (repository_id, commit_sha, node_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
