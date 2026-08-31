import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMPUTER_USE_CANCEL_FILENAME,
  COMPUTER_USE_STATE_FILENAME,
  ComputerUseSignal,
} from "../src/computer-use-signal.ts";

function stateAt(dataDir: string): {
  version: number;
  active: boolean;
  updatedAt: number;
  appearance: "green";
} {
  return JSON.parse(
    fs.readFileSync(path.join(dataDir, COMPUTER_USE_STATE_FILENAME), "utf8"),
  ) as { version: number; active: boolean; updatedAt: number; appearance: "green" };
}

test("computer-use signal publishes green active state and consumes Escape cancellation", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-tars-computer-use-"));
  let cancellations = 0;
  const signal = new ComputerUseSignal({
    dataDir,
    onCancel: () => { cancellations += 1; },
  });

  try {
    assert.deepEqual(Object.keys(stateAt(dataDir)).sort(), ["active", "appearance", "updatedAt", "version"]);
    assert.equal(stateAt(dataDir).active, false);
    assert.equal(stateAt(dataDir).appearance, "green");

    signal.setActive(true);
    assert.equal(stateAt(dataDir).active, true);
    fs.writeFileSync(path.join(dataDir, COMPUTER_USE_CANCEL_FILENAME), "escape:1", "utf8");

    const deadline = Date.now() + 1_000;
    while (cancellations === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(cancellations, 1);
    assert.equal(
      fs.readFileSync(path.join(dataDir, COMPUTER_USE_CANCEL_FILENAME), "utf8"),
      "escape:1",
      "each producer leaves the shared marker for the others",
    );

    signal.setActive(false);
    assert.equal(stateAt(dataDir).active, false);
  } finally {
    signal.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a stale cancel marker is discarded when the adapter starts", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-tars-computer-use-stale-"));
  const cancelPath = path.join(dataDir, COMPUTER_USE_CANCEL_FILENAME);
  fs.writeFileSync(cancelPath, "stale", "utf8");
  let cancellations = 0;
  const signal = new ComputerUseSignal({ dataDir, onCancel: () => { cancellations += 1; } });
  try {
    assert.equal(fs.existsSync(cancelPath), true);
    signal.setActive(true);
    assert.equal(cancellations, 0);
  } finally {
    signal.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
