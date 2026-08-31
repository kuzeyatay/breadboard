import "server-only";

// The Windows implementation of WorkflowComputerBackend.
//
// `observe` reads the live accessibility tree; `execute` acts on an element the
// caller picked out of that tree. Coordinates are resolved inside the helper, at
// the moment of the action, from the element's current rectangle -- which is what
// lets a replay survive a moved window, a different screen size, a reordered
// list, and everything else that makes replaying a recorded pixel wrong.
//
// One helper process per run, started when the run starts and killed when it
// ends. Nothing stays resident.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { teachLog, teachWarn } from "./redaction.ts";
import type {
  ActionResult,
  ComputerAction,
  ComputerObservation,
  ObservedElement,
  WorkflowComputerBackend,
} from "./types.ts";
import { ensureHelperBinary, helperAvailability, helperChildEnvironment } from "./windows-helper.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 30_000;

interface PendingCommand {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class WindowsComputerBackend implements WorkflowComputerBackend {
  readonly platform = "win32";

  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  private readonly pending = new Map<string, PendingCommand>();
  private sequence = 0;
  private stopped = false;
  /**
   * Shared by every caller of stop().
   *
   * Stopping is racy by design: the Stop button calls it, and the run loop calls
   * it again in its own teardown. Without one promise for the pair, the second
   * caller writes to a stdin the first has already ended, which Node reports as
   * an unhandled stream error and takes the whole process down with it.
   */
  private stopping: Promise<void> | null = null;

  available(): { available: boolean; reason?: string } {
    return helperAvailability();
  }

  private async ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.stopped) throw new Error("This computer backend has been stopped.");
    if (this.child && this.child.exitCode === null) return this.child;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const binary = await ensureHelperBinary();
      const child = spawn(binary, ["control"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: helperChildEnvironment(),
      }) as ChildProcessWithoutNullStreams;

      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) this.deliver(line);
          index = buffer.indexOf("\n");
        }
        if (buffer.length > 8 * 1024 * 1024) buffer = "";
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        teachWarn("computer", "control helper reported a problem", { chunk: String(chunk) });
      });
      // A helper that exits while a command is in flight breaks the pipe. That
      // is an expected way for this to end, not a crash.
      child.stdin.on("error", () => undefined);
      child.once("exit", (code) => {
        this.child = null;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`The desktop control helper exited with code ${code}.`));
        }
        this.pending.clear();
      });

      // A helper that cannot answer a ping cannot drive anything either, and
      // finding that out now beats finding it out mid-run.
      this.child = child;
      const ping = this.send({ op: "ping" }, START_TIMEOUT_MS);
      await ping;
      teachLog("computer", "desktop control helper started");
      return child;
    })().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private deliver(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof message.id === "string" ? message.id : null;
    if (!id) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  }

  private send(
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return Promise.reject(new Error("The desktop control helper is not running."));
    }
    this.sequence += 1;
    const id = `c${this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The desktop control helper did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  private async call(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureChild();
    const response = await this.send(command);
    if (response.ok !== true) {
      throw new Error(typeof response.error === "string" ? response.error : "The desktop action failed.");
    }
    return response;
  }

  async observe(
    options: { screenshotPath?: string; maxElements?: number; includeAllWindows?: boolean } = {},
  ): Promise<ComputerObservation> {
    const response = await this.call({
      op: "observe",
      maxElements: options.maxElements ?? 220,
      ...(options.screenshotPath ? { screenshotPath: options.screenshotPath } : {}),
      ...(options.includeAllWindows ? { includeAllWindows: true } : {}),
    });

    const rawElements = Array.isArray(response.elements) ? response.elements : [];
    const elements: ObservedElement[] = [];
    for (const raw of rawElements) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const ref = typeof record.ref === "string" ? record.ref : null;
      const describe = typeof record.describe === "string" ? record.describe : null;
      if (!ref || !describe) continue;
      elements.push({
        ref,
        describe,
        name: typeof record.name === "string" ? record.name : undefined,
        role: typeof record.role === "string" ? record.role : undefined,
        automationId: typeof record.automationId === "string" ? record.automationId : undefined,
        className: typeof record.className === "string" ? record.className : undefined,
        value: typeof record.value === "string" ? record.value : undefined,
        enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
        isPassword: record.isPassword === true,
        left: typeof record.left === "number" ? record.left : undefined,
        top: typeof record.top === "number" ? record.top : undefined,
        width: typeof record.width === "number" ? record.width : undefined,
        height: typeof record.height === "number" ? record.height : undefined,
      });
    }

    const foreground = (response.foreground ?? {}) as Record<string, unknown>;
    const screen = (response.screen ?? {}) as Record<string, unknown>;
    const windows = Array.isArray(response.windows)
      ? (response.windows as Array<Record<string, unknown>>)
          .filter((entry) => typeof entry.windowTitle === "string")
          .map((entry) => ({
            windowTitle: entry.windowTitle as string,
            app: typeof entry.app === "string" ? entry.app : undefined,
          }))
      : undefined;

    return {
      foreground: {
        app: typeof foreground.app === "string" ? foreground.app : undefined,
        windowTitle: typeof foreground.windowTitle === "string" ? foreground.windowTitle : undefined,
        left: typeof foreground.left === "number" ? foreground.left : undefined,
        top: typeof foreground.top === "number" ? foreground.top : undefined,
        width: typeof foreground.width === "number" ? foreground.width : undefined,
        height: typeof foreground.height === "number" ? foreground.height : undefined,
      },
      screen: {
        width: typeof screen.width === "number" ? screen.width : 0,
        height: typeof screen.height === "number" ? screen.height : 0,
      },
      elements,
      ...(windows ? { windows } : {}),
      ...(typeof response.screenshotPath === "string" ? { screenshotPath: response.screenshotPath } : {}),
    };
  }

  async execute(action: ComputerAction): Promise<ActionResult> {
    try {
      let response: Record<string, unknown>;
      switch (action.kind) {
        case "click":
          response = await this.call({
            op: "click",
            ...(action.ref ? { ref: action.ref } : {}),
            ...(action.x !== undefined ? { x: action.x } : {}),
            ...(action.y !== undefined ? { y: action.y } : {}),
            ...(action.button ? { button: action.button } : {}),
            ...(action.clicks ? { clicks: action.clicks } : {}),
          });
          break;
        case "type":
          response = await this.call({
            op: "type",
            text: action.text,
            ...(action.ref ? { ref: action.ref } : {}),
            ...(action.clear !== undefined ? { clear: action.clear } : {}),
          });
          break;
        case "key":
          response = await this.call({
            op: "key",
            key: action.key,
            ...(action.modifiers && action.modifiers.length > 0 ? { modifiers: action.modifiers } : {}),
          });
          break;
        case "scroll":
          response = await this.call({
            op: "scroll",
            ...(action.ref ? { ref: action.ref } : {}),
            ...(action.notches !== undefined ? { notches: action.notches } : {}),
          });
          break;
        case "focus_window":
          response = await this.call({
            op: "focus_window",
            ...(action.titleContains ? { titleContains: action.titleContains } : {}),
            ...(action.app ? { app: action.app } : {}),
          });
          break;
        case "screenshot":
          response = await this.call({
            op: "screenshot",
            path: action.path,
            ...(action.maxWidth ? { maxWidth: action.maxWidth } : {}),
          });
          break;
        default: {
          const exhaustive: never = action;
          throw new Error(`Unsupported action ${JSON.stringify(exhaustive)}`);
        }
      }
      const detail: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(response)) {
        // `ok` and `id` are protocol, not result.
        if (key !== "ok" && key !== "id") detail[key] = value;
      }
      return { ok: true, detail };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /**
   * Give up control of the machine.
   *
   * Called on completion, on failure and on Stop. A replay process that outlives
   * the run it belonged to is a process typing into whatever the user is doing
   * now, so this asks once and then kills.
   */
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopHelper();
    return this.stopping;
  }

  private async stopHelper(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    const exited =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      if (!child.stdin.writableEnded) {
        child.stdin.write(`${JSON.stringify({ op: "exit", id: "exit" })}\n`);
        child.stdin.end();
      }
    } catch {
      // Already closed.
    }
    const settled = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
    ]);
    if (!settled) {
      try {
        child.kill();
      } catch {
        // Nothing left to kill.
      }
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    this.child = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("The run was stopped."));
    }
    this.pending.clear();
    teachLog("computer", "desktop control helper stopped");
  }

  /** The helper's process id, so a supervisor can confirm it is gone. */
  processId(): number | null {
    return this.child?.pid ?? null;
  }
}
