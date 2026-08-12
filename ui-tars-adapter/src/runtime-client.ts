// The stable RuntimeClient boundary.
//
// Everything above this line is Breadboard-owned and upstream-agnostic. Two
// implementations satisfy it: FakeRuntimeClient (deterministic, dependency-free;
// for unit + CI tests) and AgentTarsRuntimeClient (wraps @agent-tars/core; for
// integration / E2E / packaged smoke tests). The fake is NEVER presented as
// satisfying real-browser acceptance criteria.

import type { RuntimeKind } from "./config.ts";
import type { ProposedAction } from "./approval-policy.ts";
import type {
  AgentThinkingUpdate,
  AgentTokenUsage,
  ApprovalActionType,
  OperatorType,
  RunFailure,
  UITarsAgentConfiguration,
} from "./types.ts";

export interface RuntimeCapabilities {
  runtime: RuntimeKind;
  /** Legacy/default target, retained for existing health consumers. */
  operator: "browser";
  operators: ReadonlyArray<OperatorType>;
  strategies: ReadonlyArray<"gui" | "dom" | "hybrid">;
  /** True only for the real Agent TARS runtime. */
  realBrowser: boolean;
  version: string;
}

export interface StartRunParams {
  runId: string;
  task: string;
  config: UITarsAgentConfiguration;
  /** Isolated browser profile directory for this run (real runtime only). */
  profileDir?: string;
  /**
   * Provider API key, injected in-memory only. NEVER logged, echoed, or
   * persisted. The runtime hands it straight to the model client.
   */
  providerApiKey?: string;
}

/**
 * The host (adapter server) implements this. The runtime calls into it to emit
 * observations/actions and to gate sensitive actions. The host owns event
 * sequencing, the state machine, the approval registry, and persistence.
 */
export interface RuntimeHost {
  status(text: string): void;
  /** Emit safe progress metadata, never raw chain-of-thought. */
  thinking?(update: AgentThinkingUpdate): void;
  /** Emit cumulative provider-reported or explicitly estimated usage. */
  usage?(usage: AgentTokenUsage): void;
  page(info: { url?: string; title?: string }): void;
  screenshot(data: { base64?: string; caption?: string }): Promise<void>;
  actionStarted(a: { actionId: string; action: ApprovalActionType; target: string }): void;
  actionCompleted(a: { actionId: string; summary?: string }): void;
  actionFailed(a: { actionId: string; error: string }): void;
  /**
   * Ask the host to authorize a potentially-sensitive action. The host applies
   * policy: non-sensitive actions resolve immediately (true); sensitive ones
   * pause until a human decision. Returns true → execute, false → do NOT execute.
   */
  requestApproval(action: ProposedAction): Promise<boolean>;
  /**
   * Report the OS browser process this run owns, so the host can track it and
   * guarantee cleanup on abort/shutdown/crash. Fake runtime never calls this.
   */
  ownBrowser?(pid: number, profileDir: string): void;
  /** Aborted by the host (stop / rejection). The runtime must stop promptly. */
  readonly signal: AbortSignal;
}

export type RunOutcomeStatus = "completed" | "failed" | "aborted" | "runtime_lost";

export interface RunOutcome {
  status: RunOutcomeStatus;
  failure?: RunFailure;
  /** Optional final textual result (sanitized, no chain-of-thought). */
  summary?: string;
}

export interface RuntimeClient {
  readonly kind: RuntimeKind;
  capabilities(): RuntimeCapabilities;
  run(params: StartRunParams, host: RuntimeHost): Promise<RunOutcome>;
  /** Best-effort cleanup of any owned processes on shutdown. */
  shutdown(): Promise<void>;
}

// --------------------------------------------------------------------------
// FakeRuntimeClient — deterministic scenario for CI.
// --------------------------------------------------------------------------

const FIRST_URL_RE = /https?:\/\/[^\s"'<>]+/i;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

export interface FakeRuntimeOptions {
  /** Base step delay (ms). Tests can set 0 for instant runs. */
  stepDelayMs?: number;
  version?: string;
}

/**
 * Deterministic runtime: navigate → screenshot → fill → propose form submit
 * (gated) → submit-or-stop. Fully abortable. No real browser, no model, no deps.
 */
export class FakeRuntimeClient implements RuntimeClient {
  readonly kind: RuntimeKind = "fake";
  private stepDelayMs: number;
  private version: string;

  constructor(opts: FakeRuntimeOptions = {}) {
    this.stepDelayMs = opts.stepDelayMs ?? 5;
    this.version = opts.version ?? "fake-0.1.0";
  }

  capabilities(): RuntimeCapabilities {
    return {
      runtime: "fake",
      operator: "browser",
      operators: ["browser"],
      strategies: ["dom", "gui", "hybrid"],
      realBrowser: false,
      version: this.version,
    };
  }

  async run(params: StartRunParams, host: RuntimeHost): Promise<RunOutcome> {
    if (params.config.operator === "computer") {
      return {
        status: "failed",
        failure: {
          code: "desktop_runtime_unavailable",
          message: "Actual desktop control requires the Agent TARS runtime",
        },
      };
    }
    const { signal } = host;
    const startUrl = FIRST_URL_RE.exec(params.task)?.[0] ?? "http://127.0.0.1/index.html";
    const step = () => delay(this.stepDelayMs, signal);
    const aborted = (): RunOutcome => ({ status: "aborted" });

    host.status("Launching isolated browser");
    await step();
    if (signal.aborted) return aborted();

    // Navigate (gated: leaving allowlist would be sensitive).
    const navUrl = startUrl;
    const navHost = hostname(navUrl);
    const navOk = await host.requestApproval({
      toolName: "browser_navigate",
      action: "navigate",
      target: navUrl,
      targetUrl: navUrl,
    });
    if (!navOk) return aborted();
    host.actionStarted({ actionId: "nav-1", action: "navigate", target: navUrl });
    await step();
    if (signal.aborted) return aborted();
    host.page({ url: navUrl, title: navHost });
    host.actionCompleted({ actionId: "nav-1", summary: `Opened ${navHost}` });
    await host.screenshot({ base64: onePixelPng(), caption: `Loaded ${navHost}` });
    await step();
    if (signal.aborted) return aborted();

    // Fill form (not sensitive).
    host.actionStarted({ actionId: "fill-1", action: "type", target: "input#name" });
    await step();
    host.actionCompleted({ actionId: "fill-1", summary: "Filled form fields" });
    await host.screenshot({ base64: onePixelPng(), caption: "Form filled" });
    await step();
    if (signal.aborted) return aborted();

    // Propose form submission — ALWAYS gated in MVP.
    const submitOk = await host.requestApproval({
      toolName: "browser_click",
      action: "submit",
      target: "button[type=submit]",
      submitIntent: true,
    });
    if (signal.aborted) return aborted();
    if (!submitOk) {
      host.status("Submission rejected — form was not submitted");
      return { status: "aborted" };
    }

    host.actionStarted({ actionId: "submit-1", action: "submit", target: "button[type=submit]" });
    await step();
    if (signal.aborted) return aborted();
    host.actionCompleted({ actionId: "submit-1", summary: "Form submitted" });
    await host.screenshot({ base64: onePixelPng(), caption: "Submission complete" });
    host.status("Task complete");
    return { status: "completed", summary: `Submitted the form on ${navHost}` };
  }

  async shutdown(): Promise<void> {
    // Nothing owned.
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A 1x1 transparent PNG (base64) — a valid, tiny deterministic screenshot. */
function onePixelPng(): string {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}
