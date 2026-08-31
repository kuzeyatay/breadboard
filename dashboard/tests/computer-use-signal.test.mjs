import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

register("./teach-support/server-only-stub.mjs", import.meta.url);

const { ComputerUseSignal } = await import("../src/lib/computer-use-signal.ts");

function readState(dataDir, producer) {
  return JSON.parse(
    fs.readFileSync(path.join(dataDir, `computer-use-state.${producer}.json`), "utf8"),
  );
}

test("dashboard desktop controllers share Escape without overwriting each other's state", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-computer-use-"));
  const cancelPath = path.join(dataDir, "computer-use-cancel");
  let teachCancellations = 0;
  let otherCancellations = 0;
  const teach = new ComputerUseSignal({
    producer: "teach",
    appearance: "red",
    dataDir,
    onCancel: () => { teachCancellations += 1; },
  });
  const other = new ComputerUseSignal({
    producer: "other",
    dataDir,
    onCancel: () => { otherCancellations += 1; },
  });

  try {
    teach.setRunActive("teach-1", true);
    other.setRunActive("other-1", true);
    assert.equal(readState(dataDir, "teach").active, true);
    assert.equal(readState(dataDir, "teach").appearance, "red");
    assert.equal(readState(dataDir, "other").active, true);
    assert.equal(readState(dataDir, "other").appearance, "green");

    fs.writeFileSync(cancelPath, "escape:1", "utf8");
    const deadline = Date.now() + 1_000;
    while (
      (teachCancellations === 0 || otherCancellations === 0) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(teachCancellations, 1);
    assert.equal(otherCancellations, 1);

    teach.setRunActive("teach-1", false);
    assert.equal(readState(dataDir, "teach").active, false);
    assert.equal(readState(dataDir, "other").active, true);
  } finally {
    teach.stop();
    other.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a cancellation marker present before a producer starts is stale for that producer", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-computer-use-stale-"));
  fs.writeFileSync(path.join(dataDir, "computer-use-cancel"), "old", "utf8");
  let cancellations = 0;
  const signal = new ComputerUseSignal({
    producer: "teach",
    dataDir,
    onCancel: () => { cancellations += 1; },
  });
  try {
    signal.setRunActive("run", true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(cancellations, 0);
  } finally {
    signal.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("teaching capture is wired to a red, Escape-cancellable indicator lifecycle", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "lib", "teach", "session-manager.ts"),
    "utf8",
  );

  assert.match(source, /producer:\s*"teach-recording"/);
  assert.match(source, /appearance:\s*"red"/);
  assert.match(source, /activateTeachingCaptureIndicator\(input\.userId, row\.id\)/);
  assert.match(source, /releaseTeachingCaptureIndicator\(sessionId\)/);
  assert.match(source, /cancelTeaching\(active\.userId, sessionId\)/);
});
