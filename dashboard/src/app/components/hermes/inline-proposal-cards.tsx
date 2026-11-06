"use client";

// Fetch once per conversation, then render each proposal inside the assistant
// message that created it. Virtualized rows share review state through the
// provider, so cards and errors stay with their turn when rows remount.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  /** The result of applying a patch in memory, with complete Markdown/math context. */
  previewContent?: string | null;
  previewError?: string | null;
  originalText?: string | null;
  characters: number;
  createdAt: string;
}

interface Props {
  /** Conversation public id (`conv_…`); proposals are scoped to it. */
  conversationId?: string | null;
  /** Fallback scope for a Garden reviewer without a selected conversation. */
  gardenSlug?: string | null;
  /** Changes when a turn ends, so a just-created proposal shows up. */
  refreshKey?: unknown;
  /** Queue a follow-up in the conversation that owns the failed proposal. */
  onRequestRevision?: (prompt: string) => void | Promise<void>;
  children: ReactNode;
}

type Decision = "apply" | "reject";
interface ProposalError {
  message: string;
  code?: string;
  proposal?: PendingProposal;
  decision?: Decision;
}
const ProposalContext = createContext<{
  proposals: PendingProposal[];
  decidingId: number | null;
  error: ProposalError | null;
  completed: { proposal: PendingProposal; decision: Decision }[];
  decide: (proposal: PendingProposal, decision: Decision) => Promise<void>;
  requestRevision: ((proposal: PendingProposal) => Promise<void>) | null;
  requestingRevisionId: number | null;
  requestedRevisions: ReadonlySet<number>;
} | null>(null);

function needsFreshRevision(error: ProposalError | null): boolean {
  return error?.proposal?.kind === "page_revision" && error.decision === "apply" &&
    ["revision_conflict", "revision_target_required", "revision_page_unresolved", "empty_revision", "empty_revision_target"].includes(error.code ?? "");
}

function revisionRecoveryPrompt(proposal: PendingProposal): string {
  return [
    `Create a fresh revision proposal for page ${JSON.stringify(proposal.pageSlug)} in Garden ${JSON.stringify(proposal.gardenId)}. Proposal #${proposal.id} could not be applied because its source text does not match the current page.`,
    "Read the current Markdown with garden_get_page, following nextOffset as needed. Recreate the same requested change against that exact source, preserving everything else. For a passage replacement, copy originalText verbatim and include enough context to match once. For a diff, copy complete source lines, including blank lines and punctuation. Validate the proposal before offering it. Leave the new revision pending for my review; do not apply it automatically.",
    proposal.rationale ? `Requested change: ${proposal.rationale}` : "",
    "Previous proposal for reference only; its original passages must be read again:",
    JSON.stringify({ originalText: proposal.originalText ?? undefined, patchOrReplacement: proposal.content ?? "" }, null, 2),
  ].filter(Boolean).join("\n\n");
}

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
  onRequestRevision,
  children,
}: Props) {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [error, setError] = useState<ProposalError | null>(null);
  const [completed, setCompleted] = useState<{ proposal: PendingProposal; decision: Decision }[]>([]);
  const actionPending = useRef(false);
  const [requestingRevisionId, setRequestingRevisionId] = useState<number | null>(null);
  const [requestedRevisions, setRequestedRevisions] = useState<ReadonlySet<number>>(new Set());

  const query = (() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    // A chat can propose a change in another authorized Garden. The card
    // names that destination; filtering it by the open Garden hides the review.
    else if (gardenSlug) params.set("gardenSlug", gardenSlug);
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
      if (actionPending.current) return;
      actionPending.current = true;
      setDecidingId(proposal.id);
      setError(null);
      let code: string | undefined;
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
          const detail = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
          code = detail?.code;
          // A transient write can be retried. A conflicting revision needs a
          // new proposal, never another attempt to apply the same invalid patch.
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
        setError({ message, code, proposal, decision });
      } finally {
        actionPending.current = false;
        setDecidingId(null);
      }
    },
    [],
  );

  const requestRevision = useCallback(async (proposal: PendingProposal) => {
    if (!onRequestRevision || actionPending.current || requestedRevisions.has(proposal.id)) return;
    actionPending.current = true;
    setRequestingRevisionId(proposal.id);
    try {
      await onRequestRevision(revisionRecoveryPrompt(proposal));
      setRequestedRevisions(current => new Set([...current, proposal.id]));
    } catch (cause) {
      setError(current => ({ ...current, proposal, decision: "apply", code: current?.code ?? "revision_conflict",
        message: cause instanceof Error ? cause.message : "Could not request a fresh revision. Try again." }));
    } finally {
      actionPending.current = false;
      setRequestingRevisionId(null);
    }
  }, [onRequestRevision, requestedRevisions]);

  const visibleProposals = loadedQuery === query ? proposals : [];
  return (
    <ProposalContext.Provider value={{ proposals: visibleProposals, decidingId, error, completed, decide,
      requestRevision: onRequestRevision ? requestRevision : null, requestingRevisionId, requestedRevisions }}>
      {error && !error.proposal ? <ProposalFailure message={error.message} onRetry={() => void refresh()} /> : null}
      {children}
    </ProposalContext.Provider>
  );
}

function ProposalFailure({ message, onRetry, retryLabel = "Retry", disabled = false }: {
  message: string; onRetry?: () => void; retryLabel?: string; disabled?: boolean;
}) {
  return (
    <p className="rounded-lg border border-[rgba(182,91,91,0.32)] bg-[rgba(255,250,247,0.78)] px-3 py-2 text-xs text-[var(--danger)]" role="alert">
      {message}
      {onRetry ? <button type="button" className="ml-2 underline disabled:opacity-50" disabled={disabled} onClick={onRetry}>{retryLabel}</button> : null}
    </p>
  );
}

export default function InlineProposalCards({ ownerMessageId }: { ownerMessageId: string | null }) {
  const context = useContext(ProposalContext);
  if (!context || !ownerMessageId) return null;
  const { decidingId, decide, requestRevision, requestingRevisionId, requestedRevisions } = context;
  const proposals = context.proposals.filter(proposal => proposal.assistantMessageId === ownerMessageId);
  const error = context.error?.proposal?.assistantMessageId === ownerMessageId ? context.error : null;
  const completed = context.completed.filter(item => item.proposal.assistantMessageId === ownerMessageId);
  const freshRevision = needsFreshRevision(error);
  const revisionRequested = error?.proposal && requestedRevisions.has(error.proposal.id);
  const busy = decidingId !== null || requestingRevisionId !== null;
  if (proposals.length === 0 && !error && completed.length === 0) return null;

  return (
    <section className="mt-3 space-y-2" aria-label="Garden changes waiting for your review" data-owner-message-id={ownerMessageId}>
      {completed.map(({ proposal, decision }) => <p key={proposal.id} role="status" className="text-xs text-[var(--ink-muted)]">{proposalKindLabel(proposal.kind)} #{proposal.id} {decision === "apply" ? "applied" : "discarded"}.</p>)}
      {error && revisionRequested ? <p role="status" className="text-xs text-[var(--ink-muted)]">A fresh revision has been requested in this conversation. Review the new proposal when it is ready.</p> : error ? (
        <ProposalFailure message={error.message}
          retryLabel={freshRevision ? requestingRevisionId === error.proposal!.id ? "Requesting…" : "Request fresh revision" : decidingId === error.proposal!.id ? "Retrying…" : "Retry"}
          disabled={busy}
          onRetry={freshRevision
            ? requestRevision ? () => void requestRevision(error.proposal!) : undefined
            : () => void decide(error.proposal!, error.decision!)} />
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
              disabled={busy || (freshRevision && error?.proposal?.id === proposal.id) || requestedRevisions.has(proposal.id)}
              className="neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {decidingId === proposal.id ? "Saving…" : proposal.kind === "page_revision" ? "Apply revision" : "Save to Garden"}
            </button>
            <button
              type="button"
              onClick={() => void decide(proposal, "reject")}
              disabled={busy}
              className="neu-button-icon rounded-lg px-3 py-2 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
          </span>
          {proposal.rationale ? <p className="w-full text-sm text-[var(--ink-muted)]">{proposal.rationale}</p> : null}
          {proposal.content || proposal.originalText ? (
            <details open={proposal.kind === "page_revision"} className="w-full min-w-0">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ink-heading)]">Proposed {proposal.kind === "page_revision" ? "revision" : "content"}</summary>
              {proposal.originalText ? (
                <div className="mt-2 max-h-[30vh] overflow-auto rounded-lg border border-[var(--line)] p-3 text-sm" tabIndex={0} aria-label="Passage to replace">
                  <p className="mb-2 font-medium text-[var(--ink-muted)]">Replace this passage</p>
                  <ChatMarkdown content={proposal.originalText} />
                </div>
              ) : null}
              <div className="mt-2 max-h-[60vh] overflow-auto rounded-lg border border-[var(--line)] p-3 text-sm" tabIndex={0} aria-label="Proposed content">
                {proposal.originalText ? <p className="mb-2 font-medium text-[var(--ink-muted)]">{proposal.content ? "With" : "Remove this passage"}</p> : null}
                {proposal.previewContent != null ? (
                  <>
                    <p className="mb-2 font-medium text-[var(--ink-muted)]">Page after this revision</p>
                    <ChatMarkdown content={proposal.previewContent} />
                  </>
                ) : !proposal.originalText && (proposal.previewError || /^(?:diff --git|--- .*\n\+\+\+ |@@|\*\*\* Begin Patch)/m.test(proposal.content ?? "")) ? (
                  <>
                    {proposal.previewError ? <p role="status" className="mb-2 text-[var(--ink-muted)]">{proposal.previewError}</p> : null}
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">{proposal.content}</pre>
                  </>
                ) : <ChatMarkdown content={proposal.content ?? ""} />}
              </div>
              {proposal.previewContent != null ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">Source patch</summary>
                  <pre className="mt-2 max-h-[30vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] p-3 font-mono text-xs">{proposal.content}</pre>
                </details>
              ) : null}
            </details>
          ) : null}
        </article>
      ))}
    </section>
  );
}
