"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { backLabelFor } from "@/lib/nav-history";
import { consumeWorkflowReturnPath, peekWorkflowReturnPath } from "@/lib/workflows/navigation";

type Startup = { phase?: string; message?: string; updatedAt?: string } | null;
type StatusResponse = { ready?: boolean; baseUrl?: string | null; startup?: Startup; error?: string };

const BACK_FALLBACK_LABEL = "Back to dashboard";

function BackIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function Loader() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--botanical)]" />;
}

function friendlyPhase(startup: Startup): string {
  if (startup?.message && startup.phase !== "ready" && startup.phase !== "stopped") {
    return startup.message;
  }
  switch (startup?.phase) {
    case "installing": return "Installing n8n for its first use. This can take several minutes.";
    case "building": return "Building the local workflow editor for its first use.";
    case "starting": return "Starting your private workflow workspace.";
    case "error": return "n8n could not finish starting.";
    default: return "Preparing your private workflow workspace.";
  }
}

export default function WorkflowsClient({
  mode,
  templateId,
  workflowId,
}: {
  mode: "new" | "home";
  templateId: number | null;
  workflowId: string | null;
}) {
  const router = useRouter();
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [startup, setStartup] = useState<Startup>(null);
  const [stage, setStage] = useState<"preparing" | "ready" | "error">("preparing");
  const [error, setError] = useState<string | null>(null);
  // The stored return path only exists in the browser, so the label starts at
  // the fallback and is corrected once the client has mounted.
  const [backLabel, setBackLabel] = useState(BACK_FALLBACK_LABEL);
  const opening = useRef(false);

  useEffect(() => {
    const returnPath = peekWorkflowReturnPath();
    setBackLabel(returnPath ? backLabelFor(returnPath, BACK_FALLBACK_LABEL) : BACK_FALLBACK_LABEL);
  }, []);

  const openWorkspace = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      setError(null);
      const sessionResponse = await fetch("/api/workflows/session", { method: "POST" });
      const session = await sessionResponse.json() as { baseUrl?: string; error?: string };
      if (!sessionResponse.ok || !session.baseUrl) throw new Error(session.error || "Could not open n8n.");
      setBaseUrl(session.baseUrl);

      const target = templateId
        ? `/templates/${encodeURIComponent(templateId)}`
        : workflowId
          ? `/workflow/${encodeURIComponent(workflowId)}`
          : mode === "new"
            ? "/workflow/new"
            : "/home/workflows";
      setFrameUrl(`${session.baseUrl}${target}`);
      setStage("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the workflow workspace.");
      setStage("error");
      opening.current = false;
    }
  }, [mode, templateId, workflowId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const response = await fetch("/api/workflows/status", { cache: "no-store" });
        const payload = await response.json() as StatusResponse;
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || "Could not check n8n.");
        setStartup(payload.startup ?? null);
        if (payload.ready) {
          await openWorkspace();
          return;
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not check n8n.");
      }
      if (!cancelled) timer = window.setTimeout(poll, 2_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [openWorkspace]);

  function retry() {
    opening.current = false;
    setStage("preparing");
    setError(null);
    void openWorkspace();
  }

  function leaveWorkflows() {
    const returnPath = consumeWorkflowReturnPath();

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setFrameUrl(null);
    // n8n's iframe contributes entries to the browser's joint history, so a
    // generic Back can be consumed by the embedded editor. Navigate directly
    // to the exact Breadboard route that opened Workflows instead.
    router.replace(returnPath ?? "/dashboard", { scroll: false });
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--paper-bg)] text-[var(--ink)]">
      {/* One navbar, the same shape Garden Chat and Quartz use: back control,
          then where you are. n8n's own editor carries the workflow actions. */}
      <header className="bb-neu-toolbar breadboard-flower-navbar neu-surface-subtle relative flex shrink-0 items-center justify-between gap-4 border-b border-gray-800 px-6 py-3.5">
        <NavbarFlowerWind />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={leaveWorkflows}
            className="flex shrink-0 items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-white"
          >
            <BackIcon />
            {backLabel}
          </button>
          <span className="text-gray-700">/</span>
          <h1 className="truncate text-sm font-semibold text-white">Workflows</h1>
        </div>
        <div className="relative z-10 flex items-center gap-2">
          {/* `--amber` was never a Breadboard token, so the starting dot used to
              render with no fill at all. */}
          <span className="bb-agent-run-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] text-[var(--ink-muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${stage === "ready" ? "bg-[var(--botanical)]" : stage === "error" ? "bg-[var(--danger)]" : "animate-pulse bg-[var(--selection-yellow-line)]"}`} />
            {stage === "ready" ? "Local n8n ready" : stage === "error" ? "Needs attention" : "Starting locally"}
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-3 sm:px-5">
        <section className="neu-surface-raised relative min-h-0 flex-1 overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-raised)]">
          {frameUrl ? (
            <iframe
              src={frameUrl}
              title="Breadboard workflow editor"
              className="h-full w-full border-0 bg-[var(--paper-raised)]"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="flex h-full min-h-96 items-center justify-center p-6">
              <div className="neu-inset w-full max-w-lg rounded-3xl border border-[var(--line)] p-7 text-center">
                {stage !== "error" ? <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--paper-raised)] text-[var(--botanical)]"><Loader /></span> : null}
                <h2 className="mt-4 text-base font-semibold text-[var(--ink-heading)]">
                  {stage === "error" ? "The workflow workspace did not open" : "Preparing workflows"}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
                  {error || friendlyPhase(startup)}
                </p>
                {stage === "error" ? <button type="button" onClick={retry} className="neu-button-accent mt-5 rounded-xl border px-4 py-2.5 text-sm font-medium">Try again</button> : null}
              </div>
            </div>
          )}
        </section>
        {baseUrl ? <p className="sr-only">Local workflow service: {baseUrl}</p> : null}
      </main>
    </div>
  );
}
