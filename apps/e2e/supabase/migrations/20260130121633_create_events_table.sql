CREATE TABLE events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id     text        NOT NULL,
  subject_cohort text        NULL,
  created_at     timestamptz NOT NULL,
  dedupe_key     text        NULL,
  sequence       integer     NULL,
  event_name     text        NOT NULL,
  properties     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_subject_id ON events (subject_id);
CREATE INDEX idx_events_event_name ON events (event_name);
CREATE INDEX idx_events_created_at ON events (created_at);
CREATE INDEX idx_events_dedupe ON events (dedupe_key, sequence) WHERE dedupe_key IS NOT NULL;
