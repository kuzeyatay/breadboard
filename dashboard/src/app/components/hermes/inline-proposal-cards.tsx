"use client";

// Fetch once per conversation, then render each proposal inside the assistant
// message that created it. Virtualized rows share review state through the
// provider, so cards and errors stay with their turn when rows remount.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { GARDEN_DOCUMENTS_CHANGED_EVENT } from "@/lib/garden-document-events";
import ChatMarkdown from "../chat-markdown";

/** Fired after a proposal is applied or rejected, so other reviewers refresh. */
export const GARDEN_PROPOSALS_CHANGED_EVENT = "breadboard:garden-proposals-changed";

export interface PendingProposal {
  id: number;
  assistantMessageId: string | null;
  kind: "note" | "page_revision" | "visualization";
  gardenId: string;
  gardenName: string;
  title: string | null;
  folder: string;
  pageSlug: string | null;
  rationale: string | null;
  content?: string;
  characters: number;
  createdAt: string;
}

interface Props {
  /** Conversation public id (`conv_…`); proposals are scoped to it. */
  conversationId?: string | null;
  /** Set on Garden Chat so the list stays inside the active Garden. */
  gardenSlug?: string | null;
  /** Changes when a turn ends, so a just-created proposal shows up. */
  refreshKey?: unknown;
  children: ReactNode;
}

type Decision = "apply" | "reject";
interface ProposalError {
  message: string;
  proposal?: PendingProposal;
  decision?: Decision;
}
const ProposalContext = createContext<{
  proposals: PendingProposal[];
  decidingId: number | null;
  error: ProposalError | null;
  completed: { proposal: PendingProposal; decision: Decision }[];
  decide: (proposal: PendingProposal, decision: Decision) => Promise<void>;
} | null>(null);

function proposalKindLabel(kind: PendingProposal["kind"]): string {
  if (kind === "page_revision") return "Page revision";
  if (kind === "visualization") return "Visualization";
  return "Note";
}

function destinationLabel(proposal: PendingProposal): string {
  const place = proposal.folder ? `${proposal.gardenName} / ${proposal.folder}` : proposal.gardenName;
  if (proposal.kind === "note") return place;
  return proposal.pageSlug ? `${place} · ${proposal.pageSlug}` : place;
}

export function InlineProposalCardsProvider({
  conversationId,
  gardenSlug,
  refreshKey,
  children,
}: Props) {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [error, setError] = useState<ProposalError | null>(null);
  const [completed, setCompleted] = useState<{ proposal: PendingProposal; decision: Decision }[]>([]);

  const query = (() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (gardenSlug) params.set("gardenSlug", gardenSlug);
    return params.toString();
  })();

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!query) {
        setProposals([]);
        return;
      }
      try {
        const response = await fetch(`/api/hermes/proposals?${query}`, { signal });
        if (!response.ok) throw new Error("Could not load the proposed Garden changes.");
        const data = await response.json();
        if (signal?.aborted) return;
        const next = Array.isArray(data.proposals) ? (data.proposals as PendingProposal[]) : [];
        setProposals(next);
        setLoadedQuery(query);
        setError(current => current?.proposal && next.some(proposal => proposal.id === current.proposal!.id) ? current : null);
      } catch (cause) {
        if (!signal?.aborted) setError({ message: cause instanceof Error ? cause.message : "Could not load the proposed Garden changes." });
      }
    },
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const changed = () => void refresh(controller.signal);
    window.addEventListener(GARDEN_PROPOSALS_CHANGED_EVENT, changed);
    return () => {
      controller.abort();
      window.removeEventListener(GARDEN_PROPOSALS_CHANGED_EVENT, changed);
    };
  }, [refresh]);

  const decide = useCallback(
    async (proposal: PendingProposal, decision: Decision) => {
      if (decidingId !== null) return;
      setDecidingId(proposal.id);
      setError(null);
      try {
        const response = await fetch(
          `/api/gardens/${encodeURIComponent(proposal.gardenId)}/proposals/${proposal.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          // A failed write leaves the proposal pending, so it stays retryable.
          throw new Error(detail?.error ?? "Could not save this to the Garden.");
        }
        const result = (await response.json().catch(() => null)) as {
          document?: { slug?: string; folder?: string; content?: string; title?: string } | null;
        } | null;
        const savedSlug = result?.document?.slug ?? (proposal.kind === "page_revision" ? proposal.pageSlug : null);
        if (decision === "apply" && savedSlug) {
          window.dispatchEvent(
            new CustomEvent(GARDEN_DOCUMENTS_CHANGED_EVENT, {
              detail: {
                gardenId: proposal.gardenId,
                folder: result?.document?.folder ?? "",
                slug: savedSlug,
              },
            }),
          );
          if (proposal.kind === "page_revision") {
            window.dispatchEvent(new CustomEvent("sb:markdown-updated", {
              detail: {
                cluster: proposal.gardenId,
                slug: savedSlug,
                title: result?.document?.title,
                content: result?.document?.content,
              },
            }));
          }
        }
        setProposals((current) => current.filter((item) => item.id !== proposal.id));
        setCompleted(current => [...current.filter(item => item.proposal.id !== proposal.id), { proposal, decision }]);
        window.dispatchEvent(
          new CustomEvent(GARDEN_PROPOSALS_CHANGED_EVENT, {
            detail: { gardenId: proposal.gardenId, proposalId: proposal.id, decision },
          }),
        );
      } catch (cause) {
        const message = cause instanceof Error && cause.name === "TimeoutError"
          ? "Saving took longer than expected. Retry to check the result."
          : cause instanceof Error ? cause.message : "Could not save this to the Garden.";
        setError({ message, proposal, decision });
      } finally {
        setDecidingId(null);
      }
    },
    [decidingId],
  );

  const visibleProposals = loadedQuery === query ? proposals : [];
  return (
    <ProposalContext.Provider value={{ proposals: visibleProposals, decidingId, error, completed, decide }}>
      {error && !error.proposal ? <ProposalFailure message={error.message} onRetry={() => void refresh()} /> : null}
      {children}
    </ProposalContext.Provider>
  );
}

function ProposalFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="rounded-lg border border-[rgba(182,91,91,0.32)] bg-[rgba(255,250,247,0.78)] px-3 py-2 text-xs text-[var(--danger)]" role="alert">
      {message}
      <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>
    </p>
  );
}

export default function InlineProposalCards({ ownerMessageId }: { ownerMessageId: string | null }) {
  const context = useContext(ProposalContext);
  if (!context || !ownerMessageId) return null;
  const { decidingId, decide } = context;
  const proposals = context.proposals.filter(proposal => proposal.assistantMessageId === ownerMessageId);
  const error = context.error?.proposal?.assistantMessageId === ownerMessageId ? context.error : null;
  const completed = context.completed.filter(item => item.proposal.assistantMessageId === ownerMessageId);
  if (proposals.length === 0 && !error && completed.length === 0) return null;

  return (
    <section className="mt-3 space-y-2" aria-label="Garden changes waiting for your review" data-owner-message-id={ownerMessageId}>
      {completed.map(({ proposal, decision }) => <p key={proposal.id} role="status" className="text-xs text-[var(--ink-muted)]">{proposalKindLabel(proposal.kind)} #{proposal.id} {decision === "apply" ? "applied" : "discarded"}.</p>)}
      {error ? (
        <ProposalFailure message={error.message} onRetry={() => void decide(error.proposal!, error.decision!)} />
      ) : null}
      {proposals.map((proposal) => (
        <article
          key={proposal.id}
          data-proposal-id={proposal.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(28,45,36,0.06)]"
        >
          <span
            aria-hidden
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)]"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h9l3 3v13H6z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 11h6M9 15h4" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
              {proposal.title ?? proposal.pageSlug ?? proposalKindLabel(proposal.kind)}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
              {proposalKindLabel(proposal.kind)} #{proposal.id} · {destinationLabel(proposal)}
              {proposal.characters > 0 ? ` · ${proposal.characters.toLocaleString()} characters` : ""}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void decide(proposal, "apply")}
              disabled={decidingId !== null}
              className="neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {decidingId === proposal.id ? "Saving…" : proposal.kind === "page_revision" ? "Apply revision" : "Save to Garden"}
            </button>
            <button
              type="button"
              onClick={() => void decide(proposal, "reject")}
              disabled={decidingId !== null}
              className="neu-button-icon rounded-lg px-3 py-2 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
          </span>
          {proposal.rationale ? <p className="w-full text-sm text-[var(--ink-muted)]">{proposal.rationale}</p> : null}
          {proposal.content ? (
            <details open={proposal.kind === "page_revision"} className="w-full min-w-0">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ink-heading)]">Proposed {proposal.kind === "page_revision" ? "revision" : "content"}</summary>
              <div className="mt-2 max-h-[60vh] overflow-auto rounded-lg border border-[var(--line)] p-3 text-sm" tabIndex={0} aria-label="Proposed content">
                {/^(?:diff --git|--- .*\n\+\+\+ |@@|\*\*\* Begin Patch)/m.test(proposal.content)
                  ? <pre className="whitespace-pre-wrap break-words font-mono text-xs">{proposal.content}</pre>
                  : <ChatMarkdown content={proposal.content} />}
              </div>
            </details>
          ) : null}
        </article>
      ))}
    </section>
  );
}
