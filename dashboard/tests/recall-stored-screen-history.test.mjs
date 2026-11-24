import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { searchStoredScreenHistory } from "../src/lib/recall/stored-screen-history.ts";

test("Screen Time can read local history without a live recorder, subject to the activity range", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recall-history-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const db = new Database(path.join(directory, "db.sqlite"));
  db.exec(`
    CREATE TABLE frames(id INTEGER PRIMARY KEY, timestamp TEXT, app_name TEXT, window_name TEXT,
      full_text TEXT, accessibility_text TEXT, text_source TEXT);
    CREATE INDEX idx_frames_timestamp ON frames(timestamp);
    INSERT INTO frames VALUES
      (1,'2026-11-24T06:26:00+00:00','Terminal','breadboard','saved content',NULL,'ocr'),
      (2,'2026-11-24T06:26:00.400Z','Terminal','breadboard','later',NULL,'ocr'),
      (3,'2026-11-24T06:26:00.750Z','Terminal','breadboard','past range',NULL,'ocr'),
      (4,'2026-11-24T06:26:00.301Z','Browser','other window','other app',NULL,'ocr');
  `);
  db.close();

  const input = { contentType: "ocr", startTime: "2026-11-24T06:26:00.000Z", endTime: "2026-11-24T06:26:00.600Z",
    appName: "terminal", windowName: "breadboard", limit: 2 };
  const result = searchStoredScreenHistory(directory, input, 5);
  assert.deepEqual(result.hits.map(hit => hit.frameId), [2, 1]);
  assert.deepEqual(result.hits.map(hit => hit.text), ["later", "saved"]);
  assert.equal(result.hasMore, false);
  assert.equal(searchStoredScreenHistory(directory, { ...input, contentType: "audio" }, 5), null);
  fs.writeFileSync(path.join(directory, "db.sqlite.quarantine.json"), "{}");
  assert.equal(searchStoredScreenHistory(directory, input, 5), null);
});
