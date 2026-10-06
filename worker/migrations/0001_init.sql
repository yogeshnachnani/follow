-- Subscribers. `status` includes 'pending' so double opt-in can be added later
-- without a migration; with single opt-in rows are inserted as 'active'.
CREATE TABLE subscribers (
  id                INTEGER PRIMARY KEY,
  email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  status            TEXT    NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
  unsubscribe_token TEXT    NOT NULL UNIQUE,
  source_url        TEXT,
  created_at        TEXT    NOT NULL,
  confirmed_at      TEXT,
  unsubscribed_at   TEXT
);
CREATE INDEX subscribers_status ON subscribers (status);

-- One row per announced post. Keyed on post_url so re-running a send for the
-- same post resumes the same campaign instead of starting a new one.
CREATE TABLE campaigns (
  id         INTEGER PRIMARY KEY,
  post_url   TEXT NOT NULL UNIQUE,
  subject    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Per-recipient delivery log; makes sends idempotent and resumable.
CREATE TABLE deliveries (
  campaign_id   INTEGER NOT NULL REFERENCES campaigns (id),
  subscriber_id INTEGER NOT NULL REFERENCES subscribers (id),
  status        TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_id   TEXT,
  error         TEXT,
  sent_at       TEXT    NOT NULL,
  PRIMARY KEY (campaign_id, subscriber_id)
);
