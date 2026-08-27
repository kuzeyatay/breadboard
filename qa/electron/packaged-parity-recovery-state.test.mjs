import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  injectUnresolvablePersonaSelection,
  readInjectedPersonaSelection,
} from "./packaged-parity-recovery-state.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(repoRoot, "dashboard", "package.json"));
const Database = require("better-sqlite3");

function fixture(t) {
  const runId = `recovery-${process.pid}-${Date.now()}`;
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parity-recovery-root-"));
  const runRoot = path.join(runtimeRoot, runId);
  fs.mkdirSync(runRoot);
  const dataDir = path.join(runRoot, "user-data", "Data");
  const databaseDir = path.join(dataDir, "database");
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.writeFileSync(path.join(runRoot, ".breadboard-qa-run.json"), `${JSON.stringify({
    schemaVersion: 1,
    runId,
    ownerPid: process.pid,
    repoRoot,
    runtimeRoot,
    runRoot,
  })}\n`);
  const database = new Database(path.join(databaseDir, "brain.db"));
  database.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      active_agency_agent_slug TEXT,
      updated_at TEXT
    );
  `);
  database.close();
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  return { repoRoot, runtimeRoot, runRoot, dataDir, runId };
}

function insertConversation(authority, publicId, selectionIdentity) {
  const database = new Database(path.join(authority.dataDir, "database", "brain.db"));
  database.prepare(`
    INSERT INTO conversations (public_id, active_agency_agent_slug, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(publicId, selectionIdentity);
  database.close();
}

test("fault injection is compare-and-swap scoped to one marker-owned QA persona selection", (t) => {
  const authority = fixture(t);
  insertConversation(authority, "conversation-one", "ux-researcher");
  const injected = injectUnresolvablePersonaSelection({
    ...authority,
    capabilityId: "persona:agency:ux-researcher",
    expectedSelectionIdentity: "ux-researcher",
  });
  assert.match(injected.faultSelectionIdentity, /^parity-missing-[a-f0-9]{24}$/u);
  assert.equal(readInjectedPersonaSelection({
    ...authority,
    rowId: injected.rowId,
    conversationPublicId: injected.conversationPublicId,
  }), injected.faultSelectionIdentity);
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /expected exactly one UI-selected conversation.*observed 0/u,
  );
});

test("fault injection rejects ambiguous selections and paths outside the exact QA data root", (t) => {
  const authority = fixture(t);
  insertConversation(authority, "conversation-one", "ux-researcher");
  insertConversation(authority, "conversation-two", "ux-researcher");
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /expected exactly one UI-selected conversation.*observed 2/u,
  );
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      dataDir: path.join(authority.runRoot, "different"),
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /dataDir is not the isolated QA run's exact/u,
  );
});

test("fault injection rejects foreign marker ownership, repository, runtime, and run-root authority", (t) => {
  const authority = fixture(t);
  insertConversation(authority, "conversation-one", "ux-researcher");
  const markerFile = path.join(authority.runRoot, ".breadboard-qa-run.json");
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  for (const mutation of [
    { ownerPid: process.pid + 1 },
    { repoRoot: path.join(authority.repoRoot, "foreign-repository") },
    { runtimeRoot: path.join(authority.runtimeRoot, "foreign-runtime") },
    { runRoot: path.join(authority.runtimeRoot, "foreign-run") },
  ]) {
    fs.writeFileSync(markerFile, `${JSON.stringify({ ...marker, ...mutation })}\n`);
    assert.throws(
      () => injectUnresolvablePersonaSelection({
        ...authority,
        capabilityId: "persona:agency:ux-researcher",
        expectedSelectionIdentity: "ux-researcher",
      }),
      /QA run marker does not authorize/u,
    );
  }
  fs.writeFileSync(markerFile, `${JSON.stringify(marker)}\n`);
});

test("fault injection rejects a real nested run directory that is not a direct runtime-root child", (t) => {
  const authority = fixture(t);
  const nestedRunRoot = path.join(authority.runRoot, "nested-run");
  fs.mkdirSync(nestedRunRoot);
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      runRoot: nestedRunRoot,
      dataDir: path.join(nestedRunRoot, "user-data", "Data"),
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /runRoot is not a real non-symlink direct child of runtimeRoot/u,
  );
});

test("fault injection rejects a symlinked database parent even when it points at a valid database", (t) => {
  const authority = fixture(t);
  insertConversation(authority, "conversation-one", "ux-researcher");
  const databaseDir = path.join(authority.dataDir, "database");
  const externalDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parity-db-target-"));
  t.after(() => fs.rmSync(externalDatabaseDir, { recursive: true, force: true }));
  fs.renameSync(path.join(databaseDir, "brain.db"), path.join(externalDatabaseDir, "brain.db"));
  fs.rmdirSync(databaseDir);
  fs.symlinkSync(externalDatabaseDir, databaseDir, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /QA database directory is not a non-symlink directory/u,
  );
});

test("fault injection rejects a symlinked run root outside the declared runtime root", (t) => {
  const authority = fixture(t);
  const foreignRuntimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-parity-foreign-root-"));
  t.after(() => fs.rmSync(foreignRuntimeRoot, { recursive: true, force: true }));
  const linkedRunRoot = path.join(foreignRuntimeRoot, authority.runId);
  fs.symlinkSync(authority.runRoot, linkedRunRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => injectUnresolvablePersonaSelection({
      ...authority,
      runtimeRoot: foreignRuntimeRoot,
      runRoot: linkedRunRoot,
      dataDir: path.join(linkedRunRoot, "user-data", "Data"),
      capabilityId: "persona:agency:ux-researcher",
      expectedSelectionIdentity: "ux-researcher",
    }),
    /QA run root is not a non-symlink directory/u,
  );
});
