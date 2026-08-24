"use client";

// Garden chat backed by the Hermes `breadboard-garden` agent.
//
// Scoped to a single garden: the agent can only use the curated garden_* tools
// (search, retrieval, and proposal creation) — no shell, files, or git. Answers
// stay grounded and cite sources; any change the agent suggests arrives as a
// typed PROPOSAL the user reviews and applies through Breadboard, never a silent
// markdown edit. This floating panel embeds the shared runtime panel and gives
// the surface the same capability set as the dashboard terminal: model and
// reasoning-effort selection, session history with new-chat, skill review, and
// the proposals reviewer.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import { isSuperAgentEnabled } from "@/app/components/use-agent-mode";
import { reusableChatAttachments } from "@/lib/chat-attachments";
import { interactiveVisualizerCommandForArtifact } from "@/lib/hermes/interactive-visualizer-skills";
import AgentRuntimePanel from "./agent-runtime-panel";
import ArtifactPanel, {
  ARTIFACT_AI_EDIT_EVENT,
  ArtifactArchiveIcon,
} from "./artifact-panel";
import { consumeArtifactAiEdit, type ArtifactAiEditDetail } from "./artifact-ai-edit";
import SkillReviewPanel from "./skill-review-panel";
import ReviewSettingsPanel from "./review-settings-panel";
import TerminalScheduledPanel from "./terminal-scheduled-panel";
import GBrainStatusBadge from "./gbrain-status-badge";
import { GARDEN_DOCUMENTS_CHANGED_EVENT } from "./artifact-viewer";
import { GARDEN_PROPOSALS_CHANGED_EVENT } from "./inline-proposal-cards";
import {
  ActiveChatIcon,
  chatSessionIsActive,
  ChatHistoryLoading,
  deleteChatSession,
  TrashIcon,
} from "./history-client";
import {
  invalidateHermesSessionSummaries,
  notifyHermesSessionsChanged,
  HERMES_SESSIONS_CHANGED_EVENT,
  loadHermesSessionSummaries,
  prefetchHermesSessionDetail,
  type HermesSessionSnapshot,
} from "@/lib/hermes/session-client";
import {
  externalAgentRunInFlight,
  useAgentSession,
  type ExternalAgentTurnResult,
} from "./use-agent-session";
import { forgetChatDrafts } from "@/lib/conversations/drafts";
import { useChatDraft } from "./use-chat-draft";
import { useWorkflowAutomation } from "./use-workflow-automation";
import { useDeepResearchAgent } from "./use-deep-research-agent";
import {
  directDeepResearchInvocation,
  taskFromDeepResearchIntent,
} from "@/lib/deep-research/identity.ts";
import { maxResearchInvocation } from "@/lib/max-research/identity.ts";
import { launchMaxResearchTurn } from "./launch-max-research";
import { taskFromOpenCodeCommand } from "@/lib/opencode/identity.ts";
import { useOpenCodeAgent } from "./use-opencode-agent";
import { taskFromCodexCommand } from "@/lib/codex/identity.ts";
import { useCodexAgent } from "./use-codex-agent";
import { taskFromRufloCommand } from "@/lib/ruflo/identity.ts";
import { useRufloAgent } from "./use-ruflo-agent";
import { useAssistantModels } from "../use-assistant-models";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";

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
  gardenId: string;
  active: boolean;
}

type PanelView =
  | "chat"
  | "proposals"
  | "artifacts"
  | "recents"
  | "skills"
  | "scheduled"
  | "review";

/** Gear, for the garden's own settings. Inline so the toolbar keeps one idiom. */
function SettingsGearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

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

export default function GardenAgentChat({
  gardenSlug,
  gardenName,
  onClose,
}: Props) {
  const [input, setInput] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [view, setView] = useState<PanelView>("chat");
  const {
    model: selectedModel,
    setModel: setSelectedModel,
    reasoningEffort: selectedReasoningEffort,
    setReasoningEffort,
    intelligenceModes: selectedIntelligenceModes,
    failover: modelFailover,
  } = useAssistantIntelligence();
  const [activeAnswerIntelligence, setActiveAnswerIntelligence] = useState<{
    model: string;
    reasoningEffort: typeof selectedReasoningEffort;
    intelligenceModes: typeof selectedIntelligenceModes;
  } | null>(null);
  const model = activeAnswerIntelligence?.model ?? selectedModel;
  const reasoningEffort =
    activeAnswerIntelligence?.reasoningEffort ?? selectedReasoningEffort;
  const intelligenceModes =
    activeAnswerIntelligence?.intelligenceModes ?? selectedIntelligenceModes;
  const { models } = useAssistantModels({ eager: true });
  const [history, setHistory] = useState<RuntimeHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Asked in the app's own sheet; `confirmDialog` is rendered at the foot of
  // the tray, and portals itself out of this fixed panel.
  const { confirm, confirmDialog } = useConfirmDialog();
  const deepResearchDispatchingRef = useRef(false);
  const [researchNotice, setResearchNotice] = useState("");
  const session = useAgentSession("garden_chat", {
    gardenSlug,
    title: `${gardenName ?? gardenSlug} chat`,
  });
  // Unsent text survives a reload here too. The garden is part of the surface
  // key: an unstarted chat belongs to the garden it was opened from.
  const draftSurface = `garden_chat:${gardenSlug}`;
  useChatDraft({
    surface: draftSurface,
    sessionId: session.sessionId,
    createdSessionId: session.createdSessionId,
    value: input,
    onRestore: setInput,
  });
  const runWorkflowAutomation = useWorkflowAutomation(session);
  const finishExternalAgentTurn = session.finishExternalAgentTurn;
  const deepResearch = useDeepResearchAgent(session, setResearchNotice, model);
  const openCode = useOpenCodeAgent(
    session,
    model,
    reasoningEffort,
    gardenSlug,
    setResearchNotice,
  );
  const codex = useCodexAgent(
    session,
    model,
    reasoningEffort,
    gardenSlug,
    setResearchNotice,
  );
  const ruflo = useRufloAgent(session, gardenSlug, setResearchNotice);
  const busy =
    session.connection === "connecting" ||
    session.connection === "streaming" ||
    session.connection === "waiting";
  // An external agent is dispatching: the run exists on the client but has no
  // transcript turn yet, so nothing in `session` reflects it.
  const externalRunLaunching =
    deepResearch.launching ||
    codex.launching ||
    openCode.launching ||
    ruflo.launching;
  const currentChatActive =
    busy || externalRunLaunching || chatSessionIsActive(null, session.messages);
  const externalAgentRunActive = session.messages.some(
    externalAgentRunInFlight,
  );
  const refreshSession = session.refreshSession;

  useLayoutEffect(() => {
    if (!currentChatActive) setActiveAnswerIntelligence(null);
  }, [currentChatActive]);

  const changeModel = useCallback(
    (nextModel: string) => {
      if (nextModel === selectedModel) return;
      if (currentChatActive) {
        setActiveAnswerIntelligence((current) =>
          current ?? { model, reasoningEffort, intelligenceModes },
        );
      }
      void session.queueModelChange(nextModel).catch(() => undefined);
      setSelectedModel(nextModel);
    },
    [
      currentChatActive,
      intelligenceModes,
      model,
      reasoningEffort,
      selectedModel,
      session,
      setSelectedModel,
    ],
  );

  useEffect(() => {
    if (!externalAgentRunActive || view !== "chat") return;
    const reconcile = () => {
      if (document.visibilityState === "visible") {
        void refreshSession();
      }
    };
    reconcile();
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    return () => {
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
    };
  }, [externalAgentRunActive, refreshSession, view]);

  const handleExternalAgentTerminal = useCallback(
    (
      clientMessageId: string,
      result: Omit<ExternalAgentTurnResult, "clientMessageId">,
    ) => {
      void finishExternalAgentTurn({ clientMessageId, ...result }).catch(
        (cause) => {
          setResearchNotice(
            cause instanceof Error
              ? cause.message
              : "The external agent result could not be saved.",
          );
        },
      );
    },
    [finishExternalAgentTurn],
  );

  useEffect(() => {
    const apply = ({ artifact, prompt }: ArtifactAiEditDetail) => {
      if (!artifact?.id || artifact.gardenId !== gardenSlug) return;
      setView("chat");
      setInput(
        `${interactiveVisualizerCommandForArtifact(artifact)}${prompt}`,
      );
    };
    const listener = (raw: Event) => apply((raw as CustomEvent<ArtifactAiEditDetail>).detail);
    const queued = consumeArtifactAiEdit({ gardenId: gardenSlug });
    const timer = queued ? window.setTimeout(() => apply(queued), 0) : null;
    window.addEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    };
  }, [gardenSlug]);

  const loadProposals = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/gardens/${encodeURIComponent(gardenSlug)}/proposals?status=pending`,
      );
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

  // The inline reviewer in the transcript decides proposals too; keep the tab
  // and its badge in step with it.
  useEffect(() => {
    const listener = () => void loadProposals();
    window.addEventListener(GARDEN_PROPOSALS_CHANGED_EVENT, listener);
    return () =>
      window.removeEventListener(GARDEN_PROPOSALS_CHANGED_EVENT, listener);
  }, [loadProposals]);

  // Refresh the recents list between turns so past garden sessions can be
  // reopened, mirroring the terminal's history sidebar.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refreshHistory = (force = false) => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void loadHermesSessionSummaries("garden_chat", { force })
        .then((sessions) => {
          if (cancelled) return;
          setHistory(
            sessions
              .filter(
                (item): item is HermesSessionSnapshot & { id: string } =>
                  typeof item.id === "string" &&
                  item.id.startsWith("conv_") &&
                  item.gardenId === gardenSlug,
              )
              .map((item) => {
                return {
                  id: item.id,
                  title:
                    typeof item.title === "string" ? item.title : "New chat",
                  updatedAt:
                    typeof item.updatedAt === "string" ? item.updatedAt : "",
                  gardenId: gardenSlug,
                  active:
                    Boolean(item.activeRun) ||
                    item.externalAgentActive === true,
                };
              }),
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (!cancelled) setHistoryLoading(false);
        });
    };
    setHistoryLoading(true);
    refreshHistory();
    const timer = window.setInterval(() => refreshHistory(true), 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshHistory(true);
    };
    const onSessionsChanged = (event: Event) => {
      const changedSurface = (event as CustomEvent<{ surface?: string }>).detail
        ?.surface;
      if (changedSurface === "garden_chat") refreshHistory(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(
        HERMES_SESSIONS_CHANGED_EVENT,
        onSessionsChanged,
      );
    };
  }, [gardenSlug]);

  const decide = useCallback(
    async (proposalId: number, decision: "apply" | "reject") => {
      const response = await fetch(
        `/api/gardens/${encodeURIComponent(gardenSlug)}/proposals/${proposalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      ).catch(() => null);
      if (response?.ok && decision === "apply") {
        const result = (await response.json().catch(() => null)) as {
          document?: { slug?: string; folder?: string } | null;
        } | null;
        if (result?.document?.slug) {
          window.dispatchEvent(
            new CustomEvent(GARDEN_DOCUMENTS_CHANGED_EVENT, {
              detail: {
                gardenId: gardenSlug,
                folder: result.document.folder ?? "",
                slug: result.document.slug,
              },
            }),
          );
        }
      }
      void loadProposals();
    },
    [gardenSlug, loadProposals],
  );

  const maxResearchDispatchingRef = useRef(false);

  /**
   * Max Research on the Garden surface. Same launcher as the Terminal, because
   * the turn is identical on both: one question, no attachments, nothing
   * stacked. Plain language counts here too — a person who typed "max research"
   * is asking to watch five agents work.
   */
  const routeMaxResearchCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      // Same rule as Deep Research directly below: under Super Agent the model
      // delegates this itself, inside its own turn.
      const invocation = maxResearchInvocation(text, isSuperAgentEnabled());
      if (!invocation) return false;
      if (invocation.question && !maxResearchDispatchingRef.current) {
        maxResearchDispatchingRef.current = true;
        void launchMaxResearchTurn({
          session,
          question: invocation.question,
          model,
          reasoningEffort,
          ...(options.branchGroupId ? { branchGroupId: options.branchGroupId } : {}),
          // Their own words when they used them; the canonical command only
          // when that is literally what they typed.
          ...(invocation.selectAgent ? {} : { userContent: text }),
          onStatus: setResearchNotice,
        }).finally(() => {
          maxResearchDispatchingRef.current = false;
        });
      }
      return true;
    },
    [model, reasoningEffort, session],
  );

  const routeDeepResearchCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const invocation = directDeepResearchInvocation(
        text,
        isSuperAgentEnabled(),
      );
      if (!invocation) {
        if (
          isSuperAgentEnabled() &&
          taskFromDeepResearchIntent(text) !== null
        ) {
          deepResearch.clear();
        }
        return false;
      }
      if (deepResearch.launching || deepResearchDispatchingRef.current)
        return true;
      deepResearchDispatchingRef.current = true;
      setResearchNotice("");
      codex.clear();
      openCode.clear();
      ruflo.clear();
      void (async () => {
        try {
          if (invocation.selectAgent && !deepResearch.agent) {
            await deepResearch.select();
          }
          await deepResearch.launch(invocation.task, {
            ...options,
            ...(invocation.selectAgent ? {} : { userContent: text }),
          });
        } finally {
          deepResearchDispatchingRef.current = false;
        }
      })();
      return true;
    },
    [codex, deepResearch, openCode, ruflo],
  );

  const submit = useCallback(() => {
    // Nothing may be dispatched into a chat that is still arriving -- not a
    // Hermes turn and not one of the agent launches below, which bind their run
    // to whichever conversation is selected when they start.
    if (session.loadingSession) return;
    const text = input.trim();
    const codexTask = taskFromCodexCommand(text);
    if (codexTask !== null) {
      if (codex.launching) return;
      setInput("");
      void (async () => {
        deepResearch.clear();
        openCode.clear();
        ruflo.clear();
        if (!codex.agent) await codex.select();
        if (codexTask) await codex.launch(codexTask);
      })();
      return;
    }
    const rufloTask = taskFromRufloCommand(text);
    if (rufloTask !== null) {
      if (ruflo.launching) return;
      setInput("");
      void (async () => {
        deepResearch.clear();
        codex.clear();
        openCode.clear();
        if (!ruflo.agent) await ruflo.select();
        if (rufloTask) await ruflo.launch(rufloTask);
      })();
      return;
    }
    const openCodeTask = taskFromOpenCodeCommand(text);
    if (openCodeTask !== null) {
      if (openCode.launching) return;
      setInput("");
      void (async () => {
        deepResearch.clear();
        codex.clear();
        ruflo.clear();
        if (!openCode.agent) await openCode.select();
        if (openCodeTask) await openCode.launch(openCodeTask);
      })();
      return;
    }
    // Deep Research owns the turn when it is active (or explicitly invoked), the
    // same contract as in the dashboard terminal.
    if (routeMaxResearchCommand(text)) {
      setInput("");
      return;
    }
    if (routeDeepResearchCommand(text)) {
      setInput("");
      return;
    }
    if (ruflo.agent) {
      if (!text || ruflo.launching) return;
      setInput("");
      void ruflo.launch(text);
      return;
    }
    if (codex.agent) {
      if (!text || codex.launching) return;
      setInput("");
      void codex.launch(text);
      return;
    }
    if (openCode.agent) {
      if (!text || openCode.launching) return;
      setInput("");
      void openCode.launch(text);
      return;
    }
    if (deepResearch.agent) {
      if (!text || deepResearch.launching) return;
      setInput("");
      void deepResearch.launch(text);
      return;
    }
    if (!text) return;
    setInput("");
    void session.send(text, { model, reasoningEffort });
  }, [
    deepResearch,
    codex,
    input,
    model,
    openCode,
    reasoningEffort,
    routeMaxResearchCommand,
    routeDeepResearchCommand,
    ruflo,
    session,
  ]);

  const askSelection = useCallback(
    async (question: string, selection: ChatTextSelectionReference) => {
      if (busy) return;
      await session.send(question, {
        model,
        reasoningEffort,
        textSelection: selection,
      });
    },
    [busy, model, reasoningEffort, session],
  );

  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      return session.steer(trimmed);
    },
    [session],
  );

  const sendQueued = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (routeDeepResearchCommand(trimmed)) return;
      if (deepResearch.agent) {
        await deepResearch.launch(trimmed);
        return;
      }
      await session.send(trimmed, { model, reasoningEffort });
    },
    [deepResearch, model, reasoningEffort, routeDeepResearchCommand, session],
  );

  const editMessage = useCallback(
    (messageIndex: number, text: string, branchGroupId: string) => {
      if (routeDeepResearchCommand(text, { branchGroupId })) return;
      void session.send(text, {
        model,
        reasoningEffort,
        historyOverride: session.messages.slice(0, messageIndex),
        branchGroupId,
        // An edit rewrites the words, not what they were about: the screenshot
        // the question referred to has to come with it.
        attachments: reusableChatAttachments(
          session.messages[messageIndex]?.attachments,
        ),
      });
    },
    [model, reasoningEffort, routeDeepResearchCommand, session],
  );

  const selectBranch = useCallback(
    (messages: typeof session.messages) => session.setMessages(messages),
    [session],
  );

  const sendSuggestedPrompt = useCallback(
    (text: string) => {
      if (busy || session.loadingSession) return;
      if (routeMaxResearchCommand(text)) return;
      if (routeDeepResearchCommand(text)) return;
      if (deepResearch.agent) {
        void deepResearch.launch(text);
        return;
      }
      void session.send(text, { model, reasoningEffort });
    },
    [
      busy,
      deepResearch,
      model,
      reasoningEffort,
      routeMaxResearchCommand,
      routeDeepResearchCommand,
      session,
    ],
  );

  const retryMessage = useCallback(
    (userMessageIndex: number, branchGroupId: string) => {
      const previousUser = session.messages[userMessageIndex];
      if (previousUser) {
        if (routeMaxResearchCommand(previousUser.content, { branchGroupId })) {
        return;
      }
      if (routeDeepResearchCommand(previousUser.content, { branchGroupId })) {
          return;
        }
        void session.send(previousUser.content, {
          model,
          reasoningEffort,
          historyOverride: session.messages.slice(0, userMessageIndex),
          branchGroupId,
          // Regenerating re-asks the same question, and an attached image is
          // half of it. Without this the retry reached the model as bare text
          // and it answered that nothing had been attached.
          attachments: reusableChatAttachments(previousUser.attachments),
        });
      }
    },
    [model, reasoningEffort, routeDeepResearchCommand, session],
  );

  function startNewChat() {
    deepResearch.clear();
    codex.clear();
    openCode.clear();
    ruflo.clear();
    session.reset();
    setInput("");
    // The unstarted chat's draft is deliberately left alone. It is only ever
    // written by someone typing into a blank composer and never sending, and
    // since a send clears it explicitly, anything still in it is an unsent
    // message — the one kind of text nothing else has a copy of. Clearing it
    // here used to be harmless because an unsent draft was carried onto
    // whichever chat opened next; now that it stays where it was written,
    // this was the only thing that could destroy it.
    setView("chat");
  }

  function openHistorySession(item: RuntimeHistorySession) {
    if (item.gardenId !== gardenSlug) return;
    codex.clear();
    openCode.clear();
    ruflo.clear();
    void session.openSession(item.id);
    setView("chat");
  }

  // The route stops whatever the chat still has running before it removes the
  // rows, so a streaming response is no longer a reason to refuse the delete —
  // and since that stopping is round trips of its own, the row leaves on the
  // click and the request finishes behind it. deleteChatSession hides the id
  // from history until the server answers, so a refresh that overlaps the
  // delete cannot ghost the row back. Only a refusal brings it back.
  async function deleteHistorySession(item: RuntimeHistorySession) {
    const confirmed = await confirm({
      title: "Delete this chat?",
      subject: `“${item.title}”`,
      body: "Anything it is still running is stopped, and its messages and any artifacts it produced are removed for good.",
      confirmLabel: "Delete chat",
    });
    if (!confirmed) return;
    setHistoryError(null);
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    // The open chat is on its way out; fall back to an empty one.
    if (item.id === session.sessionId) startNewChat();
    const result = await deleteChatSession(item.id);
    if (!result.deleted) {
      setHistoryError(result.error ?? "This chat could not be deleted.");
      // The chat is still on the server: reload rather than reinsert, so it
      // comes back where it actually belongs in the list.
      notifyHermesSessionsChanged("garden_chat");
      return;
    }
    invalidateHermesSessionSummaries("garden_chat");
    // The draft goes only once the chat is really gone.
    forgetChatDrafts(window.localStorage, draftSurface, [item.id]);
  }

  function toggleView(next: PanelView) {
    setView((current) => (current === next ? "chat" : next));
  }

  const headerButton =
    "neu-button rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-900";
  const activeHeaderButton =
    "neu-button neu-selected rounded-md border border-gray-500 bg-gray-800 px-2 py-1 text-[11px] text-white";

  return (
    <div className="bb-neu-tray neu-surface-raised fixed bottom-4 right-4 z-50 flex h-[76vh] w-[480px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <header className="bb-neu-toolbar flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">
            {gardenName ?? gardenSlug}
          </p>
          <p className="truncate text-[11px] text-gray-500">
            Garden agent · grounded, proposal-only · Hermes
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
            onClick={() => toggleView("scheduled")}
            className={view === "scheduled" ? activeHeaderButton : headerButton}
            title="Chats scheduled to open in this garden"
          >
            Scheduled
          </button>
          <button
            type="button"
            onClick={() => toggleView("proposals")}
            className={`relative ${view === "proposals" ? activeHeaderButton : headerButton}`}
          >
            Proposals
            {proposals.length > 0 ? (
              <span className="ml-1 rounded-full bg-amber-600 px-1.5 text-[10px] text-white">
                {proposals.length}
              </span>
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
          <button
            type="button"
            onClick={() => toggleView("review")}
            className={`inline-flex items-center ${
              view === "review" ? activeHeaderButton : headerButton
            }`}
            title="Spaced repetition settings for this garden"
            aria-label="Spaced repetition settings"
          >
            <SettingsGearIcon className="h-3.5 w-3.5 shrink-0" />
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
            <p className="mb-2 px-1 text-[11px] text-[#a45f56]">
              {historyError}
            </p>
          ) : null}
          {historyLoading && history.length === 0 ? (
            <ChatHistoryLoading />
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">
              No chats in this garden yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {history.map((item) => (
                <li
                  key={item.id}
                  className={`bb-neu-conversation-row group flex items-center gap-1 rounded-md transition ${
                    item.id === session.sessionId
                      ? "bb-neu-conversation-row-selected bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openHistorySession(item)}
                    onMouseEnter={() => {
                      void prefetchHermesSessionDetail("garden_chat", item.id).catch(
                        () => undefined,
                      );
                    }}
                    onFocus={() => {
                      void prefetchHermesSessionDetail("garden_chat", item.id).catch(
                        () => undefined,
                      );
                    }}
                    onPointerDown={() => {
                      void prefetchHermesSessionDetail("garden_chat", item.id).catch(
                        () => undefined,
                      );
                    }}
                    className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-600">
                        {formatChatTime(item.updatedAt)}
                      </span>
                    </div>
                  </button>
                  {(
                    item.id === session.sessionId
                      ? currentChatActive
                      : item.active
                  ) ? (
                    <ActiveChatIcon
                      label={`${item.title} is running`}
                      className="h-3.5 w-3.5"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void deleteHistorySession(item)}
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
      ) : view === "scheduled" ? (
        // Garden chat has no side rail, so scheduling is a view here — the same
        // panel the Terminal shows, pointed at this garden.
        <TerminalScheduledPanel surface="garden_chat" gardenSlug={gardenSlug} />
      ) : view === "review" ? (
        <ReviewSettingsPanel
          gardenSlug={gardenSlug}
          onClose={() => setView("chat")}
        />
      ) : view === "artifacts" ? (
        <ArtifactPanel
          compact
          hideHeader
          gardenSlug={gardenSlug}
          sourceSurface="garden_chat"
          creationConversationId={session.sessionId}
          ensureCreationConversation={session.ensureConversation}
        />
      ) : view === "proposals" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {proposals.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">
              No pending proposals.
            </p>
          ) : (
            <ul className="space-y-3">
              {proposals.map((proposal) => (
                <li
                  key={proposal.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                      {proposal.kind.replace("_", " ")}
                    </span>
                    {proposal.pageSlug ? (
                      <span className="truncate text-[10px] text-gray-500">
                        {proposal.pageSlug}
                      </span>
                    ) : null}
                  </div>
                  {proposal.rationale ? (
                    <p className="mt-2 text-xs text-gray-300">
                      {proposal.rationale}
                    </p>
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
          gardenSlug={gardenSlug}
          messages={session.messages}
          connection={session.connection}
          runState={session.runState}
          externalRunLaunching={externalRunLaunching}
          steerError={session.steerError}
          error={session.error}
          pendingPermission={session.pendingPermission}
          activities={session.activities}
          input={input}
          onInputChange={setInput}
          onSubmit={submit}
          onRunWorkflow={runWorkflowAutomation}
          onAskSelection={askSelection}
          onSteer={steer}
          steerableRun={Boolean(session.activeRunId)}
          onSendQueued={sendQueued}
          onEditMessage={editMessage}
          onDeleteMessage={session.deleteMessage}
          onSelectBranch={selectBranch}
          onAbort={() => void session.abort()}
          onPermissionDecision={(decision) =>
            void session.respondToPermission(decision)
          }
          onRetryMessage={retryMessage}
          onExternalAgentTerminal={handleExternalAgentTerminal}
          placeholder={`Ask about ${gardenName ?? "this garden"}…`}
          model={selectedModel}
          models={models}
          onModelChange={changeModel}
          reasoningEffort={selectedReasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          intelligenceModes={selectedIntelligenceModes}
          modelFailover={modelFailover}
          statusMessage={researchNotice}
          deepResearchAgent={deepResearch.agent}
          onSelectDeepResearch={() => {
            codex.clear();
            openCode.clear();
            ruflo.clear();
            void deepResearch.select();
          }}
          onClearDeepResearch={() => {
            deepResearch.clear();
            setResearchNotice("");
          }}
          openCodeAgent={openCode.agent}
          onSelectOpenCode={() => {
            deepResearch.clear();
            codex.clear();
            ruflo.clear();
            void openCode.select();
          }}
          onClearOpenCode={() => {
            openCode.clear();
            setResearchNotice("");
          }}
          codexAgent={codex.agent}
          onSelectCodex={() => {
            deepResearch.clear();
            openCode.clear();
            ruflo.clear();
            void codex.select();
          }}
          onClearCodex={() => {
            codex.clear();
            setResearchNotice("");
          }}
          rufloAgent={ruflo.agent}
          onSelectRuflo={() => {
            deepResearch.clear();
            codex.clear();
            openCode.clear();
            void ruflo.select();
          }}
          onClearRuflo={() => {
            ruflo.clear();
            setResearchNotice("");
          }}
          loadingTranscript={session.loadingSession}
          emptyState={
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <div>
                <p className="text-sm font-medium text-gray-200">Assistant</p>
                <p className="mt-1.5 text-xs text-gray-500">
                  Grounded answers with citations. Ask it to trace a source,
                  compare sections, find gaps, quiz you, or propose a
                  correction.
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

      {confirmDialog}
    </div>
  );
}
