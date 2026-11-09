-- What agents looked for and nobody shared: the registrable domain of a domain or URL search that found
-- nothing, and the hashed network that asked, so one network asking a thousand times counts once. Never
-- the words of a search.
CREATE TABLE demand (
  domain TEXT NOT NULL,
  network TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (domain, network)
);
CREATE INDEX demand_at ON demand (at);
