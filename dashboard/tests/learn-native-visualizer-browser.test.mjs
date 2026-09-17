import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runLearnNativeVisualizerBrowserTests } from "../src/lib/learn-native-visualizer-browser.ts";

function nativeDefinition() {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Long-path visual",
    description: "Exercises the native visual browser staging boundary.",
    controls: [],
    outputs: [],
    scenes: [],
    nativeRuntime: {
      engine: "breadboard-interactive-visualizer",
      version: "2.0.0",
      sourceSkill: "interactive-visualizer-in-chat",
      skillHash: "a".repeat(64),
      mode: "2d",
      html:
        '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'"></head><body><div id="app"><canvas></canvas><button data-action="play-pause" aria-pressed="false">Play</button><button data-action="reset">Reset</button></div></body></html>',
      controlIds: [],
    },
  };
}

test("native visual browser opens and captures short temp copies when Learn output paths exceed the Windows limit", async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-native-long-output-"));
  const outputDir = path.join(
    testRoot,
    ...Array.from({ length: 9 }, (_, index) =>
      `deep-learn-visual-attempt-segment-${index}`,
    ),
  );
  const openedPages = [];
  const probe = encodeURIComponent(
    JSON.stringify([{ name: "probe completes", passed: true }]),
  );

  try {
    const result = await runLearnNativeVisualizerBrowserTests({
      definition: nativeDefinition(),
      outputDir,
      browserExecutable: "fake-edge",
      browserRunner: ({ args }) => {
        const pagePath = fileURLToPath(args.at(-1));
        openedPages.push(pagePath);
        assert.equal(fs.existsSync(pagePath), true);
        assert.equal(pagePath.startsWith(outputDir), false);
        assert.ok(pagePath.length < outputDir.length);
        const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
        if (screenshotArg) {
          fs.writeFileSync(screenshotArg.slice("--screenshot=".length), "fake png");
        }
        return {
          status: 0,
          stdout: args.includes("--dump-dom")
            ? `<html data-native-probe="${probe}"></html>`
            : "",
          completion: args.includes("--dump-dom")
            ? "observed_dom"
            : "observed_capture",
          cleanupConfirmed: true,
        };
      },
    });

    assert.ok(outputDir.length > 260, outputDir);
    assert.equal(result.tests.every((entry) => entry.passed), true);
    assert.equal(result.browser?.screenshotCreated, true);
    assert.equal(fs.existsSync(path.join(outputDir, "preview.png")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "mobile-preview.png")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "desktop-light.html")), true);
    assert.equal(openedPages.length, 5);
    assert.equal(openedPages.every((pagePath) => !fs.existsSync(pagePath)), true);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});
