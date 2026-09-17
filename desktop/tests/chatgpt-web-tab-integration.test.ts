import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The out-of-sight chatgpt.com page lent to ChatMock's "OpenAI (web)"
 * provider, end to end: a Breadboard page asks the shell over the preload
 * bridge, the shell puts the page in a window parked off every display (and
 * out of the taskbar) and names its DevTools target, signing in brings that
 * window into view and closing it parks the window again without ending the
 * session, and ChatMock's own page driver (Python, over CDP) attaches to the
 * target, installs its script, navigates the page and hears its binding.
 */
test(
  "the shell lends one out-of-sight ChatGPT page that ChatMock can drive over CDP",
  { skip: process.platform !== "win32" },
  () => {
    const desktop = path.resolve(__dirname, "../..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-chatgpt-web-tab-"));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const run = spawnSync(
        require("electron") as string,
        [path.join(desktop, "tests/fixtures/chatgpt-web-tab.cjs"), dir],
        { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 120_000 },
      );
      assert.equal(run.error, undefined, run.error?.message);
      const resultFile = path.join(dir, "result.json");
      assert.ok(fs.existsSync(resultFile), `${run.stdout}\n${run.stderr}`);
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(result.first.ok, true);
      assert.equal(result.second.targetId, result.first.targetId);
      assert.equal(result.listedTarget.type, "page");
      assert.equal(result.tabsAfterFirst.filter((tab: { browser: boolean }) => tab.browser).length, 0);
      // Parked is a window that runs and draws nothing: zero opacity, on top
      // so nothing can occlude it into Chromium's "hidden" state. (Electron 33
      // exposes no getter for skipTaskbar or click-through, so those are not
      // assertable here.)
      assert.equal(result.parkedFirst.opacity, 0);
      assert.equal(result.parkedFirst.alwaysOnTop, true);
      assert.equal(result.shownForSignIn.opacity, 1);
      assert.equal(result.parkedAfterClose.opacity, 0);
      assert.equal(result.stillListed, true);
      // A replacement page, for a renderer that stopped answering DevTools.
      assert.equal(result.reset.ok, true);
      assert.notEqual(result.reset.targetId, result.first.targetId);
      assert.equal(result.oldTargetGone, true);

      const probe = result.probe;
      assert.ok(probe, `python probe produced no report: ${result.probeStderr}`);
      assert.equal(probe.connected, true, JSON.stringify(probe));
      assert.equal(probe.error, undefined, JSON.stringify(probe));
      assert.equal(probe.script, true);
      assert.match(probe.href, /\/page$/u);
      assert.deepEqual(probe.events, [{ type: "probe", turn: "x", hello: 1 }]);
      assert.equal(probe.snapshot.hasAssistant, false);
    } finally {
      assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
