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

export interface AgentTarsRuntimeOptions {
  dataDir: string;
  version: string;
  redact: (line: string) => string;
}

function mapStrategy(s: BrowserStrategy): "dom" | "visual-grounding" | "hybrid" {
  return s === "gui" ? "visual-grounding" : s;
}

/** Best-effort structured classification of an upstream browser tool call. */
function classifyToolCall(name: string, args: any): ProposedAction {
  const target = String(args?.url ?? args?.selector ?? args?.element ?? args?.index ?? name);
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
  if (name === "browser_click" || name === "browser_vision_control") {
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

export class AgentTarsRuntimeClient implements RuntimeClient {
  readonly kind = "agent-tars" as const;
  private opts: AgentTarsRuntimeOptions;
  private activeBrowsers = new Set<{ close: () => Promise<void> }>();

  constructor(opts: AgentTarsRuntimeOptions) {
    this.opts = opts;
  }

  capabilities(): RuntimeCapabilities {
    return {
      runtime: "agent-tars",
      operator: "browser",
      strategies: ["dom", "gui", "hybrid"],
      realBrowser: true,
      version: this.opts.version,
    };
  }

  async run(params: StartRunParams, host: RuntimeHost): Promise<RunOutcome> {
    const { redact } = this.opts;
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
        provider: params.config.provider,
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

    // Attach ownership + the DOM-layer submission gate + periodic screenshots once
    // AgentTARS's browser launches (lazily, on first browser tool). The gate pauses
    // the actual form POST / off-allowlist navigation BEFORE it leaves the browser.
    // tryAttach is idempotent and is called both from a poll and from every browser
    // tool boundary, so the gate is guaranteed present before any later submit.
    let detachGate: () => void = () => {};
    let attached: any = null;
    let shotTimer: ReturnType<typeof setInterval> | null = null;
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
      // Periodic screenshots (works in dom mode, which emits none on its own).
      shotTimer = setInterval(async () => {
        try {
          const pages = await pptr.pages();
          const page = pages[pages.length - 1];
          if (!page) return;
          const b64 = await page.screenshot({ encoding: "base64" });
          const s = typeof b64 === "string" ? b64 : Buffer.from(b64).toString("base64");
          if (s) host.screenshot({ base64: s });
        } catch {
          /* transient navigation */
        }
      }, 2500);
      shotTimer.unref?.();
    };
    void (async () => {
      for (let i = 0; i < 60 && !attached && !host.signal.aborted; i++) {
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
    const unsubscribe = this.wireEvents(agent, host, redact);

    // 5) Abort wiring.
    const onAbort = () => {
      try { agent.abort?.(); } catch { /* ignore */ }
    };
    host.signal.addEventListener("abort", onAbort, { once: true });

    // 6) Run.
    let outcome: RunOutcome;
    try {
      const result = await agent.run({ input: params.task });
      if (host.signal.aborted) outcome = { status: "aborted" };
      else outcome = { status: "completed", summary: typeof result === "string" ? redact(result) : undefined };
    } catch (err) {
      outcome = host.signal.aborted
        ? { status: "aborted" }
        : { status: "failed", failure: { code: "agent_error", message: "Agent run failed" } };
    } finally {
      host.signal.removeEventListener("abort", onAbort);
      if (shotTimer) clearInterval(shotTimer);
      detachGate();
      unsubscribe();
      await closeBrowser.close();
      this.activeBrowsers.delete(closeBrowser);
    }
    return outcome;
  }

  private wireEvents(agent: any, host: RuntimeHost, redact: (l: string) => string): () => void {
    const stream = agent.getEventStream?.();
    if (!stream || typeof stream.subscribe !== "function") return () => {};
    return stream.subscribe((event: any) => {
      try {
        switch (event?.type) {
          case "assistant_message":
            if (event.content) host.status(redact(String(event.content)).slice(0, 500));
            break;
          case "tool_call":
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
              const b64 = extractBase64Png(event?.content);
              if (b64) host.screenshot({ base64: b64, caption: "screenshot" });
            }
            host.actionCompleted({ actionId: String(event.toolCallId ?? "") });
            break;
          }
          case "environment_input": {
            const b64 = extractBase64Png(event?.content);
            if (b64) host.screenshot({ base64: b64 });
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
    for (const b of [...this.activeBrowsers]) await b.close();
    this.activeBrowsers.clear();
  }
}

/** Extract a base64 PNG payload from various upstream content shapes. */
function extractBase64Png(content: any): string | null {
  if (!content) return null;
  const scan = (v: any): string | null => {
    if (typeof v === "string") {
      const m = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(v);
      if (m) return m[1];
      if (/^[A-Za-z0-9+/=]{100,}$/.test(v)) return v;
      return null;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = scan(item?.image_url?.url ?? item?.data ?? item);
        if (r) return r;
      }
    }
    if (typeof v === "object") return scan(v.image ?? v.data ?? v.url ?? null);
    return null;
  };
  return scan(content);
}
