import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";
import { REVEAL_FRAME_PROBE } from "../src/main/first-paint";

test("a tab reveal waits only for the first safely composited frame", async () => {
  assert.doesNotMatch(REVEAL_FRAME_PROBE, /document\.fonts|requestIdleCallback|setTimeout/);

  const frames: Array<() => void> = [];
  const result = vm.runInNewContext(REVEAL_FRAME_PROBE, {
    requestAnimationFrame(callback: () => void) {
      frames.push(callback);
    },
  }) as Promise<unknown>;
  let settled = false;
  void result.then(() => {
    settled = true;
  });

  assert.equal(frames.length, 1);
  frames.shift()?.();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(frames.length, 1);
  frames.shift()?.();
  await result;
  assert.equal(settled, true);
});

test("tab documents become revealable at DOM-ready without waiting for load completion", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "src", "main", "tab-manager.ts"),
    "utf8",
  );
  assert.match(source, /contents\.on\("dom-ready", markDocumentReady\)/);
  assert.match(
    source,
    /contents\.once\("destroyed", \(\) => \{\s+markDocumentReady\(\);\s+this\.hostByContents\.delete\(contents\.id\);/,
    "closing a cold tab releases its pending reveal instead of retaining the renderer",
  );
  assert.doesNotMatch(source, /onLoadingStopped/);
});
