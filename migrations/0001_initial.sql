-- Owner comes from the verified Cloudflare Access JWT, never from request JSON.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  shots TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_updated ON projects(owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  duration REAL NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  video_key TEXT,
  error TEXT,
  remote_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generations_owner_created ON generations(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_status_updated ON generations(status, updated_at);

CREATE TABLE IF NOT EXISTS assets (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_owner_created ON assets(owner, created_at DESC);
