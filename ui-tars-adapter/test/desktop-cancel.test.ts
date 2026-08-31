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

class DesktopUntilAbortedRuntime implements RuntimeClient {
  readonly kind = "fake" as const;

  capabilities() {
    return {
      runtime: this.kind,
      operator: "browser" as const,
      operators: ["browser", "computer"] as const,
      strategies: ["gui"] as const,
      realBrowser: false,
      version: "test",
    };
  }

  async run(_params: StartRunParams, host: RuntimeHost) {
    host.desktopControlStarted?.();
    await new Promise<void>((resolve) => {
      if (host.signal.aborted) return resolve();
      host.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    host.desktopControlStopped?.();
    return { status: "aborted" as const };
  }

  async shutdown() {}
}

const configuration: UITarsAgentConfiguration = {
  operator: "computer",
  browserStrategy: "gui",
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

test("the shell Escape path aborts every active desktop-control run", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-tars-desktop-cancel-"));
  const activity: boolean[] = [];
  const manager = new RunManager(
    new DesktopUntilAbortedRuntime(),
    new ScreenshotStore(path.join(dataDir, "screenshots")),
    new ProcessManager(path.join(dataDir, "sessions")),
    {
      maxConcurrentRuns: 1,
      screenshotRetentionMs: 0,
      redact: (line) => line,
      onDesktopControlChange: (active) => activity.push(active),
    },
  );
  const runId = crypto.randomUUID();

  try {
    manager.create({ runId, ownerUserId: 1, task: "operate the desktop", config: configuration });
    const activeDeadline = Date.now() + 1_000;
    while (!activity.includes(true) && Date.now() < activeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(activity.includes(true), true);
    assert.equal(manager.abortActiveDesktopControls("escape"), 1);

    const abortedDeadline = Date.now() + 1_000;
    while (manager.summary(runId, 1).status !== "aborted" && Date.now() < abortedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.summary(runId, 1).status, "aborted");
    assert.equal(activity.at(-1), false);
    assert.equal(manager.abortActiveDesktopControls("escape"), 0);
  } finally {
    await manager.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
