"use client";

// Garden chat backed by the OpenHarness `breadboard-garden` agent.
//
// Scoped to a single garden: the agent can only use the curated garden_* tools
// (search, retrieval, and proposal creation) — no shell, files, or git. Answers
// stay grounded and cite sources; any change the agent suggests arrives as a
// typed PROPOSAL the user reviews and applies through Breadboard, never a silent
// markdown edit. This floating panel embeds the shared runtime panel and gives
// the surface the same capability set as the dashboard terminal: model and
// reasoning-effort selection, session history with new-chat, skill review, and
// the proposals reviewer.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import AgentRuntimePanel from "./agent-runtime-panel";
import ArtifactPanel, {
  ARTIFACT_BROWSER_EVENT,
  ARTIFACT_REVISE_EVENT,
  ArtifactArchiveIcon,
} from "./artifact-panel";
import SkillReviewPanel from "./skill-review-panel";
import GBrainStatusBadge from "./gbrain-status-badge";
import { deleteChatSession, TrashIcon } from "./history-client";
import { useAgentSession, type AgentMessage } from "./use-agent-session";
import {
  DEFAULT_ASSISTANT_MODELS,
  mergeAssistantModels,
} from "@/lib/ai-models";

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

interface RuntimeHistorySession {
  id: string;
  title: string;
  updatedAt: string;
  messages: AgentMessage[];
  gardenId: string;
}

type PanelView = "chat" | "proposals" | "artifacts" | "recents" | "skills";

const SUGGESTED_PROMPTS = [
  "Summarize the main ideas of this garden.",
  "Quiz me on this garden.",
  "Find gaps or missing prerequisites in these notes.",
  "Trace the sources behind a key claim.",
];

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function GardenAgentChat({ gardenSlug, gardenName, onClose }: Props) {
  const [input, setInput] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [view, setView] = useState<PanelView>("chat");
  const { model, setModel, reasoningEffort, setReasoningEffort } = useAssistantIntelligence();
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [history, setHistory] = useState<RuntimeHistorySession[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const autoOpenedArtifactRuns = useRef(new Set<string>());
  const dismissedArtifactRuns = useRef(new Set<string>());
  const session = useAgentSession("garden_chat", { gardenSlug, title: `${gardenName ?? gardenSlug} chat` });
  const busy =
    session.connection === "connecting" ||
    session.connection === "streaming" ||
    session.connection === "waiting";

  useEffect(() => {
    const listener = (raw: Event) => {
      const artifact = (raw as CustomEvent<{ id?: string; title?: string; gardenId?: string | null }>).detail;
      if (!artifact?.id || artifact.gardenId !== gardenSlug) return;
      setView("chat");
      setInput(`Revise the selected artifact "${artifact.title ?? "artifact"}" (${artifact.id}): `);
    };
    window.addEventListener(ARTIFACT_REVISE_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_REVISE_EVENT, listener);
  }, [gardenSlug]);

  useEffect(() => {
    fetch("/api/models")
      .then((response) => response.json())
      .then((data) => {
        const ids = Array.isArray(data?.data)
          ? data.data
              .map((item: { id?: unknown }) => (typeof item?.id === "string" ? item.id : null))
              .filter((id: string | null): id is string => Boolean(id))
          : [];
        if (ids.length > 0) setModels(mergeAssistantModels(ids));
      })
      .catch(() => undefined);
  }, []);

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

  // Refresh the recents list between turns so past garden sessions can be
  // reopened, mirroring the terminal's history sidebar.
  useEffect(() => {
    if (session.connection !== "idle") return;
    let cancelled = false;
    void fetch("/api/openharness/sessions?surface=garden_chat")
      .then((response) => (response.ok ? response.json() : { sessions: [] }))
      .then((data) => {
        if (cancelled) return;
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        setHistory(
          sessions
            .filter((item: { id?: unknown; gardenId?: unknown }) =>
              typeof item.id === "string" &&
              item.id.startsWith("conv_") &&
              item.gardenId === gardenSlug,
            )
            .map((item: {
              id: string;
              title?: unknown;
              updatedAt?: unknown;
              messages?: unknown;
              gardenId?: unknown;
            }) => ({
              id: item.id,
              title: typeof item.title === "string" ? item.title : "New chat",
              updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
              messages: Array.isArray(item.messages) ? (item.messages as AgentMessage[]) : [],
              gardenId: gardenSlug,
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gardenSlug, session.connection, session.sessionId]);

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
    void session.send(text, { model, reasoningEffort });
  }, [input, model, reasoningEffort, session]);

  const steer = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return session.steer(trimmed);
  }, [session]);

  const sendQueued = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await session.send(trimmed, { model, reasoningEffort });
  }, [model, reasoningEffort, session]);

  const editMessage = useCallback(
    (messageIndex: number, text: string, branchGroupId: string) => {
      void session.send(text, {
        model,
        reasoningEffort,
        historyOverride: session.messages.slice(0, messageIndex),
        branchGroupId,
      });
    },
    [model, reasoningEffort, session],
  );

  const selectBranch = useCallback(
    (messages: typeof session.messages) => session.setMessages(messages),
    [session],
  );

  const sendSuggestedPrompt = useCallback(
    (text: string) => {
      if (busy) return;
      void session.send(text, { model, reasoningEffort });
    },
    [busy, model, reasoningEffort, session],
  );

  const retryMessage = useCallback(
    (messageIndex: number) => {
      const previousUser = session.messages
        .slice(0, messageIndex)
        .reverse()
        .find((message) => message.role === "user");
      if (previousUser) void session.send(previousUser.content, { model, reasoningEffort });
    },
    [model, reasoningEffort, session],
  );

  function startNewChat() {
    if (busy) return;
    session.reset();
    setInput("");
    setView("chat");
  }

  function openHistorySession(item: RuntimeHistorySession) {
    if (busy || item.gardenId !== gardenSlug) return;
    session.reset();
    session.setSessionId(item.id);
    session.setMessages(item.messages);
    setView("chat");
  }

  async function deleteHistorySession(item: RuntimeHistorySession) {
    if (busy) return;
    if (
      !window.confirm(
        `Delete "${item.title}"? Its messages and any artifacts it produced are removed for good.`,
      )
    ) {
      return;
    }
    setHistoryError(null);
    const result = await deleteChatSession(item.id);
    if (!result.deleted) {
      setHistoryError(result.error ?? "This chat could not be deleted.");
      return;
    }
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    // The open chat no longer exists; fall back to an empty one.
    if (item.id === session.sessionId) startNewChat();
  }

  function toggleView(next: PanelView) {
    setView((current) => {
      const target = current === next ? "chat" : next;
      if (current === "artifacts" && target !== "artifacts" && session.activeRunId) {
        dismissedArtifactRuns.current.add(session.activeRunId);
      }
      return target;
    });
  }

  const openCreatedArtifact = useCallback((detail: { runId: string }) => {
    if (dismissedArtifactRuns.current.has(detail.runId) || autoOpenedArtifactRuns.current.has(detail.runId)) return;
    autoOpenedArtifactRuns.current.add(detail.runId);
    setView("artifacts");
  }, []);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<{ type?: string; gardenId?: string | null; conversationId?: string; runId?: string }>).detail;
      if (
        detail?.type !== "artifact.created" ||
        detail.gardenId !== gardenSlug ||
        detail.conversationId !== session.sessionId ||
        !detail.runId
      ) return;
      openCreatedArtifact({ runId: detail.runId });
    };
    window.addEventListener(ARTIFACT_BROWSER_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_BROWSER_EVENT, listener);
  }, [gardenSlug, openCreatedArtifact, session.sessionId]);

  const headerButton =
    "rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-900";
  const activeHeaderButton =
    "rounded-md border border-gray-500 bg-gray-800 px-2 py-1 text-[11px] text-white";

  return (
    <div className="neu-surface-raised fixed bottom-4 right-4 z-50 flex h-[76vh] w-[480px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">{gardenName ?? gardenSlug}</p>
          <p className="truncate text-[11px] text-gray-500">
            Garden agent · grounded, proposal-only · OpenHarness
          </p>
          <div className="mt-1">
            <GBrainStatusBadge gardenSlug={gardenSlug} canReindex />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400">
            {session.connection === "idle" ? "ready" : session.connection}
          </span>
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            className={`${headerButton} disabled:opacity-50`}
            title="Start a new chat"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => toggleView("recents")}
            className={view === "recents" ? activeHeaderButton : headerButton}
            title="Show past chats in this garden"
          >
            Recents
          </button>
          <button
            type="button"
            onClick={() => toggleView("skills")}
            className={view === "skills" ? activeHeaderButton : headerButton}
            title="Review skills"
          >
            Skills
          </button>
          <button
            type="button"
            onClick={() => toggleView("proposals")}
            className={`relative ${view === "proposals" ? activeHeaderButton : headerButton}`}
          >
            Proposals
            {proposals.length > 0 ? (
              <span className="ml-1 rounded-full bg-amber-600 px-1.5 text-[10px] text-white">{proposals.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => toggleView("artifacts")}
            className={`inline-flex items-center gap-1.5 ${
              view === "artifacts" ? activeHeaderButton : headerButton
            }`}
            title="Open conversation artifacts"
          >
            <ArtifactArchiveIcon className="h-3.5 w-3.5 shrink-0" />
            Artifacts
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={headerButton}
              aria-label="Close garden chat"
            >
              ✕
            </button>
          ) : null}
        </div>
      </header>

      {view === "recents" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">
            Recents
          </div>
          {historyError ? (
            <p className="mb-2 px-1 text-[11px] text-[#a45f56]">{historyError}</p>
          ) : null}
          {history.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">No chats in this garden yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {history.map((item) => (
                <li
                  key={item.id}
                  className={`group flex items-center gap-1 rounded-md transition ${
                    item.id === session.sessionId
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openHistorySession(item)}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{item.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-600">
                        {formatChatTime(item.updatedAt)}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteHistorySession(item)}
                    disabled={busy}
                    title="Delete this chat"
                    aria-label={`Delete chat ${item.title}`}
                    className="mr-1 shrink-0 rounded p-1 text-gray-600 opacity-0 transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : view === "skills" ? (
        <SkillReviewPanel
          runtimeSessionId={session.sessionId}
          onClose={() => setView("chat")}
        />
      ) : view === "artifacts" ? (
        <ArtifactPanel
          compact
          conversationId={session.sessionId}
          gardenSlug={gardenSlug}
          onArtifactCreated={openCreatedArtifact}
        />
      ) : view === "proposals" ? (
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
          sessionId={session.sessionId}
          surface="garden_chat"
          messages={session.messages}
          connection={session.connection}
          runState={session.runState}
          steerError={session.steerError}
          error={session.error}
          pendingPermission={session.pendingPermission}
          activities={session.activities}
          input={input}
          onInputChange={setInput}
          onSubmit={submit}
          onSteer={steer}
          onSendQueued={sendQueued}
          onEditMessage={editMessage}
          onSelectBranch={selectBranch}
          onAbort={() => void session.abort()}
          onPermissionDecision={(decision) => void session.respondToPermission(decision)}
          onRetryMessage={retryMessage}
          placeholder={`Ask about ${gardenName ?? "this garden"}…`}
          model={model}
          models={models}
          onModelChange={setModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          emptyState={
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <div>
                <p className="text-sm font-medium text-gray-200">Ask this garden</p>
                <p className="mt-1.5 text-xs text-gray-500">
                  Grounded answers with citations. Ask it to trace a source, compare sections, find gaps, quiz
                  you, or propose a correction.
                </p>
              </div>
              <div className="grid w-full max-w-md gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    onClick={() => sendSuggestedPrompt(prompt)}
                    disabled={busy}
                    className="neu-button rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-xs text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
