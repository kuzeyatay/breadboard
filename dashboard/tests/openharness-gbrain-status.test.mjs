import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectGBrainState } from "../src/lib/openharness/gbrain-status.ts";

test("the bundled GBrain source is reported honestly as unconfigured, not integrated", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bb-gbrain-status-"));
  const previous = { path: process.env.GBRAIN_PATH, home: process.env.GBRAIN_HOME, envPath: process.env.PATH };
  process.env.GBRAIN_PATH = path.join(root, "gbrain");
  process.env.GBRAIN_HOME = home;
  process.env.PATH = "";
  try {
    const state = inspectGBrainState({}, []);
    assert.equal(state.checkoutFound, true);
    assert.equal(state.separateCheckout, false);
    assert.equal(state.revision, null);
    assert.equal(state.installed, false);
    assert.equal(state.initialized, false);
    assert.equal(state.connected, false);
    assert.equal(state.healthy, false);
    assert.match(state.reason, /not a separate Git checkout/);
  } finally {
    if (previous.path === undefined) delete process.env.GBRAIN_PATH; else process.env.GBRAIN_PATH = previous.path;
    if (previous.home === undefined) delete process.env.GBRAIN_HOME; else process.env.GBRAIN_HOME = previous.home;
    process.env.PATH = previous.envPath;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
