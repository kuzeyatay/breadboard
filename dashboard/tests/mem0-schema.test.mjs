import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import Database from "better-sqlite3";

import { ensureMem0Schema } from "../src/lib/mem0/schema.ts";

function createCanonicalSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE durable_memories (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL
    );
  `);
}

test("mem0 schema initialization is idempotent and retains deletion tombstones", () => {
  const database = new Database(":memory:");
  createCanonicalSchema(database);

  ensureMem0Schema(database);
  ensureMem0Schema(database);

  database.prepare(
    "INSERT INTO durable_memories (id, user_id) VALUES (?, ?)",
  ).run(41, 7);
  database.prepare(`
    INSERT INTO mem0_mirrors (
      durable_id, mem0_id, content_hash, fingerprint
    ) VALUES (?, ?, ?, ?)
  `).run(41, "mem0-generic-41", "hash-41", "fingerprint-41");
  database.prepare("DELETE FROM durable_memories WHERE id = ?").run(41);

  assert.deepEqual(
    database.prepare(`
      SELECT mem0_id, user_id, fingerprint
      FROM mem0_tombstones
    `).get(),
    {
      mem0_id: "mem0-generic-41",
      user_id: 7,
      fingerprint: "fingerprint-41",
    },
  );
  database.close();
});

test("parallel schema initialization cannot race while creating the trigger", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mem0-schema-"));
  const databasePath = path.join(root, "brain.db");
  const database = new Database(databasePath);
  createCanonicalSchema(database);
  database.pragma("journal_mode = WAL");
  database.close();

  const source = fs.readFileSync(
    new URL("../src/lib/mem0/schema.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /DROP\s+TRIGGER/iu);
  assert.match(
    source,
    /CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+trg_mem0_tombstone_on_durable_delete/iu,
  );

  const workerCount = 6;
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { default: Database } = await import(workerData.databaseModule);
      const { ensureMem0Schema } = await import(workerData.schemaModule);
      const signal = new Int32Array(workerData.barrier);
      const db = new Database(workerData.databasePath);
      db.pragma("busy_timeout = 5000");
      db.pragma("foreign_keys = ON");
      Atomics.add(signal, 0, 1);
      parentPort.postMessage("ready");
      Atomics.wait(signal, 1, 0);
      for (let iteration = 0; iteration < 10; iteration += 1) {
        ensureMem0Schema(db);
      }
      db.close();
      parentPort.postMessage("done");
    })().catch((error) => parentPort.postMessage({ error: String(error?.stack || error) }));
  `;
  const workerData = {
    barrier,
    databasePath,
    databaseModule: pathToFileURL(
      path.resolve("node_modules/better-sqlite3/lib/index.js"),
    ).href,
    schemaModule: new URL("../src/lib/mem0/schema.ts", import.meta.url).href,
  };
  const workers = Array.from({ length: workerCount }, () => new Worker(workerSource, {
    eval: true,
    workerData,
  }));

  try {
    await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("message", (message) => {
        if (message === "ready") resolve();
        else reject(new Error(message?.error ?? `unexpected worker message: ${message}`));
      });
    })));
    const completions = workers.map((worker) => new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.on("message", (message) => {
        if (message === "done") resolve();
        else if (message?.error) reject(new Error(message.error));
      });
    }));
    Atomics.store(new Int32Array(barrier), 1, 1);
    Atomics.notify(new Int32Array(barrier), 1, workerCount);
    await Promise.all(completions);

    const verified = new Database(databasePath, { readonly: true });
    assert.equal(
      verified.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name = 'trg_mem0_tombstone_on_durable_delete'
      `).get().count,
      1,
    );
    verified.close();
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
