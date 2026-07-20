import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LogManager } from "../src/main/log-manager";

test("writes lines and reads a tail", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lm-"));
  const logs = new LogManager({ logsDir: dir });
  const writer = logs.forService("svc");
  for (let i = 0; i < 10; i += 1) writer.write(`line-${i}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const tail = writer.readTail(3);
  assert.equal(tail.length, 3);
  assert.match(tail[2] ?? "", /line-9/);
  logs.closeAll();
});

test("redaction hook applies to every line", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lm-"));
  const logs = new LogManager({
    logsDir: dir,
    redact: (line) => line.replaceAll("supersecret", "[redacted]"),
  });
  const writer = logs.forService("svc");
  writer.write("password=supersecret ok");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const contents = fs.readFileSync(writer.filePath, "utf8");
  assert.ok(!contents.includes("supersecret"));
  assert.ok(contents.includes("[redacted]"));
  logs.closeAll();
});

test("rotates once past the size bound", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lm-"));
  const logs = new LogManager({ logsDir: dir, maxBytesPerFile: 2_000 });
  const writer = logs.forService("svc");
  for (let i = 0; i < 100; i += 1) writer.write("x".repeat(50));
  await new Promise((resolve) => setTimeout(resolve, 500));
  logs.closeAll();
  assert.ok(fs.existsSync(`${writer.filePath}.1`), "rotated file should exist");
  const active = fs.statSync(writer.filePath).size;
  assert.ok(active < 4_000, `active file should be small after rotation, got ${active}`);
});

test("service ids are sanitized into safe filenames", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lm-"));
  const logs = new LogManager({ logsDir: dir });
  const writer = logs.forService("../evil/../id");
  assert.ok(writer.filePath.startsWith(dir));
  assert.ok(!writer.filePath.includes(".."));
  logs.closeAll();
});
