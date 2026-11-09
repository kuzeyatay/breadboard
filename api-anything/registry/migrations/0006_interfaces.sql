-- Sites' own agent interfaces (an MCP server, an OpenAPI document), by registrable domain, and the installs
-- that reported each. One is served once installs on enough distinct networks reported it.
CREATE TABLE interfaces (
  url TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX interfaces_domain ON interfaces (domain);

CREATE TABLE interface_reports (
  url TEXT NOT NULL,
  key TEXT NOT NULL,
  network TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (url, key)
);
