import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProcessManager } from "../src/process-manager.ts";
import { RunManager } from "../src/run-manager.ts";
import type { RuntimeClient, RuntimeHost, StartRunParams } from "../src/runtime-client.ts";
import { ScreenshotStore } from "../src/screenshot-store.ts";
import type { UITarsAgentConfiguration } from "../src/types.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

class DelayedScreenshotStore extends ScreenshotStore {
  override async put(runId: string, sequenceNumber: number, base64Png: string) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return super.put(runId, sequenceNumber, base64Png);
  }
}

class ImmediateRuntime implements RuntimeClient {
  readonly kind = "fake" as const;

  capabilities() {
    return {
      runtime: this.kind,
      operator: "browser" as const,
      strategies: ["dom"] as const,
      realBrowser: false,
      version: "test",
    };
  }

  async run(_params: StartRunParams, host: RuntimeHost) {
    // Deliberately do not await: real event callbacks may submit a screenshot
    // immediately before the runtime itself resolves.
    void host.screenshot({ base64: PNG, caption: "final" });
    return { status: "completed" as const };
  }

  async shutdown() {}
}

const configuration: UITarsAgentConfiguration = {
  operator: "browser",
  browserStrategy: "dom",
  desktopCoordinateSpace: "screen_pixels",
  provider: "openai",
  model: "test",
  maxSteps: 10,
  timeoutMs: 30_000,
  approvalMode: "sensitive_actions",
  allowedDomains: [],
  allowDownloads: false,
  allowClipboard: false,
  allowFileUpload: false,
};

test("the final screenshot is persisted and emitted before run.completed", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-tars-shot-order-"));
  const screenshots = new DelayedScreenshotStore(path.join(dataDir, "screenshots"));
  const manager = new RunManager(
    new ImmediateRuntime(),
    screenshots,
    new ProcessManager(path.join(dataDir, "sessions")),
    { maxConcurrentRuns: 1, screenshotRetentionMs: 0, redact: (line) => line },
  );
  const runId = crypto.randomUUID();

  try {
    manager.create({ runId, ownerUserId: 1, task: "open example.com", config: configuration });
    const deadline = Date.now() + 2_000;
    while (manager.summary(runId, 1).status !== "completed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(manager.summary(runId, 1).status, "completed");
    const events = manager.eventsSince(runId, 0, 1);
    const screenshotIndex = events.findIndex((event) => event.type === "observation.screenshot");
    const completedIndex = events.findIndex((event) => event.type === "run.completed");
    assert.ok(screenshotIndex >= 0, "expected a screenshot event");
    assert.ok(completedIndex > screenshotIndex, "run.completed must follow the screenshot event");

    const screenshotId = String(events[screenshotIndex].payload.screenshotId);
    assert.ok(await screenshots.read(runId, screenshotId));
  } finally {
    await manager.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
