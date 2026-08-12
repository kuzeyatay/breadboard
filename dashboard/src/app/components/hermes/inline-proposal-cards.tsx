"use client";

// A Garden proposal is only useful where the owner can act on it. Garden Chat
// has a Proposals tab; the Terminal has nothing, so `/save-to-garden` there used
// to end in a pending row no surface could apply. These cards close that loop by
// listing this conversation's pending proposals inline, with the decision routed
// through the same owner-checked endpoint the Garden reviewer uses.

import { useCallback, useEffect, useState } from "react";
import { GARDEN_DOCUMENTS_CHANGED_EVENT } from "./artifact-viewer";

/** Fired after a proposal is applied or rejected, so other reviewers refresh. */
export const GARDEN_PROPOSALS_CHANGED_EVENT = "breadboard:garden-proposals-changed";

export interface PendingProposal {
  id: number;
  kind: "note" | "page_revision" | "visualization";
  gardenId: string;
  gardenName: string;
  title: string | null;
  folder: string;
  pageSlug: string | null;
  rationale: string | null;
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

export default function InlineProposalCards({
  conversationId,
  gardenSlug,
  refreshKey,
}: Props) {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!response.ok) return;
        const data = await response.json();
        if (signal?.aborted) return;
        setProposals(Array.isArray(data.proposals) ? (data.proposals as PendingProposal[]) : []);
      } catch {
        // A failed refresh leaves the last known list; the Garden reviewer still works.
      }
    },
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, refreshKey]);

  const decide = useCallback(
    async (proposal: PendingProposal, decision: "apply" | "reject") => {
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
          },
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          // A failed write leaves the proposal pending, so it stays retryable.
          throw new Error(detail?.error ?? "Could not save this to the Garden.");
        }
        const result = (await response.json().catch(() => null)) as {
          document?: { slug?: string; folder?: string } | null;
        } | null;
        if (decision === "apply" && result?.document?.slug) {
          window.dispatchEvent(
            new CustomEvent(GARDEN_DOCUMENTS_CHANGED_EVENT, {
              detail: {
                gardenId: proposal.gardenId,
                folder: result.document.folder ?? "",
                slug: result.document.slug,
              },
            }),
          );
        }
        setProposals((current) => current.filter((item) => item.id !== proposal.id));
        window.dispatchEvent(
          new CustomEvent(GARDEN_PROPOSALS_CHANGED_EVENT, {
            detail: { gardenId: proposal.gardenId, proposalId: proposal.id, decision },
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save this to the Garden.");
      } finally {
        setDecidingId(null);
      }
    },
    [decidingId],
  );

  if (proposals.length === 0 && !error) return null;

  return (
    <section className="mt-3 space-y-2" aria-label="Garden changes waiting for your review">
      {error ? (
        <p
          className="rounded-lg border border-[rgba(182,91,91,0.32)] bg-[rgba(255,250,247,0.78)] px-3 py-2 text-xs text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {proposals.map((proposal) => (
        <article
          key={proposal.id}
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
              {proposal.title ?? proposalKindLabel(proposal.kind)}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
              {proposalKindLabel(proposal.kind)} · {destinationLabel(proposal)}
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
              {decidingId === proposal.id ? "Saving…" : "Save to Garden"}
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
        </article>
      ))}
    </section>
  );
}
