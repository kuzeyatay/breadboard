import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDesktopPrediction,
  desktopActionErrorMessage,
  desktopCoordinateError,
  desktopResultSummary,
  desktopSystemPrompt,
  mergeDesktopAgentData,
  pngDimensions,
  runDesktopTask,
  typeDesktopText,
} from "../src/desktop-runtime.ts";
import type { RuntimeHost, StartRunParams } from "../src/runtime-client.ts";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const params: StartRunParams = {
  runId: "desktop-run",
  task: "click the visible button",
  providerApiKey: "local",
  config: {
    operator: "computer",
    browserStrategy: "gui",
    desktopCoordinateSpace: "screen_pixels",
    provider: "chatmock",
    model: "vision-model",
    endpoint: "http://127.0.0.1:8765/v1",
    maxSteps: 10,
    timeoutMs: 60_000,
    approvalMode: "sensitive_actions",
    allowedDomains: [],
    allowDownloads: false,
    allowClipboard: true,
    allowFileUpload: false,
  },
};

function fakeDependencies(log: string[]) {
  class FakeModel {
    constructor(_config: Record<string, unknown>) {}
    get factors(): [number, number] { return [1000, 1000]; }
  }
  class FakeOperator {
    static MANUAL = { ACTION_SPACES: ["click()", "finished()"] };
    async screenshot() {
      log.push("screenshot");
      return { base64: ONE_PIXEL_PNG, scaleFactor: 1 };
    }
    async execute(_params?: unknown) {
      log.push("execute");
      return {};
    }
  }
  class FakeAgent {
    private config: Record<string, any>;
    constructor(config: Record<string, any>) {
      this.config = config;
      log.push(`model-retries:${config.retry?.model?.maxRetries ?? 0}`);
    }
    stop() {
      log.push("stop");
    }
    async run() {
      (this.config.logger as { info: (...args: unknown[]) => void }).info(
        "[GUIAgent] consumes: >>> costTime: 20, costTokens: 37 <<<",
      );
      const operator = this.config.operator as FakeOperator;
      const shot = await operator.screenshot();
      assert.equal(shot.base64, ONE_PIXEL_PNG);
      const factors = (this.config.model as { factors?: [number, number] }).factors;
      if (factors) log.push(`factors:${factors.join("x")}`);
      await operator.execute({
        parsedPrediction: {
          action_type: "click",
          action_inputs: { start_box: "[0.1,0.2,0.3,0.4]" },
        },
      });
      this.config.onData({
        data: {
          status: "end",
          conversations: [{
            from: "gpt",
            predictionParsed: [{
              action_type: "finished",
              action_inputs: { content: "The newest email is a project update." },
            }],
          }],
        },
      });
    }
  }
  return {
    GUIAgent: FakeAgent,
    UITarsModel: FakeModel,
    NutJSOperator: FakeOperator,
    getActiveWindow: async () => {
      log.push("return-window:capture");
      return {
        focus: async () => {
          log.push("return-window:focus");
          return true;
        },
      };
    },
  };
}

function host(
  approvals: boolean[],
  log: string[],
  signal: AbortSignal = new AbortController().signal,
): RuntimeHost {
  return {
    signal,
    status: (message) => log.push(`status:${message}`),
    thinking: ({ state }) => log.push(`thinking:${state}`),
    usage: ({ totalTokens }) => log.push(`usage:${totalTokens}`),
    page: () => {},
    screenshot: async () => { log.push("host-screenshot"); },
    actionStarted: ({ action }) => log.push(`started:${action}`),
    actionCompleted: () => log.push("completed"),
    actionFailed: () => log.push("failed"),
    requestApproval: async ({ action }) => {
      log.push(`approval:${action}`);
      return approvals.shift() ?? false;
    },
  };
}

test("desktop prediction classification never exposes typed text", () => {
  const classified = classifyDesktopPrediction({
    action_type: "type",
    action_inputs: { content: "private password" },
  });
  assert.equal(classified.action, "type");
  assert.doesNotMatch(classified.target, /private password/);
});

test("desktop prompt defines both coordinate protocols without naming applications", () => {
  const actions = ["click(start_box='[x1,y1,x2,y2]')", "finished()"];
  const pixels = desktopSystemPrompt(actions, "screen_pixels");
  assert.match(pixels, /native pixel coordinate system/);
  assert.match(pixels, /Do not normalize coordinates/);
  assert.match(pixels, /visible launcher\/search/);
  assert.match(pixels, /Do not guess taskbar or dock icons/);
  assert.match(pixels, /finished\(content='concise user-facing result'\)/);
  assert.doesNotMatch(pixels, /^finished\(\)$/m);
  assert.doesNotMatch(pixels, /outlook|word|excel|spotify/i);

  const normalized = desktopSystemPrompt(actions, "normalized_1000");
  assert.match(normalized, /1000 by 1000 reference grid/);
  assert.match(normalized, /integer between 0 and 1000/);
});

test("desktop pointer coordinates must be normalized before native execution", () => {
  assert.equal(
    desktopCoordinateError({
      action_type: "click",
      action_inputs: { start_box: "[0.2,0.3,0.4,0.5]" },
    }),
    null,
  );
  assert.equal(
    desktopCoordinateError({
      action_type: "click",
      action_inputs: { start_box: "[0.2,0.3,1.4,0.5]" },
    }),
    "desktop_coordinate_out_of_bounds",
  );
  assert.equal(
    desktopCoordinateError({
      action_type: "drag",
      action_inputs: {
        start_box: "[0.2,0.3,0.4,0.5]",
        end_box: "[-0.1,0.3,0.4,0.5]",
      },
    }),
    "desktop_coordinate_out_of_bounds",
  );
  assert.equal(
    desktopCoordinateError({
      action_type: "type",
      action_inputs: { content: "unrelated to pointer coordinates" },
    }),
    null,
  );
});

test("desktop pixel protocol derives model factors from each PNG screenshot", () => {
  assert.deepEqual(pngDimensions(ONE_PIXEL_PNG), [1, 1]);
  assert.equal(pngDimensions("not-a-png"), null);
});

test("desktop text entry types directly and submits without touching the clipboard", async () => {
  const log: string[] = [];
  const keyboard = {
    config: { autoDelayMs: 500 },
    async type(value: string) { log.push(`type:${value}`); },
    async pressKey(value: unknown) { log.push(`press:${String(value)}`); },
    async releaseKey(value: unknown) { log.push(`release:${String(value)}`); },
  };
  await typeDesktopText("Outlook\\n", keyboard, "enter");
  assert.deepEqual(log, ["type:Outlook", "press:enter", "release:enter"]);
  assert.equal(keyboard.config.autoDelayMs, 500);
});

test("native desktop failures are stable and never expose paths or panic details", () => {
  const message = desktopActionErrorMessage(
    "Command failed: C:\\repo\\node_modules\\clipboardy.exe --paste thread 'main' panicked RUST_BACKTRACE=1",
    String,
  );
  assert.equal(message, "Agent TARS could not type into the desktop application");
  assert.doesNotMatch(message, /C:\\|node_modules|panic|RUST_BACKTRACE/i);
});

test("desktop result exposes the finished report without raw reasoning", () => {
  const finished = {
    conversations: [{
      from: "gpt",
      value: "private reasoning",
      predictionParsed: [{
        action_type: "finished",
        action_inputs: { content: "Newest mail: design review moved to Friday." },
      }],
    }],
  };
  const terminal = mergeDesktopAgentData(finished, {
    status: "end",
    conversations: [],
  });
  const summary = desktopResultSummary(terminal, String);
  assert.equal(summary, "Newest mail: design review moved to Friday.");
  assert.doesNotMatch(summary ?? "", /private reasoning/);
  assert.equal(terminal.status, "end");
});

test("desktop dependencies load only after the session approval", async () => {
  const log: string[] = [];
  let loaded = false;
  const outcome = await runDesktopTask(params, host([false], log), {
    redact: String,
    loadDependencies: async () => {
      loaded = true;
      return fakeDependencies(log) as any;
    },
  });
  assert.equal(outcome.status, "aborted");
  assert.equal(loaded, false);
  assert.deepEqual(log, ["approval:desktop_control"]);
});

test("approved desktop run captures screenshots and executes GUI actions", async () => {
  const log: string[] = [];
  const outcome = await runDesktopTask(params, host([true], log), {
    redact: String,
    loadDependencies: async () => fakeDependencies(log) as any,
  });
  assert.equal(outcome.status, "completed");
  assert.equal(log.filter((entry) => entry === "approval:desktop_control").length, 1);
  assert.ok(log.includes("host-screenshot"));
  assert.ok(log.includes("started:click"));
  assert.ok(log.includes("completed"));
  assert.ok(log.includes("thinking:started"));
  assert.ok(log.includes("thinking:completed"));
  assert.ok(log.includes("usage:37"));
  assert.ok(log.includes("factors:1x1"));
  assert.ok(log.includes("model-retries:1"));
  assert.ok(log.includes("return-window:capture"));
  assert.ok(log.includes("return-window:focus"));
  assert.ok(log.includes("status:The newest email is a project update."));
  assert.equal(outcome.summary, "The newest email is a project update.");
});

test("failed and stopped desktop runs also return to the launch window", async () => {
  for (const terminal of ["failed", "aborted"] as const) {
    const log: string[] = [];
    const controller = new AbortController();
    const runtimeHost = host([true], log, controller.signal);
    const dependencies = fakeDependencies(log);
    class TerminalAgent {
      constructor(_config: Record<string, unknown>) {}
      stop() {}
      async run() {
        if (terminal === "aborted") controller.abort();
        throw new Error("terminal test");
      }
    }
    dependencies.GUIAgent = TerminalAgent as typeof dependencies.GUIAgent;

    const outcome = await runDesktopTask(params, runtimeHost, {
      redact: String,
      loadDependencies: async () => dependencies as any,
    });

    assert.equal(outcome.status, terminal);
    assert.equal(log.filter((entry) => entry === "return-window:focus").length, 1);
  }
});

test("every-action mode gates each desktop interaction after session approval", async () => {
  const log: string[] = [];
  const outcome = await runDesktopTask(
    { ...params, config: { ...params.config, approvalMode: "every_action" } },
    host([true, true], log),
    { redact: String, loadDependencies: async () => fakeDependencies(log) as any },
  );
  assert.equal(outcome.status, "completed");
  assert.deepEqual(log.filter((entry) => entry.startsWith("approval:")), [
    "approval:desktop_control",
    "approval:click",
  ]);
});
