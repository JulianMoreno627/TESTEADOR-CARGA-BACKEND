CREATE TABLE test_runs (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running', 'completed', 'stopped', 'failed')),
  config      JSONB NOT NULL,
  summary     JSONB,
  timeline    JSONB NOT NULL DEFAULT '[]',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX test_runs_created_at_idx ON test_runs (created_at DESC);

CREATE TABLE targets (
  id          UUID PRIMARY KEY,
  hostname    TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL,
  method      TEXT CHECK (method IN ('http', 'dns')),
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL
);
