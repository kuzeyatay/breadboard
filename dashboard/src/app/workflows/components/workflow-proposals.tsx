"use client";

import { useEffect, useState } from "react";

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
export function WorkflowProposals({ onOpen }: { onOpen: (id: string) => void }) {
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
