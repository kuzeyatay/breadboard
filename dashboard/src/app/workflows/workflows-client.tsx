"use client";

// Native workflow canvas entry point, replacing the n8n iframe client. Two
// views behind one route (mirrors the old file's shape, which kept `/workflows`
// working as a single entry and used the `workflow` query param to select a
// workflow — use-workflow-automation.ts's "Open automation settings" links
// hardcode that same param, so it stays the identifier here):
//  - no `workflow` param: the workflows HOME list (create/open/delete).
//  - `?workflow=<id>`: the CANVAS view for that workflow.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import BreadboardLoader from "@/app/components/breadboard-loader";
import { backLabelFor } from "@/lib/nav-history";
import { readTeachSetupDraft } from "@/lib/teach/setup-draft";
import { consumeWorkflowReturnPath, peekWorkflowReturnPath } from "@/lib/workflows/navigation";
import { CanvasEditor } from "./components/canvas-editor";
import { WorkflowSourceIcon } from "./components/workflow-source-icon";
import DemonstratedWorkflow from "./teach/demonstrated-workflow";
import TeachWorkflow from "./teach/teach-workflow";
import { loadTeachAvailability, type TeachAvailabilityView } from "./teach/teach-client";
import "./sim-canvas.css";
import type { WorkflowStateJson } from "./lib/types";

const BACK_FALLBACK_LABEL = "Back to dashboard";

type WorkflowListItem = {
  id: string;
  name: string;
  description?: string | null;
  blockCount?: number;
  nodeCount?: number;
  stepCount?: number;
  /** How it was authored. Older rows have no column and read as "canvas". */
  source?: "canvas" | "demonstration";
  updatedAt: string | null;
};

type WorkflowDetail = {
  id: string;
  name: string;
  description?: string | null;
  state: WorkflowStateJson | null;
  source?: "canvas" | "demonstration";
};

function BackIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TeachIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v9m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <path strokeLinecap="round" d="M5 8a7 7 0 0 1 14 0" />
    </svg>
  );
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type ProposalItem = {
  id: string;
  name: string;
  description: string;
  rationale: string;
  evidence: string[];
  blockCount: number;
  createdAt: string;
};

/**
 * Automations the agent has offered, waiting for an answer.
 *
 * The section only exists when there is something to answer, so the page is
 * unchanged for anyone the agent has never offered anything. Each card leads
 * with the evidence rather than the pitch: what you actually did, in your own
 * words, is the thing worth judging the offer on.
 */
function ProposalsSection({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workflows/proposals", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          proposals?: ProposalItem[];
        };
        setItems(payload.proposals ?? []);
      })
      .catch(() => {
        // A page that cannot load offers is a page with no offers on it. There
        // is nothing for the user to do about it, so there is nothing to say.
      });
    return () => controller.abort();
  }, []);

  async function decide(id: string, action: "accept" | "decline") {
    if (busy) return;
    setBusy(id);
    try {
      const response = await fetch("/api/workflows/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { workflowId?: string };
      setItems((current) => current.filter((item) => item.id !== id));
      if (action === "accept" && payload.workflowId) onOpen(payload.workflowId);
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        Offered by the agent
      </h3>
      {items.map((proposal) => (
        <div
          key={proposal.id}
          className="neu-inset rounded-2xl border border-[var(--line)] p-4"
        >
          <p className="text-sm font-medium text-[var(--ink-heading)]">{proposal.name}</p>
          {proposal.description ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{proposal.description}</p>
          ) : null}
          {proposal.rationale ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-body)]">{proposal.rationale}</p>
          ) : null}
          {proposal.evidence.length > 0 ? (
            <ul className="mt-2 space-y-1 border-l border-[var(--line)] pl-3">
              {proposal.evidence.map((line, index) => (
                <li key={index} className="text-[11px] leading-5 text-[var(--ink-muted)]">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => decide(proposal.id, "accept")}
              disabled={busy === proposal.id}
              className="neu-button-primary rounded-xl border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              Build it
            </button>
            <button
              type="button"
              onClick={() => decide(proposal.id, "decline")}
              disabled={busy === proposal.id}
              className="neu-button rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              No thanks
            </button>
            <span className="text-[11px] text-[var(--ink-muted)]">
              {proposal.blockCount > 0
                ? `${proposal.blockCount} blocks drafted — nothing runs until you accept`
                : "Nothing runs until you accept"}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function HomeView({
  onOpen,
  onTeach,
  teachAvailability,
}: {
  onOpen: (id: string) => void;
  onTeach: () => void;
  teachAvailability: TeachAvailabilityView | null;
}) {
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/workflows/local", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { workflows?: WorkflowListItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Your workflows could not be loaded.");
        setItems(payload.workflows ?? []);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Your workflows could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  async function createWorkflow() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/workflows/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled workflow" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "The workflow could not be created.");
      onOpen(payload.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not be created.");
      setCreating(false);
    }
  }

  async function deleteWorkflow(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      const response = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
    } catch {
      setReloadToken((token) => token + 1);
    }
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="neu-surface-subtle flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
        <div>
          <h2 className="font-semibold text-[var(--ink-heading)]">Your workflows</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Build an automation on the canvas, or show Breadboard the task once and let it
            work the workflow out. Either way you run it from here or from chat.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onTeach}
            disabled={teachAvailability !== null && !teachAvailability.available}
            title={
              teachAvailability && !teachAvailability.available
                ? teachAvailability.reason
                : "Show Breadboard the task once, out loud, and it builds the workflow"
            }
            className="neu-button inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TeachIcon /> Teach Workflow
          </button>
          <button
            type="button"
            onClick={createWorkflow}
            disabled={creating}
            className="neu-button-primary inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlusIcon /> New workflow
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {error}
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className="ml-2 underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : null}

      <ProposalsSection onOpen={onOpen} />

      {loading ? <div className="py-8 text-center text-xs text-[var(--ink-muted)]">Loading your workflows…</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="neu-inset rounded-2xl border border-[var(--line)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--ink-heading)]">No workflows yet</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Create one to start building an automation on the canvas.</p>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="space-y-2">
          {items.map((workflow) => (
            <div key={workflow.id} className="neu-button flex items-center gap-3 rounded-2xl border border-[var(--line)] p-3">
              <button
                type="button"
                onClick={() => onOpen(workflow.id)}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]">
                  <WorkflowSourceIcon source={workflow.source} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--ink-heading)] group-hover:text-[var(--botanical)]">
                    {workflow.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                    {workflow.source === "demonstration"
                      ? `${workflow.stepCount ?? 0} steps · Learned from demonstration`
                      : typeof (workflow.blockCount ?? workflow.nodeCount) === "number"
                        ? `${workflow.blockCount ?? workflow.nodeCount} blocks`
                        : ""}
                    {workflow.updatedAt ? ` · Updated ${formatUpdatedAt(workflow.updatedAt)}` : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteWorkflow(workflow.id)}
                aria-label={`Delete ${workflow.name}`}
                className="neu-button-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}

export default function WorkflowsClient({
  workflowId,
  clapReview = false,
  teachOnOpen = false,
  initialRunId = null,
  showNavbarFlowers,
}: {
  workflowId: string | null;
  clapReview?: boolean;
  teachOnOpen?: boolean;
  initialRunId?: string | null;
  showNavbarFlowers: boolean;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(workflowId);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [backLabel, setBackLabel] = useState(BACK_FALLBACK_LABEL);
  const [openedFromChat] = useState(() => Boolean(workflowId));
  // Non-null while the teaching flow is open. A re-teach carries the workflow it
  // is correcting, so the second demonstration becomes a version of that
  // workflow rather than a new one beside it.
  const [teaching, setTeaching] = useState<{ workflowId: string | null; name?: string } | null>(
    teachOnOpen ? { workflowId: null } : null,
  );
  const [teachAvailability, setTeachAvailability] = useState<TeachAvailabilityView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadTeachAvailability(controller.signal)
      .then(setTeachAvailability)
      .catch(() => {
        // A page that cannot check leaves the button enabled; starting a session
        // reports the real reason, and it is the same reason.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const returnPath = peekWorkflowReturnPath();
    setBackLabel(returnPath ? backLabelFor(returnPath, BACK_FALLBACK_LABEL) : BACK_FALLBACK_LABEL);
  }, []);

  useEffect(() => {
    setActiveId(workflowId);
  }, [workflowId]);

  useEffect(() => {
    if (teachOnOpen && !workflowId) setTeaching({ workflowId: null });
  }, [teachOnOpen, workflowId]);

  useEffect(() => {
    // A setup draft belongs to the workflows home, not to a workflow explicitly
    // opened from chat. Returning to the home restores the panel that held it.
    if (teachOnOpen || workflowId) return;
    const draft = readTeachSetupDraft(window.localStorage);
    if (!draft) return;
    setTeaching((current) =>
      current ?? { workflowId: draft.reteachWorkflowId, name: draft.reteachName },
    );
  }, [teachOnOpen, workflowId]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    fetch(`/api/workflows/${encodeURIComponent(activeId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<WorkflowDetail> & { error?: string };
        if (!response.ok || !payload.id) throw new Error(payload.error || "This workflow could not be opened.");
        setDetail({
          id: payload.id,
          name: payload.name ?? "Untitled workflow",
          description: payload.description ?? "",
          state: payload.state ?? null,
          source: payload.source ?? "canvas",
        });
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setDetailError(cause instanceof Error ? cause.message : "This workflow could not be opened.");
      });
    return () => controller.abort();
  }, [activeId]);

  const openWorkflow = useCallback(
    (id: string) => {
      setActiveId(id);
      router.replace(`/workflows?workflow=${encodeURIComponent(id)}`, { scroll: false });
    },
    [router],
  );

  const goHome = useCallback(() => {
    setActiveId(null);
    setDetail(null);
    setDetailError(null);
    router.replace("/workflows", { scroll: false });
  }, [router]);

  function leaveWorkflows() {
    const returnPath = consumeWorkflowReturnPath();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    router.replace(returnPath ?? "/dashboard", { scroll: false });
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--paper-bg)] text-[var(--ink)]">
      <header className="bb-neu-toolbar breadboard-flower-navbar neu-surface-subtle relative flex shrink-0 items-center justify-between gap-4 border-b border-gray-800 px-6 py-3.5">
        <NavbarFlowerWind showFlowers={showNavbarFlowers} />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={activeId && !openedFromChat ? goHome : leaveWorkflows}
            className="flex shrink-0 items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-white"
          >
            <BackIcon />
            {activeId && !openedFromChat ? "All workflows" : backLabel}
          </button>
          <span className="text-gray-700">/</span>
          <h1 className="truncate text-sm font-semibold text-white">Workflows</h1>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {clapReview && activeId && <p role="status" className="border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3 text-sm text-[var(--ink)]">Clap controls selected this workflow. Review its steps and required inputs, then press Run to confirm. Nothing has run yet.</p>}
        {teaching ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            <TeachWorkflow
              reteachWorkflowId={teaching.workflowId}
              reteachName={teaching.name}
              onSaved={(savedId) => {
                setTeaching(null);
                openWorkflow(savedId);
              }}
              onClose={() => {
                setTeaching(null);
                if (!activeId) goHome();
              }}
            />
          </div>
        ) : !activeId ? (
          <HomeView
            onOpen={openWorkflow}
            onTeach={() => setTeaching({ workflowId: null })}
            teachAvailability={teachAvailability}
          />
        ) : detailError ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="neu-inset w-full max-w-md rounded-3xl border border-[var(--line)] p-7 text-center">
              <h2 className="text-base font-semibold text-[var(--ink-heading)]">This workflow did not open</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">{detailError}</p>
              <button type="button" onClick={goHome} className="neu-button-accent mt-5 rounded-xl border px-4 py-2.5 text-sm font-medium">
                Back to workflows
              </button>
            </div>
          </div>
        ) : detail && detail.id === activeId ? (
          detail.source === "demonstration" ? (
            <DemonstratedWorkflow
              workflowId={detail.id}
              initialRunId={initialRunId}
              onBack={goHome}
              onReteach={() => setTeaching({ workflowId: detail.id, name: detail.name })}
              onDelete={async () => {
                await fetch(`/api/workflows/${encodeURIComponent(detail.id)}`, { method: "DELETE" }).catch(
                  () => undefined,
                );
                goHome();
              }}
            />
          ) : (
            <CanvasEditor
              workflowId={detail.id}
              initialName={detail.name}
              initialDescription={detail.description ?? ""}
              initialState={detail.state}
              onBack={goHome}
            />
          )
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <BreadboardLoader className="h-5 w-5 text-[var(--botanical)]" />
          </div>
        )}
      </div>
    </div>
  );
}
