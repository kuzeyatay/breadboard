import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import ts from "typescript";

test("legacy correlations for retired agents do not block active-agent migration", () => {
  const source = fs.readFileSync(new URL("../src/lib/runtime-v2/outer-agent-run-store.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true);
  const migration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ensureSchema");
  assert.ok(migration);
  const code = ts.transpileModule(migration.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE runtime_v2_outer_agent_runs (
      job_id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL,
      agent_kind TEXT NOT NULL CHECK(agent_kind IN ('codex', 'retired-agent')),
      request_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, garden_id TEXT,
      conversation_id TEXT NOT NULL, created_at TEXT NOT NULL, terminal_at TEXT,
      UNIQUE(owner_user_id, agent_kind, request_id)
    )`);
    const insert = db.prepare("INSERT INTO runtime_v2_outer_agent_runs VALUES (?, 7, ?, ?, ?, NULL, 'conversation', '2026-09-08', NULL)");
    insert.run("active-job", "codex", "active-request", "active-key");
    insert.run("retired-job", "retired-agent", "retired-request", "retired-key");
    const ensureSchema = new Function("db", `let schemaReady = false;\n${code}\nreturn ensureSchema;`)(db);
    ensureSchema();
    ensureSchema();
    assert.deepEqual(db.prepare("SELECT job_id, agent_kind FROM runtime_v2_outer_agent_runs").all(), [
      { job_id: "active-job", agent_kind: "codex" },
    ]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'runtime_v2_outer_agent_runs_legacy'").get(), undefined);
  } finally {
    db.close();
  }
});
