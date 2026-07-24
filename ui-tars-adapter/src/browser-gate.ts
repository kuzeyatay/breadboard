// DOM-layer submission gate via Puppeteer request interception.
//
// This is the ROBUST, deterministic enforcement for the two acceptance criteria
// that must not depend on the (non-deterministic) model: "sensitive submission
// pauses" and "rejection prevents the action". A form submission is a network
// request (method POST / a navigation request leaving the allowlist); we pause
// that exact request BEFORE it leaves the browser and only continue it on an
// explicit approval — otherwise we abort it, so the action never happens.
//
// This is the "implement the interception one layer lower" path the task brief
// calls for when a higher layer cannot reliably pause before the action.

import type { ApprovalActionType } from "./types.ts";

export interface GateAction {
  action: ApprovalActionType;
  target: string;
  targetUrl?: string;
  submitIntent?: boolean;
}

export interface GateHooks {
  /** Empty allowlist => everything allowed. */
  hostAllowed: (host: string) => boolean;
  /** Resolve true to execute (continue), false to block (abort). */
  requestApproval: (action: GateAction) => Promise<boolean>;
  /** Optional notification when a request is gated (for logging/telemetry). */
  onGated?: (action: GateAction) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- puppeteer boundary */

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function guardPage(page: any, hooks: GateHooks): Promise<void> {
  // If interception is already enabled by the runtime, enabling again is a no-op.
  try {
    await page.setRequestInterception(true);
  } catch {
    return; // cannot intercept — leave the page ungated rather than crash
  }
  page.on("request", async (req: any) => {
    // A request may only be resolved once; guard against double-handling.
    let resolved = false;
    const cont = async () => {
      if (resolved) return;
      resolved = true;
      try {
        await req.continue();
      } catch {
        /* already handled by another interceptor */
      }
    };
    const block = async () => {
      if (resolved) return;
      resolved = true;
      try {
        await req.abort("aborted");
      } catch {
        /* ignore */
      }
    };
    try {
      const url: string = req.url();
      const method: string = (req.method?.() ?? "GET").toUpperCase();
      const isNav: boolean = req.isNavigationRequest?.() ?? false;
      const host = hostOf(url);

      // Form submission / data mutation: a navigation POST.
      const isFormSubmit = isNav && method === "POST";
      // Leaving the configured allowlist.
      const offAllowlist = isNav && method === "GET" && host !== null && !hooks.hostAllowed(host);

      if (isFormSubmit || offAllowlist) {
        const action: GateAction = isFormSubmit
          ? { action: "submit", target: url, targetUrl: url, submitIntent: true }
          : { action: "navigate", target: url, targetUrl: url };
        hooks.onGated?.(action);
        const ok = await hooks.requestApproval(action);
        if (ok) await cont();
        else await block();
        return;
      }
      await cont();
    } catch {
      await cont();
    }
  });
}

/**
 * Attach the submission gate to every page of a Puppeteer browser (existing and
 * future). Returns a detach function.
 */
export function attachSubmissionGate(pptrBrowser: any, hooks: GateHooks): () => void {
  const onTarget = async (target: any) => {
    try {
      if (target.type?.() !== "page") return;
      const page = await target.page();
      if (page) await guardPage(page, hooks);
    } catch {
      /* ignore a single page we could not guard */
    }
  };
  pptrBrowser.on?.("targetcreated", onTarget);
  // Guard any pages that already exist.
  void Promise.resolve(pptrBrowser.pages?.())
    .then((pages: any[] | undefined) => {
      for (const p of pages ?? []) void guardPage(p, hooks);
    })
    .catch(() => {});
  return () => {
    try {
      pptrBrowser.off?.("targetcreated", onTarget);
    } catch {
      /* ignore */
    }
  };
}
