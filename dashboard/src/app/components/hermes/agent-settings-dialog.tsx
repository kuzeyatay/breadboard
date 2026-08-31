"use client";

// One agent's settings, in the same panel every other agent's settings open in.
//
// This is the shell for the agents that had no dialog of their own. The ones
// that already had one — Agent Reach's channels, the Socials Manager's accounts,
// TradingAgents' environment — render the same defaults form inside their own
// panel instead, so no agent ever grows a second settings button.

import dynamic from "next/dynamic";
import { useEffect } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";

// Several agents here also have setup only the user can authorize — Career Ops
// needs dependencies, browsers and a CV to work from; Deep Tutor and DeerFlow
// each need a Python environment built — so their panels carry that above the
// defaults.
const CareerOpsSetup = dynamic(() => import("@/app/components/agents/career-ops-setup"), {
  ssr: false,
});
const OpenExecutiveSetup = dynamic(
  () => import("@/app/components/agents/openexecutive-setup"),
  { ssr: false },
);
const DeepTutorSetup = dynamic(() => import("@/app/components/agents/deep-tutor-setup"), {
  ssr: false,
});
const DeerFlowSetup = dynamic(() => import("@/app/components/agents/deer-flow-setup"), {
  ssr: false,
});
// Shorts is a third: its clone needs a Python environment before a video can be
// cut, and there is nothing to gain from finding that out mid-run.
const ShortsSetup = dynamic(() => import("@/app/components/agents/shorts-setup"), {
  ssr: false,
});
// MoneyPrinter needs both: a Python environment, and a stock-footage key without
// which a run can only cut from files already on disk.
const MoneyPrinterSetup = dynamic(
  () => import("@/app/components/agents/money-printer-setup"),
  { ssr: false },
);
// Video Use needs no environment built — its renderer is Python standard
// library — but it does have one optional key, and which half of the editing
// vocabulary is available depends on whether it is set.
const VideoUseSetup = dynamic(() => import("@/app/components/agents/video-use-setup"), {
  ssr: false,
});
// Stock Analyst needs a Python environment built before it can answer anything,
// and its optional data keys are the difference between a run that gets rate
// limited by a free scraper and one that does not.
const StockAnalystSetup = dynamic(() => import("@/app/components/agents/stock-analyst-setup"), {
  ssr: false,
});

export default function AgentSettingsDialog({
  agentId,
  gardenSlug,
  onClose,
}: {
  agentId: string;
  /** The Garden the dialog was opened from, when it was opened from one. */
  gardenSlug?: string | null;
  onClose: () => void;
}) {
  const agent = findConfigurableAgent(agentId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!agent) return null;

  return (
    <div
      // bb-modal-backdrop / bb-modal-panel are the shared modal surfaces; they
      // carry the panel background and the dark-theme overrides.
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(48rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path strokeLinecap="round" d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <h2 id="agent-settings-title" className="font-serif text-lg text-[var(--ink-heading)]">
              {agent.name} settings
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              How <span className="font-mono">{agent.command}</span> runs when a message does not say
              otherwise.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label={`Close ${agent.name} settings`}
          >
            <svg aria-hidden className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {agent.id === "career-ops" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Workspace
              </h3>
              <CareerOpsSetup />
            </section>
          ) : null}

          {agent.id === "openexecutive" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Runtime
              </h3>
              <OpenExecutiveSetup />
            </section>
          ) : null}

          {agent.id === "deep-tutor" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Environment and material
              </h3>
              <DeepTutorSetup gardenSlug={gardenSlug} />
            </section>
          ) : null}

          {agent.id === "deer-flow" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Environment
              </h3>
              <DeerFlowSetup />
            </section>
          ) : null}

          {agent.id === "shorts" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Environment
              </h3>
              <ShortsSetup />
            </section>
          ) : null}

          {agent.id === "money-printer" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Environment and footage
              </h3>
              <MoneyPrinterSetup />
            </section>
          ) : null}

          {agent.id === "stock-analyst" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Environment and market data
              </h3>
              <StockAnalystSetup />
            </section>
          ) : null}

          {agent.id === "video-use" ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Toolchain and speech
              </h3>
              <VideoUseSetup />
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Defaults
            </h3>
            <AgentRunDefaults agentId={agent.id} />
          </section>
        </div>
      </section>
    </div>
  );
}
