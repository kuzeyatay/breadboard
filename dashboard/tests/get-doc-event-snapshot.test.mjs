import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Database from "better-sqlite3";

test("Get Doc sends the final result before closing even if the job completes during a poll", async () => {
  const started = { sequenceNumber: 1, type: "run.started", payload: {}, at: "2026-11-06T00:00:00Z" };
  const completed = { sequenceNumber: 2, type: "run.completed", payload: { summary: "Found the requested paper." }, at: started.at };
  let reads = 0;
  const exports = {};
  const source = fs.readFileSync(new URL("../src/lib/get-doc/runtime-run-manager.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: (id) => {
      if (id === "server-only") return {};
      if (id === "../db.ts") return { default: { exec() {}, prepare() { return { all: () => [] }; } } };
      if (id === "../runtime-v2/outer-agent-run.ts") return { readOuterAgentRunView: async () => {
        reads++;
        return reads === 1 ? { events: [started], terminal: false, status: "running" }
          : { events: [started, completed], terminal: true, status: "completed" };
      } };
      return {};
    },
  });
  const first = await exports.getRunView(1, "job_fixture", 0);
  assert.equal(reads, 1, "status must share the event snapshot");
  assert.equal(first.terminal, false);
  assert.equal(first.events.length, 1);
  const next = await exports.getRunView(1, "job_fixture", first.events.at(-1).sequenceNumber);
  assert.equal(next.terminal, true);
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].payload.summary, completed.payload.summary);
  const route = fs.readFileSync(new URL("../src/app/api/get-doc/runs/[runId]/events/route.ts", import.meta.url), "utf8");
  assert.match(route, /readView: \(since\) => getRunView\(userId, runId, since\)/);
  assert.doesNotMatch(route, /isTerminal|getEventsSince/);
});

test("saved documents never consume a future worker sequence and receipts keep insertion order", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const exports = {};
  const started = { sequenceNumber: 1, type: "documents.ready", payload: {}, at: "2026-11-06T00:00:00Z" };
  const completed = { sequenceNumber: 2, type: "run.completed", payload: { summary: "Found papers." }, at: started.at };
  let terminal = false;
  const source = fs.readFileSync(new URL("../src/lib/get-doc/runtime-run-manager.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: (id) => id === "../db.ts" ? { default: db } : id === "../runtime-v2/outer-agent-run.ts" ? {
      readOuterAgentRunView: async () => ({ events: terminal ? [started, completed] : [started], terminal, status: terminal ? "completed" : "running" }),
    } : {},
  });
  exports.recordDownload({ userId: 1, runId: "job_fixture", documentId: "doc_2", artifactId: "art_first", filename: "first.pdf", byteSize: 100 });
  const active = await exports.getRunView(1, "job_fixture", 0);
  assert.equal(active.events.length, 1, "an active stream must reserve future sequence numbers for its worker");
  terminal = true;
  const final = await exports.getRunView(1, "job_fixture", active.events.at(-1).sequenceNumber);
  assert.equal(final.events[0].type, "run.completed");
  assert.equal(final.events[1].type, "document.saved");
  assert.equal(final.events[1].payload.documentId, "doc_2");
  // A clock adjustment (or tied timestamps sorted by document ID) must not
  // insert a new receipt before the cursor already delivered to the browser.
  db.prepare("UPDATE runtime_v2_get_doc_saved_documents SET saved_at = ?").run("2099-01-01T00:00:00Z");
  exports.recordDownload({ userId: 1, runId: "job_fixture", documentId: "doc_1", artifactId: "art_second", filename: "second.pdf", byteSize: 200 });
  const later = await exports.getRunView(1, "job_fixture", final.events.at(-1).sequenceNumber);
  assert.equal(later.events.length, 1);
  assert.equal(later.events[0].payload.documentId, "doc_1");
  assert.equal(later.events[0].sequenceNumber, final.events.at(-1).sequenceNumber + 1);
});
