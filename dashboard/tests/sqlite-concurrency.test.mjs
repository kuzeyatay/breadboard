import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  SQLITE_BUSY_TIMEOUT_MS,
  configureSqliteConcurrency,
} from "../src/lib/sqlite-concurrency.ts";

test("shared SQLite configuration enables WAL with a bounded busy timeout", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-sqlite-"));
  const filename = path.join(directory, "brain.db");
  const database = new Database(filename);
  try {
    configureSqliteConcurrency(database);
    assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(
      database.pragma("busy_timeout", { simple: true }),
      SQLITE_BUSY_TIMEOUT_MS,
    );
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a Learn-style progress write is not blocked by an active status reader", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-wal-"));
  const filename = path.join(directory, "brain.db");
  const setup = new Database(filename);
  const reader = new Database(filename);
  const writer = new Database(filename);
  try {
    configureSqliteConcurrency(setup);
    setup.exec("CREATE TABLE learn_jobs (id TEXT PRIMARY KEY, progress_percent INTEGER NOT NULL)");
    setup.prepare("INSERT INTO learn_jobs VALUES (?, ?)").run("job-1", 3);
    configureSqliteConcurrency(reader);
    configureSqliteConcurrency(writer);

    reader.exec("BEGIN");
    assert.equal(
      reader.prepare("SELECT progress_percent FROM learn_jobs WHERE id = ?").get("job-1")
        .progress_percent,
      3,
    );

    assert.doesNotThrow(() => {
      writer
        .prepare("UPDATE learn_jobs SET progress_percent = ? WHERE id = ?")
        .run(10, "job-1");
    });
    assert.equal(writer.prepare("SELECT progress_percent FROM learn_jobs WHERE id = ?").get("job-1").progress_percent, 10);

    // The open reader retains its original snapshot until it ends the status
    // read, proving the writer succeeded without corrupting reader isolation.
    assert.equal(
      reader.prepare("SELECT progress_percent FROM learn_jobs WHERE id = ?").get("job-1")
        .progress_percent,
      3,
    );
    reader.exec("COMMIT");
    assert.equal(
      reader.prepare("SELECT progress_percent FROM learn_jobs WHERE id = ?").get("job-1")
        .progress_percent,
      10,
    );
  } finally {
    if (reader.inTransaction) reader.exec("ROLLBACK");
    writer.close();
    reader.close();
    setup.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
