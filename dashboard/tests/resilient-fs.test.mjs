import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isTransientFileOpenError,
  readFileSyncWithRetry,
  withTransientFileOpenRetry,
} from "../src/lib/resilient-fs.ts";

test("transient UNKNOWN file-open errors are retried and then succeed", () => {
  let attempts = 0;
  const slept = [];
  const result = withTransientFileOpenRetry(() => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error("UNKNOWN: unknown error, open 'Topic Overview.md'"), {
        code: "UNKNOWN",
      });
    }
    return "opened";
  }, {
    retryDelaysMs: [10, 20, 40, 80, 160],
    sleep: (milliseconds) => slept.push(milliseconds),
  });

  assert.equal(result, "opened");
  assert.equal(attempts, 3);
  assert.deepEqual(slept, [10, 20]);
});

test("UNKNOWN open messages without an error code are recognized", () => {
  assert.equal(
    isTransientFileOpenError(new Error("UNKNOWN: unknown error, open 'Topic Overview.md'")),
    true,
  );
});

test("non-transient read failures fail immediately", () => {
  let attempts = 0;
  const slept = [];
  const failure = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });

  assert.throws(() => withTransientFileOpenRetry(() => {
    attempts += 1;
    throw failure;
  }, {
    retryDelaysMs: [0, 0, 0, 0, 0],
    sleep: (milliseconds) => slept.push(milliseconds),
  }), (error) => error === failure);

  assert.equal(attempts, 1);
  assert.deepEqual(slept, []);
});

test("transient reads stop after six total attempts", () => {
  let attempts = 0;
  const slept = [];
  const failure = Object.assign(new Error("UNKNOWN: unknown error, open 'Topic Overview.md'"), {
    code: "UNKNOWN",
  });

  assert.throws(() => withTransientFileOpenRetry(() => {
    attempts += 1;
    throw failure;
  }, {
    retryDelaysMs: [1, 2, 3, 4, 5],
    sleep: (milliseconds) => slept.push(milliseconds),
  }), (error) => error === failure);

  assert.equal(attempts, 6);
  assert.deepEqual(slept, [1, 2, 3, 4, 5]);
});

test("resilient synchronous reads preserve text and buffer results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-resilient-fs-"));
  const file = path.join(dir, "Topic Overview.md");
  try {
    fs.writeFileSync(file, "topic overview", "utf8");
    assert.equal(readFileSyncWithRetry(file, "utf8"), "topic overview");
    assert.equal(readFileSyncWithRetry(file).toString("utf8"), "topic overview");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Learn finalization and semantic migration route file reads through the retry helper", () => {
  for (const moduleName of ["garden-finalize.ts", "garden-semantics.ts"]) {
    const source = fs.readFileSync(new URL(`../src/lib/${moduleName}`, import.meta.url), "utf8");
    assert.match(source, /readFileSyncWithRetry/);
    assert.doesNotMatch(source, /fs\.readFileSync/);
  }
});
