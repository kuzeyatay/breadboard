// Real Agent TARS runtime wrapper.
//
// LAZILY imported — only loaded when UI_TARS_RUNTIME=agent-tars — so unit/CI
// runs never require the heavy upstream deps. This is the ONLY file that touches
// upstream @agent-tars/* / @agent-infra/* types, isolating their churn from the
// rest of Breadboard (task brief §18).
//
// Verified against bytedance/UI-TARS-desktop @ c2ad42e3eb9b27830db41a3e6f51ca7179d9b168
// (see docs/UI_TARS_VERIFIED_INTEGRATION.md):
//  - Isolation: AgentTARS's BrowserManager does NOT forward userDataDir, so we
//    launch our OWN isolated Chromium (userDataDir, never profilePath) and attach
//    AgentTARS to it via cdpEndpoint (getBrowser() → RemoteBrowser connect path).
//  - Process ownership: puppeteer Browser.process()?.pid, reported to the host.
//  - Approval: override onBeforeToolCall (awaited before executeTool). On
//    rejection the host trips abort so the pre-execution abort check skips the
//    tool — real interception, never simulated.
//  - browserStrategy 'gui' maps to upstream 'visual-grounding'.

/* eslint-disable @typescript-eslint/no-explicit-any -- upstream boundary only */

import path from "node:path";
import fs from "node:fs";
import type {
  RuntimeClient,
  RuntimeCapabilities,
  RuntimeHost,
  StartRunParams,
  RunOutcome,
} from "./runtime-client.ts";
import type { ProposedAction } from "./approval-policy.ts";
import { hostAllowed } from "./approval-policy.ts";
import { attachSubmissionGate } from "./browser-gate.ts";
import type { BrowserStrategy } from "./types.ts";
import {
  runDesktopTask,
  type DesktopAgentHandle,
} from "./desktop-runtime.ts";

export interface AgentTarsRuntimeOptions {
  dataDir: string;
  version: string;
  redact: (line: string) => string;
}

function mapStrategy(s: BrowserStrategy): "dom" | "visual-grounding" | "hybrid" {
  return s === "gui" ? "visual-grounding" : s;
}

// Provider names AgentTARS's bundled TokenJS client recognizes as first-class.
// Anything else must be routed through its "openai-compatible" handler (which
// accepts an arbitrary model id + baseURL). Passing an unrecognized provider —
// e.g. "chatmock" — makes TokenJS dereference an undefined provider entry during
// model registration ("Cannot read properties of undefined (reading 'models')"),
// which aborts the run before the browser ever launches.
const TOKENJS_NATIVE_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "groq",
  "ai21",
  "perplexity",
  "openrouter",
  "openai-compatible",
  "azure-openai",
  "bedrock",
  "cohere",
]);

/**
 * Resolve the provider string handed to AgentTARS. ChatMock and any other
 * OpenAI-compatible custom endpoint are sent as "openai-compatible" so the
 * runtime talks to them through the generic handler with our baseURL + apiKey.
 * Known providers pass through unchanged.
 */
function resolveModelProvider(provider: string, hasEndpoint: boolean): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "chatmock") return "openai-compatible";
  if (!TOKENJS_NATIVE_PROVIDERS.has(normalized) && hasEndpoint) return "openai-compatible";
  return provider;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function estimateTokens(value: unknown): number {
  let serialized = "";
  try {
    serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && /^data:image\//i.test(item)) return "[image]";
      return item;
    });
  } catch {
    serialized = String(value ?? "");
  }
  return serialized.length === 0 ? 0 : Math.max(1, Math.ceil(serialized.length / 4));
}

function streamedOutput(chunks: unknown[]): string {
  const parts: string[] = [];
  for (const item of chunks) {
    const chunk = item as any;
    for (const choice of Array.isArray(chunk?.choices) ? chunk.choices : []) {
      const delta = choice?.delta ?? {};
      for (const value of [delta.content, delta.reasoning_content, delta.reasoning]) {
        if (typeof value === "string") parts.push(value);
      }
      for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        if (typeof call?.function?.name === "string") parts.push(call.function.name);
        if (typeof call?.function?.arguments === "string") parts.push(call.function.arguments);
      }
    }
  }
  return parts.join("");
}

/** Normalize a provider usage chunk, falling back to a clearly marked estimate. */
export function browserCallTokenUsage(
  request: unknown,
  chunks: unknown[],
): { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean } {
  const providerUsage = [...chunks]
    .reverse()
    .map((chunk) => (chunk as any)?.usage)
    .find((usage) => usage && typeof usage === "object") as Record<string, unknown> | undefined;
  if (providerUsage) {
    const inputTokens = tokenCount(providerUsage.input_tokens ?? providerUsage.prompt_tokens);
    const outputTokens = tokenCount(providerUsage.output_tokens ?? providerUsage.completion_tokens);
    const totalTokens = tokenCount(providerUsage.total_tokens);
    if (totalTokens !== undefined || inputTokens !== undefined || outputTokens !== undefined) {
      const input = inputTokens ?? 0;
      const output = outputTokens ?? 0;
      return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: totalTokens ?? input + output,
        estimated: false,
      };
    }
  }

  const inputTokens = estimateTokens(request);
  const outputText = streamedOutput(chunks);
  const outputTokens = outputText.length === 0 ? 0 : Math.max(1, Math.ceil(outputText.length / 4));
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true };
}

const UPSTREAM_RUN_ERROR = /^Sorry, an error occurred while processing your request:/i;

/**
 * AgentTARS currently catches some model-provider exceptions and returns them
 * as an assistant message instead of rejecting `run()`. Normalize that known
 * error envelope here so the control plane emits run.failed rather than a
 * misleading green run.completed event.
 */
export function normalizeAgentResult(
  result: any,
  redact: (line: string) => string = (line) => line,
): RunOutcome {
  const summary =
    typeof result === "string"
      ? result
      : typeof result?.content === "string"
        ? result.content
        : undefined;

  if (summary && UPSTREAM_RUN_ERROR.test(summary.trim())) {
    const connectionFailure = /\bconnection error\b/i.test(summary);
    return {
      status: "failed",
      failure: {
        code: connectionFailure ? "model_connection_error" : "agent_error",
        message: connectionFailure
          ? "Agent TARS could not connect to the configured model endpoint"
          : "Agent TARS could not complete the model request",
      },
    };
  }

  return {
    status: "completed",
    summary: summary ? redact(summary) : undefined,
  };
}

/**
 * Capture the page without leaking AgentTARS/browser-use targeting overlays
 * into Breadboard's user-facing preview. The markers are hidden only for the
 * duration of the PNG capture and restored immediately so agent control state
 * is left untouched.
 */
export async function captureCleanPagePng(page: any): Promise<string> {
  const overlayState = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const selectors = [
      "#playwright-highlight-container",
      "#gui-agent-clickable-legend",
    ];
    return selectors.flatMap((selector: string) =>
      Array.from(doc.querySelectorAll(selector)).map((element: any, index: number) => {
        const marker = `breadboard-screenshot-${Date.now()}-${index}-${Math.random()}`;
        const visibility = element.style.getPropertyValue("visibility");
        const priority = element.style.getPropertyPriority("visibility");
        element.setAttribute("data-breadboard-screenshot-marker", marker);
        element.style.setProperty("visibility", "hidden", "important");
        return { marker, visibility, priority };
      }),
    );
  });

  try {
    const png = await page.screenshot({ encoding: "base64", type: "png" });
    return typeof png === "string" ? png : Buffer.from(png).toString("base64");
  } finally {
    if (overlayState.length > 0) {
      try {
        await page.evaluate((states: Array<{ marker: string; visibility: string; priority: string }>) => {
          const doc = (globalThis as any).document;
          for (const state of states) {
            const elements = Array.from(doc.querySelectorAll("[data-breadboard-screenshot-marker]"));
            const element = elements.find(
              (candidate: any) => candidate.getAttribute("data-breadboard-screenshot-marker") === state.marker,
            ) as any;
            if (!element) continue;
            element.removeAttribute("data-breadboard-screenshot-marker");
            if (state.visibility) {
              element.style.setProperty("visibility", state.visibility, state.priority);
            } else {
              element.style.removeProperty("visibility");
            }
          }
        }, overlayState);
      } catch {
        // The page may navigate immediately after capture; the old document and
        // its temporary inline style are discarded with it.
      }
    }
  }
}

/** Best-effort structured classification of an upstream browser tool call. */
export function classifyToolCall(name: string, args: any): ProposedAction {
  const target = String(
    args?.__downloadTarget ?? args?.url ?? args?.path ?? args?.filename ?? args?.selector ?? args?.element ?? args?.index ?? name,
  );
  const actionHint = String(args?.action ?? args?.type ?? "");
  if (
    /download/i.test(name) ||
    /\bdownload\b/i.test(actionHint) ||
    args?.__downloadIntent === true ||
    args?.isDownload === true ||
    args?.download === true
  ) {
    return { toolName: name, action: "download", target, isDownload: true };
  }
  if (name === "browser_navigate") {
    return { toolName: name, action: "navigate", target, targetUrl: String(args?.url ?? "") };
  }
  if (name === "browser_evaluate") {
    return { toolName: name, action: "click", target: "page-script", isEval: true };
  }
  if (name === "browser_press_key") {
    const key = String(args?.key ?? "").toLowerCase();
    const submitIntent = key === "enter" || key === "return";
    return { toolName: name, action: submitIntent ? "submit" : "type", target, submitIntent };
  }
  if (
    name === "browser_click" ||
    name === "browser_vision_control" ||
    /browser_vision.*click/i.test(name)
  ) {
    // Submit-intent when the resolved element is a submit/button (set by the
    // pre-classify DOM probe). Conservative default keeps harmless clicks open.
    const submitIntent = Boolean(args?.__submitIntent);
    return { toolName: name, action: submitIntent ? "submit" : "click", target, submitIntent };
  }
  if (name === "browser_form_input_fill") {
    return { toolName: name, action: "type", target };
  }
  // Unknown/other tools: treat as click for gating in every_action mode.
  return { toolName: name, action: "click", target };
}

/**
 * Inspect the currently targeted DOM element before a click executes. Agent
 * TARS represents ordinary downloads as generic clicks, so tool-name-only
 * classification would otherwise miss an `<a download>` or Download button.
 */
async function enrichClickIntent(browser: any, name: string, args: any): Promise<any> {
  const clickTool = name === "browser_click" || /browser_vision.*click/i.test(name);
  if (!clickTool || !browser || typeof browser.pages !== "function") return args;
  try {
    const pages = await browser.pages();
    const page = pages[pages.length - 1];
    if (!page) return args;
    const intent = await page.evaluate(
      ({ index, x, y }: { index?: number; x?: number; y?: number }) => {
        const doc = (globalThis as any).document;
        let element: any = null;
        if (Number.isFinite(index)) {
          element = doc.querySelector(
            `[browser-user-highlight-id="playwright-highlight-${index}"]`,
          );
        } else if (Number.isFinite(x) && Number.isFinite(y)) {
          const px = Math.abs(x!) <= 1 ? x! * (globalThis as any).innerWidth : x!;
          const py = Math.abs(y!) <= 1 ? y! * (globalThis as any).innerHeight : y!;
          element = doc.elementFromPoint(px, py);
        }
        const actionable = element?.closest?.("a, button, input, [role='button'], [role='link']") ?? element;
        const anchor = actionable?.closest?.("a[href]");
        const label = [
          actionable?.textContent,
          actionable?.getAttribute?.("aria-label"),
          actionable?.getAttribute?.("title"),
          actionable?.getAttribute?.("data-action"),
        ].filter(Boolean).join(" ");
        const download = Boolean(
          anchor?.hasAttribute?.("download") || /\bdownload\b/i.test(label),
        );
        const submit = Boolean(
          actionable?.matches?.("button[type='submit'], input[type='submit'], input[type='image']") ||
          actionable?.closest?.("form") && /\b(submit|send|sign in|log in|purchase|pay)\b/i.test(label),
        );
        return {
          download,
          submit,
          target: download ? String(anchor?.href ?? label).slice(0, 1_000) : undefined,
        };
      },
      {
        index: Number.isFinite(args?.index) ? Number(args.index) : undefined,
        x: Number.isFinite(args?.x) ? Number(args.x) : undefined,
        y: Number.isFinite(args?.y) ? Number(args.y) : undefined,
      },
    );
    return {
      ...args,
      ...(intent?.download ? { __downloadIntent: true, __downloadTarget: intent.target } : {}),
      ...(intent?.submit ? { __submitIntent: true } : {}),
    };
  } catch {
    return args;
  }
}

export class AgentTarsRuntimeClient implements RuntimeClient {
  readonly kind = "agent-tars" as const;
  private opts: AgentTarsRuntimeOptions;
  private activeBrowsers = new Set<{ close: () => Promise<void> }>();
  private activeDesktopAgents = new Set<DesktopAgentHandle>();

  constructor(opts: AgentTarsRuntimeOptions) {
    this.opts = opts;
  }

  capabilities(): RuntimeCapabilities {
    return {
      runtime: "agent-tars",
      operator: "browser",
      operators: ["browser", "computer"],
      strategies: ["dom", "gui", "hybrid"],
      realBrowser: true,
      version: this.opts.version,
    };
  }

  async run(params: StartRunParams, host: RuntimeHost): Promise<RunOutcome> {
    const { redact } = this.opts;
    if (params.config.operator === "computer") {
      return runDesktopTask(params, host, {
        redact,
        onAgentStart: (agent) => this.activeDesktopAgents.add(agent),
        onAgentStop: (agent) => this.activeDesktopAgents.delete(agent),
      });
    }

    // Dynamic imports so this module can be present without deps installed until
    // the runtime is actually selected + installed.
    const { AgentTARS } = (await import("@agent-tars/core")) as any;

    const profileDir = path.join(this.opts.dataDir, "browser-profiles", params.runId);
    await fs.promises.mkdir(profileDir, { recursive: true });

    // 1) Let AgentTARS launch its OWN browser. Puppeteer's default (no
    //    profilePath, ephemeral fresh userDataDir) is already isolated from the
    //    user's real profile — no inherited cookies/extensions/password-manager.
    //    Bridging a pre-launched browser via cdpEndpoint proved incompatible
    //    across the published core@0.3.0 / browser@0.2.2 pair, so we own the
    //    process + attach the gate to AgentTARS's browser once it launches.
    const agent = new AgentTARS({
      model: {
        provider: resolveModelProvider(params.config.provider, Boolean(params.config.endpoint)),
        id: params.config.model,
        ...(params.config.endpoint ? { baseURL: params.config.endpoint } : {}),
        ...(params.providerApiKey ? { apiKey: params.providerApiKey } : {}),
      },
      browser: {
        type: "local",
        headless: true,
        control: mapStrategy(params.config.browserStrategy),
      },
      maxIterations: params.config.maxSteps,
    });

    // Agent TARS exposes complete request/stream hooks even though its public
    // event stream has no usage event. Prefer the provider's final usage chunk;
    // otherwise publish a text-only estimate and label it as estimated.
    let currentRequest: unknown = null;
    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;
    let cumulativeTotalTokens = 0;
    let modelCalls = 0;
    let anyEstimatedUsage = false;
    const originalLLMRequest = agent.onLLMRequest?.bind(agent);
    agent.onLLMRequest = (sessionId: string, payload: any) => {
      currentRequest = payload?.request ?? null;
      return originalLLMRequest?.(sessionId, payload);
    };
    const originalStreamingResponse = agent.onLLMStreamingResponse?.bind(agent);
    agent.onLLMStreamingResponse = (sessionId: string, payload: any) => {
      originalStreamingResponse?.(sessionId, payload);
      const usage = browserCallTokenUsage(
        currentRequest,
        Array.isArray(payload?.chunks) ? payload.chunks : [],
      );
      cumulativeInputTokens += usage.inputTokens;
      cumulativeOutputTokens += usage.outputTokens;
      cumulativeTotalTokens += usage.totalTokens;
      modelCalls += 1;
      anyEstimatedUsage ||= usage.estimated;
      host.usage?.({
        inputTokens: cumulativeInputTokens,
        outputTokens: cumulativeOutputTokens,
        totalTokens: cumulativeTotalTokens,
        calls: modelCalls,
        ...(anyEstimatedUsage ? { estimated: true } : {}),
      });
      currentRequest = null;
    };

    // Attach ownership + the DOM-layer submission gate + periodic screenshots once
    // AgentTARS's browser launches (lazily, on first browser tool). The gate pauses
    // the actual form POST / off-allowlist navigation BEFORE it leaves the browser.
    // tryAttach is idempotent and is called both from a poll and from every browser
    // tool boundary, so the gate is guaranteed present before any later submit.
    let detachGate: () => void = () => {};
    let attached: any = null;
    let shotTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let screenshotQueue: Promise<void> = Promise.resolve();
    const captureScreenshot = (caption?: string): Promise<void> => {
      const capture = screenshotQueue.then(async () => {
        if (!attached) return;
        try {
          const pages = await attached.pages();
          const page = pages[pages.length - 1];
          if (!page) return;
          const base64 = await captureCleanPagePng(page);
          if (base64) await host.screenshot({ base64, ...(caption ? { caption } : {}) });
        } catch {
          /* transient navigation or browser shutdown */
        }
      });
      screenshotQueue = capture.catch(() => {});
      return capture;
    };
    const tryAttach = (): void => {
      if (attached) return;
      let pptr: any = null;
      try {
        // AgentTARS@0.3.0 bundles its OWN browser wrapper (LocalBrowser, 0.1.1
        // API) whose puppeteer handle is `.getBrowser()`; the standalone 0.2.2
        // package exposes `.pptrBrowser`. Support both shapes.
        const b = agent.getBrowserManager?.()?.getBrowser?.();
        pptr = b?.pptrBrowser ?? (typeof b?.getBrowser === "function" ? b.getBrowser() : null);
      } catch {
        pptr = null;
      }
      if (!pptr || typeof pptr.pages !== "function") return;
      attached = pptr;
      const pid = pptr.process?.()?.pid;
      if (typeof pid === "number") host.ownBrowser?.(pid, profileDir);
      detachGate = attachSubmissionGate(pptr, {
        hostAllowed: (h) => hostAllowed(h, params.config.allowedDomains),
        requestApproval: (a) =>
          host.requestApproval({
            toolName: "network",
            action: a.action,
            target: a.target,
            ...(a.targetUrl ? { targetUrl: a.targetUrl } : {}),
            ...(a.submitIntent ? { submitIntent: true } : {}),
          }),
      });
      // Capture immediately, then periodically. DOM mode does not emit a PNG
      // screenshot event of its own, and short tasks may finish before 2.5s.
      void captureScreenshot("Browser ready");
      shotTimer = setInterval(() => void captureScreenshot(), 2500);
      shotTimer.unref?.();
    };
    const attachTask = (async () => {
      for (let i = 0; i < 60 && !attached && !stopped && !host.signal.aborted; i++) {
        tryAttach();
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

    const closeBrowser = {
      close: async () => {
        try {
          await agent.getBrowserManager?.()?.getBrowser?.()?.close?.();
        } catch {
          /* ignore */
        }
      },
    };
    this.activeBrowsers.add(closeBrowser);

    // 3) Browser-only enforcement + approval interception at the verified boundary.
    //
    // SECURITY: upstream AgentTARS registers filesystem + shell (`run_command`)
    // MCP tools alongside the browser tools with no browser-only switch. This MVP
    // is browser-only (no shell/filesystem/MCP), so ANY non-`browser_*` tool is
    // out of scope and is hard-denied here by aborting the run — the pre-execution
    // abort check then prevents the tool from running. This guarantees the runtime
    // controls only the isolated browser, never the user's machine.
    const originalHook = agent.onBeforeToolCall?.bind(agent);
    agent.onBeforeToolCall = async (sessionId: string, toolCall: { toolCallId: string; name: string }, args: any) => {
      const name = toolCall?.name ?? "";
      // Ensure the submission gate is attached before any browser action runs.
      if (name.startsWith("browser_")) tryAttach();
      if (!name.startsWith("browser_")) {
        host.status(`Blocked out-of-scope tool (browser-only): ${redact(name)}`);
        host.actionFailed({ actionId: toolCall?.toolCallId ?? name, error: "out_of_scope_tool" });
        try { agent.abort?.(); } catch { /* ignore */ }
        return args;
      }
      if (originalHook) {
        try {
          args = await originalHook(sessionId, toolCall, args);
        } catch {
          /* keep args */
        }
      }
      args = await enrichClickIntent(attached, toolCall.name, args);
      const action = classifyToolCall(toolCall.name, args);
      const ok = await host.requestApproval(action);
      if (!ok) {
        // Rejection/stop: the host has tripped abort; ensure the agent stops so
        // the pre-execution abort check prevents this tool from running.
        try { agent.abort?.(); } catch { /* ignore */ }
      }
      return args;
    };

    // 4) Normalize the event stream into host observations.
    const unsubscribe = this.wireEvents(agent, host, redact, captureScreenshot);

    // 5) Abort wiring.
    const onAbort = () => {
      try { agent.abort?.(); } catch { /* ignore */ }
    };
    host.signal.addEventListener("abort", onAbort, { once: true });

    // 6) Run.
    let outcome: RunOutcome;
    const thinkingStartedAt = Date.now();
    host.thinking?.({ state: "started", summary: "Analyzing the task" });
    try {
      const result = await agent.run(params.task);
      if (host.signal.aborted) outcome = { status: "aborted" };
      else outcome = normalizeAgentResult(result, redact);
    } catch (err) {
      outcome = host.signal.aborted
        ? { status: "aborted" }
        : { status: "failed", failure: { code: "agent_error", message: "Agent run failed" } };
    } finally {
      host.thinking?.({
        state: "completed",
        summary: host.signal.aborted ? "Browser task stopped" : "Browser analysis complete",
        durationMs: Date.now() - thinkingStartedAt,
      });
      host.signal.removeEventListener("abort", onAbort);
      stopped = true;
      if (shotTimer) clearInterval(shotTimer);
      tryAttach();
      await captureScreenshot("Final browser state");
      await attachTask;
      detachGate();
      unsubscribe();
      await closeBrowser.close();
      this.activeBrowsers.delete(closeBrowser);
    }
    return outcome;
  }

  private wireEvents(
    agent: any,
    host: RuntimeHost,
    redact: (l: string) => string,
    captureScreenshot: (caption?: string) => Promise<void>,
  ): () => void {
    const stream = agent.getEventStream?.();
    if (!stream || typeof stream.subscribe !== "function") return () => {};
    let streamingThought = false;
    return stream.subscribe((event: any) => {
      try {
        switch (event?.type) {
          case "assistant_streaming_thinking_message":
            if (!streamingThought) {
              streamingThought = true;
              host.thinking?.({ state: "active", summary: "Analyzing the current browser state" });
            }
            break;
          case "assistant_thinking_message":
            streamingThought = false;
            host.thinking?.({
              state: "active",
              summary: "Analysis step complete",
              ...(Number.isFinite(event.thinkingDurationMs)
                ? { durationMs: Math.max(0, Math.trunc(event.thinkingDurationMs)) }
                : {}),
            });
            break;
          case "assistant_message":
            if (event.content) host.status(redact(String(event.content)).slice(0, 500));
            break;
          case "tool_call":
            host.thinking?.({
              state: "active",
              summary: `Preparing ${redact(String(event.name ?? "browser action")).replaceAll("_", " ")}`,
            });
            host.actionStarted({
              actionId: String(event.toolCallId ?? ""),
              action: "click",
              target: redact(String(event.name ?? "")),
            });
            break;
          case "tool_result": {
            const name = String(event.name ?? "");
            if (name === "browser_navigate") {
              const url = event?._extra?.currentUrl ?? event?.content?.url;
              host.page({ url: url ? redact(String(url)) : undefined });
            }
            if (name === "browser_screenshot") {
              void captureScreenshot("Browser screenshot");
            }
            host.actionCompleted({ actionId: String(event.toolCallId ?? "") });
            break;
          }
          case "environment_input": {
            void captureScreenshot();
            break;
          }
          default:
            break;
        }
      } catch {
        /* a bad event never breaks the run */
      }
    });
  }

  async shutdown(): Promise<void> {
    for (const agent of [...this.activeDesktopAgents]) agent.stop();
    this.activeDesktopAgents.clear();
    for (const b of [...this.activeBrowsers]) await b.close();
    this.activeBrowsers.clear();
  }
}
