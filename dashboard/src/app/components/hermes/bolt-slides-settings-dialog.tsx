"use client";

// Bolt Slides' one settings surface: whether the deck kit can build anything,
// and the run defaults underneath it.
//
// There is a single thing to prepare — the clone's npm dependencies — and the
// button that does it lives here rather than anywhere a run could reach. A deck
// run that installed its own dependencies would be a network install started by
// a sentence in a chat.
//
// The component count is shown because it is the honest answer to "what can it
// build with": the authoring prompt is read from the checkout's own source, so
// that number is exactly how many layouts the deck author has to compose with.

import { useCallback, useEffect, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { BOLT_SLIDES_AGENT_ID } from "@/lib/bolt-slides/identity.ts";

interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; missing: string[] };
  kit: { components: number; tokens: number };
}

export default function BoltSlidesSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bolt-slides/setup", { cache: "no-store" });
      const data = (await response.json()) as { status?: SetupStatus; error?: string };
      if (data.status) setStatus(data.status);
      else setNotice(data.error || "Setup could not be checked.");
    } catch {
      setNotice("Setup could not be checked.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    setBusy(true);
    setNotice("Installing the deck kit's dependencies. This takes a minute or two the first time.");
    try {
      const response = await fetch("/api/bolt-slides/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "install-dependencies" }),
      });
      const data = (await response.json()) as {
        status?: SetupStatus;
        message?: string;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "Setup finished.");
    } catch {
      setNotice("The install could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="bolt-slides-title"
        className="bb-modal-panel neu-dialog max-h-[85vh] w-full max-w-[42rem] overflow-y-auto rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-3 border-b border-[var(--line)] p-5">
          <div className="min-w-0 flex-1">
            <h2 id="bolt-slides-title" className="font-serif text-lg text-[var(--ink-heading)]">
              Bolt Slides setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Builds a presentation as a running web app — every slide a live, responsive page with
              click-builds, annotation, and a presenter view. Decks are written by your configured
              model and compiled here.
            </p>
          </div>
          <button
            type="button"
            className="neu-button-icon h-9 w-9 rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${status?.ready ? "bg-[var(--botanical)]" : "bg-amber-500"}`}
            />
            <span className="text-sm">
              {status?.ready
                ? `Ready · ${status.kit.components} components, ${status.kit.tokens} theme tokens`
                : "Setup needed"}
            </span>
            <button
              type="button"
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs"
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
          {notice || status?.reason ? (
            <p className="text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice || status?.reason}
            </p>
          ) : null}
          <div className="bb-agent-run-panel space-y-1 p-3 text-xs leading-5 text-[var(--ink-muted)]">
            <p>
              <strong className="text-[var(--ink-heading)]">Clone:</strong>{" "}
              {status?.clone.found ? status.clone.path : "not found"}
            </p>
            <p>
              <strong className="text-[var(--ink-heading)]">Dependencies:</strong>{" "}
              {status?.dependencies.installed
                ? "installed"
                : status?.dependencies.missing.length
                  ? `missing ${status.dependencies.missing.join(", ")}`
                  : "not installed"}
            </p>
          </div>
          {status?.ready ? null : (
            <button
              type="button"
              disabled={busy || !status?.clone.found}
              className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50"
              onClick={() => void install()}
            >
              Install the deck kit&apos;s dependencies
            </button>
          )}
          <AgentRunDefaults agentId={BOLT_SLIDES_AGENT_ID} />
        </div>
      </section>
    </div>
  );
}
