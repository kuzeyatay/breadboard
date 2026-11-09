-- Ops learned signed in, claimed by fingerprint alone (docs/REGISTRY.md "Ops learned signed in"). The
-- registry asks for an op's body once installs on enough distinct networks claimed the same fingerprint.
CREATE TABLE claims (
  fingerprint TEXT NOT NULL,
  site TEXT NOT NULL,
  key TEXT NOT NULL,
  network TEXT NOT NULL,
  name_hash TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, key)
);
CREATE INDEX claims_key ON claims (key);

-- the fingerprint an uploaded op answered a claim with: the claim is then answered
ALTER TABLE versions ADD COLUMN claim TEXT;
