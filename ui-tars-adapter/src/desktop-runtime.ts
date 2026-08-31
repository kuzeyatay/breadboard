// Actual-desktop UI-TARS runtime.
//
// Native screen/mouse/keyboard packages are loaded only after Breadboard's
// one-shot desktop-session approval resolves. Browser runs never import them.
// The model receives screenshots and can use only the GUI action vocabulary;
// it is not given filesystem or shell tools.

/* eslint-disable @typescript-eslint/no-explicit-any -- native upstream boundary */

import type {
  ApprovalActionType,
  DesktopCoordinateSpace,
  RunFailure,
} from "./types.ts";
import type { RunOutcome, RuntimeHost, StartRunParams } from "./runtime-client.ts";

interface DesktopPrediction {
  action_type?: string;
  action_inputs?: {
    content?: string;
    key?: string;
    hotkey?: string;
    direction?: string;
    start_box?: string;
    end_box?: string;
  };
}

interface DesktopAgentData {
  status?: string;
  errMsg?: string;
  error?: { message?: string };
  conversations?: Array<{
    from?: string;
    value?: string;
    predictionParsed?: DesktopPrediction[];
  }>;
}

export interface DesktopAgentHandle {
  stop(): void;
}

export interface DesktopReturnWindow {
  focus(): Promise<boolean>;
}

interface DesktopRuntimeDependencies {
  GUIAgent: new (config: Record<string, unknown>) => DesktopAgentHandle & {
    run(instruction: string): Promise<void>;
  };
  UITarsModel: new (config: Record<string, unknown>) => {
    readonly factors: [number, number];
  };
  NutJSOperator: new () => {
    screenshot(): Promise<{ base64: string; scaleFactor: number }>;
    execute(params: any): Promise<any>;
  };
  keyboard: {
    config: { autoDelayMs: number };
    type(...input: string[]): Promise<unknown>;
    pressKey(...keys: any[]): Promise<unknown>;
    releaseKey(...keys: any[]): Promise<unknown>;
  };
  Key: { Enter: any };
  getActiveWindow(): Promise<DesktopReturnWindow>;
}

export interface DesktopRuntimeOptions {
  redact: (line: string) => string;
  onAgentStart?: (agent: DesktopAgentHandle) => void;
  onAgentStop?: (agent: DesktopAgentHandle) => void;
  loadDependencies?: () => Promise<DesktopRuntimeDependencies>;
}

async function loadDesktopDependencies(): Promise<DesktopRuntimeDependencies> {
  const [{ GUIAgent }, { UITarsModel }, { NutJSOperator }, { keyboard, Key, getActiveWindow }] = await Promise.all([
    import("@ui-tars/sdk"),
    import("@ui-tars/sdk/core"),
    import("@ui-tars/operator-nut-js"),
    import("@computer-use/nut-js"),
  ]);
  return {
    GUIAgent: GUIAgent as any,
    UITarsModel: UITarsModel as any,
    NutJSOperator: NutJSOperator as any,
    keyboard: keyboard as any,
    Key: Key as any,
    getActiveWindow: getActiveWindow as () => Promise<DesktopReturnWindow>,
  };
}

/**
 * Return control to the exact window from which the user approved the desktop
 * run. Keeping the native window object avoids relying on an application title,
 * executable name, URL, task content, or the app Agent TARS happened to open.
 */
export async function restoreDesktopReturnWindow(
  target: DesktopReturnWindow | null,
): Promise<boolean> {
  if (!target) return false;
  try {
    return await target.focus();
  } catch {
    // A closed launch window must not turn an otherwise completed run into a
    // failure. The terminal result remains authoritative.
    return false;
  }
}

function keyName(prediction: DesktopPrediction): string {
  return String(prediction.action_inputs?.key ?? prediction.action_inputs?.hotkey ?? "").toLowerCase();
}

const POINTER_ACTIONS = new Set([
  "click",
  "left_click",
  "left_single",
  "left_double",
  "double_click",
  "right_click",
  "right_single",
  "middle_click",
  "left_click_drag",
  "drag",
  "select",
  "mouse_move",
  "hover",
  "scroll",
]);

function validNormalizedBox(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const coordinates = value
    .replace(/[\[\]()]/g, "")
    .split(",")
    .map((part) => Number(part.trim()));
  return (
    (coordinates.length === 2 || coordinates.length === 4) &&
    coordinates.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
  );
}

/**
 * The SDK parser converts the model's 0..1000 reference grid to 0..1 before
 * calling the operator. Reject malformed/out-of-range pointer actions instead
 * of letting NutJS click an unrelated application or monitor.
 */
export function desktopCoordinateError(prediction: DesktopPrediction): string | null {
  const actionType = String(prediction.action_type ?? "").toLowerCase();
  if (!POINTER_ACTIONS.has(actionType)) return null;
  if (!validNormalizedBox(prediction.action_inputs?.start_box)) {
    return "desktop_coordinate_out_of_bounds";
  }
  if (
    ["left_click_drag", "drag", "select"].includes(actionType) &&
    !validNormalizedBox(prediction.action_inputs?.end_box)
  ) {
    return "desktop_coordinate_out_of_bounds";
  }
  return null;
}

/** Read PNG dimensions without decoding pixels or adding an image dependency. */
export function pngDimensions(base64: string): [number, number] | null {
  try {
    const encoded = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return null;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? [width, height] : null;
  } catch {
    return null;
  }
}

/**
 * Derive the action vocabulary from the installed operator and state the
 * configured coordinate protocol explicitly. General vision models normally
 * emit screenshot pixels; native UI-TARS models use a 1000x1000 grid.
 */
export function desktopSystemPrompt(
  actionSpaces: readonly string[],
  coordinateSpace: DesktopCoordinateSpace,
): string {
  const reportableActionSpaces = actionSpaces.map((action) => {
    if (/^finished\(\)/.test(action)) {
      return "finished(content='concise user-facing result')";
    }
    if (/^call_user\(\)/.test(action)) {
      return "call_user(content='what the user must provide or do')";
    }
    return action;
  });
  const coordinateContract =
    coordinateSpace === "screen_pixels"
      ? `- Use the latest screenshot's native pixel coordinate system.
- The top-left is (0, 0); the bottom-right is (screenshot width, screenshot height).
- Every start_box and end_box must contain integer screenshot-pixel coordinates.
- Do not normalize coordinates to a 1000 by 1000 grid.`
      : `- Every screenshot uses a 1000 by 1000 reference grid regardless of its pixel dimensions.
- The top-left is (0, 0) and the bottom-right is (1000, 1000).
- Every start_box and end_box coordinate must be an integer between 0 and 1000.`;
  return `You are a GUI agent controlling the user's actual desktop. You are given a task, action history, and screenshots. Use only visible GUI actions to complete the task.

## Output format
Thought: briefly assess progress and name the next target.
Action: exactly one action from the action space below.

## Action space
${reportableActionSpaces.join("\n")}

## Coordinate contract
${coordinateContract}
- Derive coordinates from the latest screenshot; never reuse stale coordinates after the screen changes.

## Operating rules
- If a named application is not the foreground window, open or focus it through the operating system's visible launcher/search using the application name from the user instruction. Do not guess taskbar or dock icons.
- If the named application is already visible, interact with that window directly instead of launching a duplicate.
- Stay on task and verify the visible result after each action.
- Do not use a shell, filesystem API, clipboard API, hidden automation API, or application-specific integration.
- Use call_user when required information or access is unavailable.
- Use finished(content='concise user-facing result') only after the requested outcome is visibly complete. Include any requested answer or summary in content.

## User instruction
`;
}

/** Convert UI-TARS' desktop action vocabulary into Breadboard's stable events. */
export function classifyDesktopPrediction(prediction: DesktopPrediction): {
  action: ApprovalActionType;
  target: string;
  terminal: boolean;
} {
  const type = String(prediction.action_type ?? "unknown").toLowerCase();
  if (["finished", "call_user", "user_stop", "error_env"].includes(type)) {
    return { action: "click", target: type, terminal: true };
  }
  if (type === "type") {
    const submits = /(?:\n|\\n)$/.test(String(prediction.action_inputs?.content ?? ""));
    return {
      action: submits ? "submit" : "type",
      target: submits ? "desktop keyboard input and Enter" : "desktop keyboard input",
      terminal: false,
    };
  }
  if (["hotkey", "press", "release"].includes(type)) {
    const key = keyName(prediction);
    const submits = /(^|[+\s])(enter|return)($|[+\s])/.test(key);
    return {
      action: submits ? "submit" : "type",
      target: key ? `desktop key: ${key}` : "desktop keyboard",
      terminal: false,
    };
  }
  if (type === "wait") {
    return { action: "click", target: "wait for desktop", terminal: false };
  }
  const coordinates = prediction.action_inputs?.start_box;
  return {
    action: "click",
    target: coordinates ? `${type} at ${coordinates}` : `desktop ${type}`,
    terminal: false,
  };
}

const NATIVE_ACTION_FAILURE = /(?:clipboardy|clipboard|could not paste|command failed|thread ['"]main['"] panicked|rust_backtrace|node_modules|src[\\/]libcore|too many action execute failures)/i;

export function desktopActionErrorMessage(
  error: unknown,
  redact: (line: string) => string,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "desktop_action_failed");
  if (NATIVE_ACTION_FAILURE.test(raw)) {
    return /clipboard|paste/i.test(raw)
      ? "Agent TARS could not type into the desktop application"
      : "Agent TARS could not complete a desktop action";
  }
  return redact(raw)
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/(?:\/[^\s"':]+){2,}/g, "<path>")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

export async function typeDesktopText(
  content: string,
  keyboard: DesktopRuntimeDependencies["keyboard"],
  enterKey: unknown,
): Promise<void> {
  const submit = /(?:\n|\\n)$/.test(content);
  const text = content.replace(/\\n$/, "").replace(/\n$/, "").trim();
  const previousDelay = keyboard.config.autoDelayMs;
  keyboard.config.autoDelayMs = 10;
  try {
    if (text) await keyboard.type(text);
    if (submit) {
      await keyboard.pressKey(enterKey);
      await keyboard.releaseKey(enterKey);
    }
  } finally {
    keyboard.config.autoDelayMs = previousDelay;
  }
}

function safeFailure(data: DesktopAgentData | undefined, redact: (line: string) => string): RunFailure {
  const raw = data?.error?.message ?? data?.errMsg ?? "Desktop operator failed";
  if (/desktop_clipboard_permission_required_for_typing/i.test(raw)) {
    return {
      code: "desktop_clipboard_permission_required",
      message: "Desktop typing requires clipboard permission on Windows",
    };
  }
  const connection = /(?:connection|fetch|network|econnrefused)/i.test(raw);
  if (NATIVE_ACTION_FAILURE.test(raw)) {
    return {
      code: "desktop_action_error",
      message: desktopActionErrorMessage(raw, redact),
    };
  }
  return {
    code: connection ? "model_connection_error" : "desktop_agent_error",
    message: connection
      ? "Agent TARS could not connect to the configured model endpoint"
      : redact(String(raw)).slice(0, 500),
  };
}

/** Extract the user-facing report supplied to the terminal `finished` action. */
export function desktopResultSummary(
  data: DesktopAgentData | undefined,
  redact: (line: string) => string,
): string | null {
  const conversations = data?.conversations ?? [];
  for (let conversationIndex = conversations.length - 1; conversationIndex >= 0; conversationIndex -= 1) {
    const predictions = conversations[conversationIndex]?.predictionParsed ?? [];
    for (let predictionIndex = predictions.length - 1; predictionIndex >= 0; predictionIndex -= 1) {
      const prediction = predictions[predictionIndex];
      if (!prediction || !["finished", "call_user"].includes(String(prediction.action_type).toLowerCase())) continue;
      const content = prediction.action_inputs?.content?.trim();
      if (content) return redact(content).slice(0, 8_000);
    }
  }
  return null;
}

/**
 * The SDK's final lifecycle callback intentionally clears conversations. Keep
 * the last non-empty model response while still accepting its terminal status.
 */
export function mergeDesktopAgentData(
  previous: DesktopAgentData | undefined,
  next: DesktopAgentData,
): DesktopAgentData {
  const conversations = next.conversations?.length
    ? next.conversations
    : previous?.conversations;
  return {
    ...previous,
    ...next,
    ...(conversations ? { conversations } : {}),
  };
}

/** Run one explicitly approved task against the current OS desktop. */
export async function runDesktopTask(
  params: StartRunParams,
  host: RuntimeHost,
  options: DesktopRuntimeOptions,
): Promise<RunOutcome> {
  const approved = await host.requestApproval({
    toolName: "desktop_session",
    action: "desktop_control",
    target: "Actual desktop (primary display)",
  });
  if (!approved || host.signal.aborted) return { status: "aborted" };

  host.status("Desktop control approved - Agent TARS can now use the real screen, mouse, and keyboard");

  let dependencies: DesktopRuntimeDependencies;
  try {
    dependencies = await (options.loadDependencies ?? loadDesktopDependencies)();
  } catch {
    return {
      status: "failed",
      failure: {
        code: "desktop_runtime_unavailable",
        message: "The Windows desktop-control runtime could not be loaded",
      },
    };
  }
  if (host.signal.aborted) return { status: "aborted" };

  const nativeOperator = new dependencies.NutJSOperator();
  let actionSequence = 0;
  let coordinateModel:
    | (InstanceType<DesktopRuntimeDependencies["UITarsModel"]> & {
        setScreenshotSize(width: number, height: number): void;
      })
    | null = null;

  // GUIAgent reads the action manual from the operator constructor, so use a
  // real subclass instead of a proxy. The inherited static manual remains the
  // official NutJS desktop action vocabulary.
  const BreadboardDesktopOperator = class extends (dependencies.NutJSOperator as any) {
    async screenshot(): Promise<{ base64: string; scaleFactor: number }> {
      if (host.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const shot = await nativeOperator.screenshot();
      const size = pngDimensions(shot.base64);
      if (size) coordinateModel?.setScreenshotSize(size[0], size[1]);
      await host.screenshot({ base64: shot.base64, caption: "Actual desktop" });
      return shot;
    }

    async execute(executeParams: any): Promise<any> {
      const prediction = (executeParams?.parsedPrediction ?? {}) as DesktopPrediction;
      const proposal = classifyDesktopPrediction(prediction);
      if (proposal.terminal) return nativeOperator.execute(executeParams);
      if (host.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const coordinateError = desktopCoordinateError(prediction);
      if (coordinateError) {
        const actionId = `desktop-${++actionSequence}`;
        host.actionStarted({ actionId, action: proposal.action, target: proposal.target });
        host.actionFailed({ actionId, error: coordinateError });
        throw new Error(coordinateError);
      }

      const actionType = String(prediction.action_type ?? "").toLowerCase();
      if (params.config.approvalMode === "every_action") {
        const actionApproved = await host.requestApproval({
          toolName: `desktop_${String(executeParams?.parsedPrediction?.action_type ?? "action")}`,
          action: proposal.action,
          target: proposal.target,
          ...(proposal.action === "submit" ? { submitIntent: true } : {}),
        });
        if (!actionApproved || host.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
      }

      const actionId = `desktop-${++actionSequence}`;
      host.actionStarted({ actionId, action: proposal.action, target: proposal.target });
      if (host.signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        let result: unknown;
        if (actionType === "type") {
          result = await typeDesktopText(
            String(prediction.action_inputs?.content ?? ""),
            dependencies.keyboard,
            dependencies.Key.Enter,
          );
        } else {
          result = await nativeOperator.execute(executeParams);
        }
        host.actionCompleted({ actionId, summary: "Desktop action completed" });
        return result;
      } catch (error) {
        host.actionFailed({
          actionId,
          error: desktopActionErrorMessage(error, options.redact),
        });
        throw error;
      }
    }
  };

  let latestData: DesktopAgentData | undefined;
  let reportedError: DesktopAgentData | undefined;
  let totalTokens = 0;
  let modelCalls = 0;
  const thinkingStartedAt = Date.now();
  const operator = new BreadboardDesktopOperator();
  const quietLogger = {
    log: () => {},
    info: (...args: unknown[]) => {
      // UI-TARS SDK 1.2.3 exposes per-call costTokens through its configured
      // logger but not through onData. Ignore the line when usage is absent.
      const match = /costTokens:\s*(\d+(?:\.\d+)?)/i.exec(args.map(String).join(" "));
      if (!match) return;
      const callTokens = Math.max(0, Math.trunc(Number(match[1])));
      if (!Number.isFinite(callTokens)) return;
      totalTokens += callTokens;
      modelCalls += 1;
      host.usage?.({ totalTokens, calls: modelCalls });
    },
    warn: () => {},
    error: () => {},
  };
  host.thinking?.({ state: "started", summary: "Reviewing the current desktop" });
  const actionSpaces = (
    (BreadboardDesktopOperator as unknown as {
      MANUAL?: { ACTION_SPACES?: unknown };
    }).MANUAL?.ACTION_SPACES
  );
  const modelConfiguration = {
    model: params.config.model,
    ...(params.config.endpoint ? { baseURL: params.config.endpoint } : {}),
    ...(params.providerApiKey ? { apiKey: params.providerApiKey } : {}),
  };
  if (params.config.desktopCoordinateSpace === "screen_pixels") {
    const ScreenPixelModel = class extends dependencies.UITarsModel {
      private screenshotFactors: [number, number] = [1000, 1000];

      constructor(config: Record<string, unknown>) {
        super(config);
        // Upstream exposes factors as a getter. Install an instance getter so
        // it can follow each screenshot's native dimensions at runtime.
        Object.defineProperty(this, "factors", {
          configurable: true,
          get: () => this.screenshotFactors,
        });
      }

      setScreenshotSize(width: number, height: number): void {
        this.screenshotFactors = [width, height];
      }
    };
    coordinateModel = new ScreenPixelModel(modelConfiguration);
  }
  const agent = new dependencies.GUIAgent({
    model: coordinateModel ?? modelConfiguration,
    operator,
    signal: host.signal,
    maxLoopCount: params.config.maxSteps,
    retry: {
      model: { maxRetries: 1 },
      // Never replay a real GUI action automatically.
      execute: { maxRetries: 0 },
    },
    systemPrompt: desktopSystemPrompt(
      Array.isArray(actionSpaces)
        ? actionSpaces.filter((action): action is string => typeof action === "string")
        : [],
      params.config.desktopCoordinateSpace,
    ),
    logger: quietLogger,
    onData: ({ data }: { data: DesktopAgentData }) => {
      latestData = mergeDesktopAgentData(latestData, data);
      const latestConversation = data.conversations?.at(-1);
      const prediction = latestConversation?.predictionParsed?.at(-1);
      if (latestConversation?.from === "human") {
        host.thinking?.({ state: "active", summary: "Reviewing the current desktop" });
      }
      if (prediction?.action_type) {
        const safeAction = options.redact(prediction.action_type).replaceAll("_", " ");
        host.thinking?.({ state: "active", summary: `Preparing ${safeAction}` });
        host.status(`Desktop action: ${safeAction}`);
      }
    },
    onError: ({ data }: { data: DesktopAgentData }) => {
      reportedError = data;
    },
  });
  const returnWindow = await dependencies.getActiveWindow().catch(() => null);
  options.onAgentStart?.(agent);
  host.desktopControlStarted?.();

  const onAbort = () => agent.stop();
  host.signal.addEventListener("abort", onAbort, { once: true });
  let executionFailed = false;
  try {
    await agent.run(params.task);
  } catch {
    if (!host.signal.aborted) {
      executionFailed = true;
      return { status: "failed", failure: safeFailure(reportedError ?? latestData, options.redact) };
    }
  } finally {
    const terminalFailure = executionFailed || Boolean(reportedError) || latestData?.status === "error" || latestData?.status === "max_loop";
    host.thinking?.({
      state: "completed",
      summary: host.signal.aborted
        ? "Desktop task stopped"
        : terminalFailure
          ? "Desktop task failed"
          : "Desktop analysis complete",
      durationMs: Date.now() - thinkingStartedAt,
    });
    host.signal.removeEventListener("abort", onAbort);
    options.onAgentStop?.(agent);
    host.desktopControlStopped?.();
    await restoreDesktopReturnWindow(returnWindow);
  }

  if (host.signal.aborted || latestData?.status === "user_stopped") return { status: "aborted" };
  if (reportedError || latestData?.status === "error" || latestData?.status === "max_loop") {
    return { status: "failed", failure: safeFailure(reportedError ?? latestData, options.redact) };
  }
  const resultSummary = desktopResultSummary(latestData, options.redact);
  if (latestData?.status === "call_user") {
    const summary = resultSummary ?? "Desktop operator paused because it needs user input";
    host.status(summary);
    return { status: "completed", summary };
  }
  const summary = resultSummary ?? "Desktop task finished";
  host.status(summary);
  return { status: "completed", summary };
}
