"use client";

// Garden chat backed by the OpenHarness `breadboard-garden` agent.
//
// Scoped to a single garden: the agent can only use the curated garden_* tools
// (search, retrieval, and proposal creation) — no shell, files, or git. Answers
// stay grounded and cite sources; any change the agent suggests arrives as a
// typed PROPOSAL the user reviews and applies through Breadboard, never a silent
// markdown edit. This floating panel embeds the shared runtime panel plus a
// proposals reviewer.

import { useCallback, useEffect, useState } from "react";
import AgentRuntimePanel from "./agent-runtime-panel";
import { useAgentSession } from "./use-agent-session";

interface Props {
  gardenSlug: string;
  gardenName?: string;
  onClose?: () => void;
}

interface Proposal {
  id: number;
  kind: "note" | "page_revision" | "visualization";
  pageSlug: string | null;
  rationale: string | null;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export default function GardenAgentChat({ gardenSlug, gardenName, onClose }: Props) {
  const [input, setInput] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [showProposals, setShowProposals] = useState(false);
  const session = useAgentSession("garden_chat", { gardenSlug, title: `${gardenName ?? gardenSlug} chat` });

  const loadProposals = useCallback(async () => {
    try {
      const response = await fetch(`/api/gardens/${encodeURIComponent(gardenSlug)}/proposals?status=pending`);
      if (!response.ok) return;
      const data = await response.json();
      // setState after an async fetch is the endorsed "subscribe to external
      // system" pattern; it is not a synchronous set within the effect body.
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    } catch {
      // Non-fatal; proposals just won't refresh.
    }
  }, [gardenSlug]);

  // Load once and refresh whenever a turn finishes (the agent may have proposed).
  // Fetching happens asynchronously; state is only set after the network reply.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadProposals();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProposals, session.connection]);

  const decide = useCallback(
    async (proposalId: number, decision: "apply" | "reject") => {
      await fetch(
        `/api/gardens/${encodeURIComponent(gardenSlug)}/proposals/${proposalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      ).catch(() => undefined);
      void loadProposals();
    },
    [gardenSlug, loadProposals],
  );

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void session.send(text);
  }, [input, session]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[70vh] w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950 shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">{gardenName ?? gardenSlug}</p>
          <p className="truncate text-[11px] text-gray-500">Garden agent · grounded, proposal-only</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProposals((value) => !value)}
            className="relative rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-900"
          >
            Proposals
            {proposals.length > 0 ? (
              <span className="ml-1 rounded-full bg-amber-600 px-1.5 text-[10px] text-white">{proposals.length}</span>
            ) : null}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-900"
              aria-label="Close garden chat"
            >
              ✕
            </button>
          ) : null}
        </div>
      </header>

      {showProposals ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {proposals.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">No pending proposals.</p>
          ) : (
            <ul className="space-y-3">
              {proposals.map((proposal) => (
                <li key={proposal.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                      {proposal.kind.replace("_", " ")}
                    </span>
                    {proposal.pageSlug ? (
                      <span className="truncate text-[10px] text-gray-500">{proposal.pageSlug}</span>
                    ) : null}
                  </div>
                  {proposal.rationale ? (
                    <p className="mt-2 text-xs text-gray-300">{proposal.rationale}</p>
                  ) : null}
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-950 p-2 text-[10px] text-gray-400">
                    {JSON.stringify(proposal.payload, null, 2)}
                  </pre>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(proposal.id, "apply")}
                      className="rounded-md border border-emerald-700 bg-emerald-900/40 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-900/70"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(proposal.id, "reject")}
                      className="rounded-md border border-red-800 bg-red-950/40 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-950/70"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <AgentRuntimePanel
          compact
          messages={session.messages}
          connection={session.connection}
          error={session.error}
          pendingPermission={session.pendingPermission}
          activities={session.activities}
          input={input}
          onInputChange={setInput}
          onSubmit={submit}
          onAbort={() => void session.abort()}
          onPermissionDecision={(decision) => void session.respondToPermission(decision)}
          placeholder={`Ask about ${gardenName ?? "this garden"}…`}
          emptyState={
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-gray-200">Ask this garden</p>
              <p className="mt-1.5 text-xs text-gray-500">
                Grounded answers with citations. Ask it to trace a source, compare sections, find gaps, quiz
                you, or propose a correction.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
