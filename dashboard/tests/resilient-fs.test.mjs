import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isTransientFileOpenError,
  publishExternalCacheFileAtomically,
  readFileSyncWithRetry,
  withTransientFileOpenRetry,
} from "../src/lib/resilient-fs.ts";

function signedCacheBytes(value) {
  const payload = JSON.stringify(value);
  return Buffer.from(JSON.stringify({
    value,
    sha256: crypto.createHash("sha256").update(payload).digest("hex"),
  }));
}

function validSignedCacheBytes(content) {
  try {
    const parsed = JSON.parse(content.toString("utf8"));
    return parsed.sha256 === crypto.createHash("sha256")
      .update(JSON.stringify(parsed.value))
      .digest("hex");
  } catch {
    return false;
  }
}

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

test("external cache publish retries transient EPERM with unique wx temps and leaves one valid final", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-external-cache-transient-"));
  const finalPath = path.join(dir, "aa", "receipt.json");
  const content = signedCacheBytes({ candidate: 1 });
  const sleeps = [];
  const tempPaths = [];
  let writes = 0;
  let ids = 0;
  try {
    const result = publishExternalCacheFileAtomically({
      finalPath,
      content,
      validateWinner: validSignedCacheBytes,
      retryDelaysMs: [11, 22, 44],
      sleep: (milliseconds) => sleeps.push(milliseconds),
      randomId: () => `id-${++ids}`,
      fileSystem: {
        writeFileSync(filePath, bytes, options) {
          writes += 1;
          tempPaths.push(filePath);
          assert.equal(options.flag, "wx");
          if (writes < 3) {
            throw Object.assign(new Error("EPERM: operation not permitted, open temp"), {
              code: "EPERM",
            });
          }
          fs.writeFileSync(filePath, bytes, options);
        },
      },
    });

    assert.deepEqual(result, { status: "published", attempts: 3 });
    assert.deepEqual(sleeps, [11, 22]);
    assert.equal(new Set(tempPaths).size, 3);
    assert.deepEqual(fs.readFileSync(finalPath), content);
    assert.deepEqual(
      fs.readdirSync(path.dirname(finalPath)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("external cache collision accepts only a strictly valid winner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-external-cache-winner-"));
  const finalPath = path.join(dir, "receipt.json");
  const candidate = signedCacheBytes({ candidate: "ours" });
  const winner = signedCacheBytes({ candidate: "theirs" });
  let links = 0;
  try {
    const result = publishExternalCacheFileAtomically({
      finalPath,
      content: candidate,
      validateWinner: validSignedCacheBytes,
      retryDelaysMs: [],
      randomId: () => "collision",
      fileSystem: {
        linkSync() {
          links += 1;
          fs.writeFileSync(finalPath, winner, { flag: "wx" });
          throw Object.assign(new Error("EEXIST: racing cache winner"), { code: "EEXIST" });
        },
      },
    });

    assert.deepEqual(result, { status: "winner", attempts: 1 });
    assert.equal(links, 1);
    assert.deepEqual(fs.readFileSync(finalPath), winner);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("external cache publisher quarantines an invalid racing winner before retrying", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-external-cache-invalid-winner-"));
  const finalPath = path.join(dir, "receipt.json");
  const candidate = signedCacheBytes({ candidate: "valid" });
  const sleeps = [];
  let links = 0;
  let ids = 0;
  try {
    const result = publishExternalCacheFileAtomically({
      finalPath,
      content: candidate,
      validateWinner: validSignedCacheBytes,
      retryDelaysMs: [7],
      sleep: (milliseconds) => sleeps.push(milliseconds),
      randomId: () => `invalid-${++ids}`,
      fileSystem: {
        linkSync(existingPath, newPath) {
          links += 1;
          if (links === 1) {
            fs.writeFileSync(newPath, "tampered", { flag: "wx" });
            throw Object.assign(new Error("EEXIST: invalid racing cache"), { code: "EEXIST" });
          }
          fs.linkSync(existingPath, newPath);
        },
      },
    });

    assert.deepEqual(result, { status: "published", attempts: 2 });
    assert.deepEqual(sleeps, [7]);
    assert.deepEqual(fs.readFileSync(finalPath), candidate);
    assert.equal(
      fs.readdirSync(dir).filter((name) => name.includes(".invalid-")).length,
      1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistent external-cache EPERM degrades only after its bounded retry budget", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-external-cache-persistent-"));
  const finalPath = path.join(dir, "receipt.json");
  const sleeps = [];
  let writes = 0;
  let ids = 0;
  try {
    const result = publishExternalCacheFileAtomically({
      finalPath,
      content: signedCacheBytes({ candidate: 1 }),
      validateWinner: validSignedCacheBytes,
      retryDelaysMs: [3, 5],
      sleep: (milliseconds) => sleeps.push(milliseconds),
      randomId: () => `persistent-${++ids}`,
      fileSystem: {
        writeFileSync() {
          writes += 1;
          throw Object.assign(new Error("EPERM: operation not permitted, open temp"), {
            code: "EPERM",
          });
        },
      },
    });

    assert.deepEqual(result, { status: "degraded", attempts: 3, lastErrorCode: "EPERM" });
    assert.equal(writes, 3);
    assert.deepEqual(sleeps, [3, 5]);
    assert.equal(fs.existsSync(finalPath), false);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("external cache publisher rejects an invalid candidate before filesystem mutation", () => {
  let mkdirCalls = 0;
  assert.throws(() => publishExternalCacheFileAtomically({
    finalPath: path.join(os.tmpdir(), "must-not-exist", "receipt.json"),
    content: Buffer.from("tampered"),
    validateWinner: validSignedCacheBytes,
    fileSystem: {
      mkdirSync() {
        mkdirCalls += 1;
      },
    },
  }), /invalid external cache candidate/);
  assert.equal(mkdirCalls, 0);
});

test("Learn finalization and semantic migration route file reads through the retry helper", () => {
  for (const moduleName of ["garden-finalize.ts", "garden-semantics.ts"]) {
    const source = fs.readFileSync(new URL(`../src/lib/${moduleName}`, import.meta.url), "utf8");
    assert.match(source, /readFileSyncWithRetry/);
    assert.doesNotMatch(source, /fs\.readFileSync/);
  }
});
