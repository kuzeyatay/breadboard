-- Each version keeps its recent report counts beside it, so serving a search, a site or the index reads
-- versions only, never every report. A report recounts its version; the daily job recounts them all.
ALTER TABLE versions ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN oks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN bad INTEGER NOT NULL DEFAULT 0;
-- installs that reported it: a version past STATS_LIVE_UP_TO is recounted at most every STATS_SECONDS
ALTER TABLE versions ADD COLUMN reporters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN stats_at TEXT;
-- a report arrived while its recount was held back: the job every minute recounts it
ALTER TABLE versions ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
CREATE INDEX versions_pending ON versions (pending) WHERE pending = 1;

UPDATE versions SET
  confirmations = (SELECT COUNT(*) FROM reports r WHERE r.hash = versions.hash AND r.outcome = 'ok'
    AND r.key <> versions.uploader AND r.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  oks = (SELECT COUNT(*) FROM reports r WHERE r.hash = versions.hash AND r.outcome = 'ok'
    AND r.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  bad = (SELECT COUNT(*) FROM reports r WHERE r.hash = versions.hash AND r.outcome IN ('fail', 'wrong')
    AND r.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  reporters = (SELECT COUNT(*) FROM reports r WHERE r.hash = versions.hash
    AND r.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));
