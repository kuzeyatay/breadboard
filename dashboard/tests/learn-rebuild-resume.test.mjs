import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-rebuild-resume-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
await import("../scripts/learn-worker-import-hook.mjs");
const learn = await import("../src/lib/learn.ts");
const { default: db } = await import("../src/lib/db.ts");

test("a rebuild resumes from the map a failed lesson run kept, only for the same request", (t) => {
  // 2026-10-02: every failure while writing pages forced a 2-3 hour replan.
  t.after(() => { try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {} });
  learn.getLatestLearnJob("g1"); // creates the Learn tables
  const now = new Date().toISOString();
  // Fill every NOT NULL column the current schema requires, then override.
  const insert = (table, values) => {
    const row = {};
    for (const column of db.prepare(`pragma table_info(${table})`).all()) {
      if (column.notnull && column.dflt_value === null && !column.pk) row[column.name] = column.type.toUpperCase().includes("INT") ? 0 : "";
    }
    Object.assign(row, values);
    const names = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((name) => row[name]));
  };
  insert("learn_jobs", {
    id: "job1", garden_id: "g1", status: "failed", mode: "full_rebuild", current_step: learn.LEARN_REBUILD_MAP_KEPT_STEP,
    model: "gpt-6-sol", user_instruction: "Focus on M1", created_at: now, updated_at: now,
  });
  insert("learn_maps", {
    id: "map1", garden_id: "g1", job_id: "job1", status: "confirmed", source_map_json: "{}", scope_contract_json: "{}",
    learning_map_json: JSON.stringify({ sections: [{ title: "S1", subsections: [] }] }), proposed_order_json: "[]", visual_opportunities_json: "[]", coverage_plan_json: "{}",
    source_set_hash: "h", created_at: now, confirmed_at: now, source_ids_json: JSON.stringify(["a", "b"]), syllabus_source_id: "guide",
  });
  const same = { model: "gpt-6-sol", includedSourceIds: ["b", "a"], syllabusSourceId: "guide", userInstruction: "Focus on M1" };
  assert.equal(learn.resumableRebuildLearningMapId("g1", same), "map1");
  assert.equal(learn.resumableRebuildLearningMapId("g1", { ...same, model: "gpt-6-luna" }), undefined);
  assert.equal(learn.resumableRebuildLearningMapId("g1", { ...same, includedSourceIds: ["a"] }), undefined);
  assert.equal(learn.resumableRebuildLearningMapId("g1", { ...same, userInstruction: "Other" }), undefined);
  db.prepare("UPDATE learn_jobs SET current_step = 'Planning failed' WHERE id = 'job1'").run();
  assert.equal(learn.resumableRebuildLearningMapId("g1", same), undefined);
  // A failed resume keeps its link to the confirmed map even when its own
  // failure handler overwrote the marker step.
  db.prepare("UPDATE learn_jobs SET current_step = 'Lesson generation failed', confirmed_learning_map_id = 'map1' WHERE id = 'job1'").run();
  assert.equal(learn.resumableRebuildLearningMapId("g1", same), "map1");
  // Quitting mid-lesson cancels the job; its linked map still resumes.
  db.prepare("UPDATE learn_jobs SET status = 'cancelled' WHERE id = 'job1'").run();
  assert.equal(learn.resumableRebuildLearningMapId("g1", same), "map1");
  db.prepare("UPDATE learn_jobs SET requires_replan = 1 WHERE id = 'job1'").run();
  assert.equal(learn.resumableRebuildLearningMapId("g1", same), undefined);
});
