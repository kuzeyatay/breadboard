import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectDevInstallation,
  planMigration,
  executeMigration,
  looksLikeSqliteDatabase,
} from "../src/main/migration";

function makeDevCheckout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dev-"));
  fs.mkdirSync(path.join(root, "dashboard", "db"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "dashboard", "db", "brain.db"),
    Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(64)]),
  );
  fs.mkdirSync(path.join(root, "quartz", "content", "my-garden", "sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "quartz", "content", "my-garden", "sources", "note.md"), "# hi");
  return root;
}

function makeTargets() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bb-target-"));
  const targets = {
    databaseDir: path.join(base, "database"),
    quartzContent: path.join(base, "quartz", "content"),
    backupsDir: path.join(base, "backups"),
    configDir: path.join(base, "config"),
  };
  for (const dir of Object.values(targets)) fs.mkdirSync(dir, { recursive: true });
  return targets;
}

test("detects a dev checkout by database or content", () => {
  const root = makeDevCheckout();
  assert.ok(detectDevInstallation(root));
  assert.ok(!detectDevInstallation(fs.mkdtempSync(path.join(os.tmpdir(), "bb-empty-"))));
});

test("migration copies data without touching the source", () => {
  const root = makeDevCheckout();
  const targets = makeTargets();
  const plan = planMigration(root, targets);
  const result = executeMigration(plan, targets);
  assert.equal(result.performed.length, 2); // brain.db + content (no skills db)
  assert.ok(fs.existsSync(path.join(targets.databaseDir, "brain.db")));
  assert.ok(
    fs.existsSync(path.join(targets.quartzContent, "my-garden", "sources", "note.md")),
  );
  // Source untouched.
  assert.ok(fs.existsSync(path.join(root, "dashboard", "db", "brain.db")));
  assert.ok(fs.existsSync(result.reportPath));
  const report = JSON.parse(fs.readFileSync(result.reportPath, "utf8")) as {
    performed: unknown[];
    skipped: unknown[];
  };
  assert.equal(report.performed.length, 2);
});

test("migration is idempotent (second run copies nothing)", () => {
  const root = makeDevCheckout();
  const targets = makeTargets();
  executeMigration(planMigration(root, targets), targets);
  const second = executeMigration(planMigration(root, targets), targets);
  assert.equal(second.performed.length, 0);
  assert.equal(second.skipped.length, 3);
});

test("populated destinations are backed up, not clobbered silently", () => {
  const root = makeDevCheckout();
  const targets = makeTargets();
  // Pre-existing destination content marks the item alreadyMigrated => skip.
  fs.mkdirSync(path.join(targets.quartzContent, "existing"), { recursive: true });
  fs.writeFileSync(path.join(targets.quartzContent, "existing", "keep.md"), "keep");
  const plan = planMigration(root, targets);
  const contentItem = plan.items.find((item) => item.destination === targets.quartzContent);
  assert.ok(contentItem?.alreadyMigrated);
  const result = executeMigration(plan, targets);
  assert.ok(fs.existsSync(path.join(targets.quartzContent, "existing", "keep.md")));
  assert.ok(!result.performed.some((item) => item.destination === targets.quartzContent));
});

test("sqlite header validation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-sqlite-"));
  const good = path.join(dir, "good.db");
  fs.writeFileSync(good, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(32)]));
  const bad = path.join(dir, "bad.db");
  fs.writeFileSync(bad, "this is not a database");
  assert.ok(looksLikeSqliteDatabase(good));
  assert.ok(!looksLikeSqliteDatabase(bad));
  assert.ok(!looksLikeSqliteDatabase(path.join(dir, "missing.db")));
});
