"use client";

import { useEffect, useState } from "react";
import { History, Plus } from "lucide-react";
import AgentRuntimePanel from "@/app/components/hermes/agent-runtime-panel";
import { useAgentSession } from "@/app/components/hermes/use-agent-session";
import { useChatDraft } from "@/app/components/hermes/use-chat-draft";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import { UnreadChatDot } from "@/app/components/hermes/history-client";
import { loadHermesSessionSummaries, type HermesSessionSnapshot } from "@/lib/hermes/session-client";
import { useChatNotificationView } from "@/lib/use-chat-notification-view";
import { useUnreadChats } from "@/lib/conversations/unread-client";

/** Chats are kept per video, like the PDF assistant keeps them per document. */
export function videoAssistantKey(artifactId: string | null): string {
  const hex = (artifactId ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return `video:${(hex + "0".repeat(16)).slice(0, 16)}`;
}

const STARTERS = [
  "Cut the silences and tighten the pacing",
  "Add captions from what is said",
  "Trim it to the best 30 seconds",
  "Add a title card at the start",
];

interface Props {
  source: { id: string; title: string } | null;
  /** Text to put in the composer (from Make a shot); cleared once placed. */
  prefill: string | null;
  onPrefillHandled: () => void;
}

/** Bread, dedicated to the video open in Video Studio: its own chats, context and starters. */
export default function VideoAssistant({ source, prefill, onPrefillHandled }: Props) {
  const key = videoAssistantKey(source?.id ?? null);
  const title = source?.title ?? "Video Studio";
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HermesSessionSnapshot[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const session = useAgentSession("dashboard_terminal", { pageSlug: key, pageTitle: title, title: `Video · ${title}` });
  const intelligence = useAssistantIntelligence({ scope: key, sessionId: session.sessionId, createdSessionId: session.createdSessionId, shared: true });
  const { models } = useAssistantModels({ eager: true });
  const { unreadChats } = useUnreadChats();
  const busy = ["connecting", "streaming", "waiting"].includes(session.connection);
  useChatNotificationView(session.sessionId ? { surface: "dashboard_terminal", chatId: session.sessionId } : null);
  useChatDraft({ surface: key, sessionId: session.sessionId, createdSessionId: session.createdSessionId, value: input, onRestore: setInput });

  useEffect(() => {
    if (prefill === null) return;
    setInput(prefill);
    onPrefillHandled();
  }, [prefill, onPrefillHandled]);

  async function send(text: string) {
    text = text.trim();
    if (!text) return;
    // The composer empties as soon as the message is sent, not when Bread's answer ends.
    setInput("");
    try {
      if (session.pendingClarification) await session.respondToClarification(text);
      else await session.send(text, { model: intelligence.model, reasoningEffort: intelligence.reasoningEffort });
    } catch {
      setInput(current => current || text);
    }
  }

  async function toggleHistory() {
    if (historyOpen) return setHistoryOpen(false);
    setHistoryOpen(true);
    setHistoryError(null);
    try {
      setHistory((await loadHermesSessionSummaries("dashboard_terminal", { force: true })).filter(item => item.pageSlug === key));
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "History could not be loaded.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--paper-bg)] text-[var(--ink)]" aria-label="Video assistant">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink-heading)]">Video assistant</p>
        <button type="button" disabled={busy} onClick={() => { session.reset(); setInput(""); setHistoryOpen(false); }}
          className="neu-button rounded-md border border-[var(--line)] p-1.5 disabled:opacity-40" title="New chat" aria-label="New video chat">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => void toggleHistory()} aria-expanded={historyOpen}
          className="neu-button rounded-md border border-[var(--line)] p-1.5" title="Chat history" aria-label="Video chat history">
          <History className="h-4 w-4" />
        </button>
      </div>
      {historyOpen && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-[var(--line)] p-2" aria-label="Video conversations">
          {historyError ? <p role="alert" className="p-2 text-xs">{historyError} <button type="button" className="underline" onClick={() => { setHistoryOpen(false); void toggleHistory(); }}>Try again</button></p>
            : history === null ? <p className="p-2 text-xs text-[var(--ink-muted)]">Loading history…</p>
            : !history.length ? <p className="p-2 text-xs text-[var(--ink-muted)]">No conversations for this video yet.</p>
            : history.map(item => (
              <button key={String(item.id)} type="button" disabled={busy}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-[var(--selection-highlight-blue)] disabled:opacity-40"
                onClick={() => { void session.openSession(String(item.id)); setHistoryOpen(false); }}>
                <span className="min-w-0 flex-1 truncate">{String(item.title || "Video chat")}</span>
                {!item.active && unreadChats.has(String(item.id)) ? <UnreadChatDot label={`${item.title || "Video chat"} — unread`} /> : null}
              </button>
            ))}
        </div>
      )}
      <AgentRuntimePanel
        compact
        surface="dashboard_terminal"
        suggestionPageTitle={title}
        sessionId={session.sessionId}
        createdSessionId={session.createdSessionId}
        messages={session.messages}
        appendExternalAgentTurn={session.appendExternalAgentTurn}
        connection={session.connection}
        runState={session.runState}
        steerError={session.steerError}
        error={session.error}
        pendingPermission={session.pendingPermission}
        pendingClarification={session.pendingClarification}
        activities={session.activities}
        input={input}
        onInputChange={setInput}
        onSubmit={() => void send(input)}
        onSteer={(text, attachments) => session.steer(text, attachments as never)}
        steerableRun={Boolean(session.activeRunId)}
        onSendQueued={text => send(text)}
        onAbort={() => void session.abort()}
        onPermissionDecision={decision => void session.respondToPermission(decision)}
        onClarificationAnswer={answer => void session.respondToClarification(answer)}
        onEditAssistantMessage={session.editAssistantMessage}
        onDeleteMessage={session.deleteMessage}
        onRetryMessage={index => {
          const message = session.messages[index];
          if (message?.role === "user") void session.send(message.content, { historyOverride: session.messages.slice(0, index), model: intelligence.model });
        }}
        model={intelligence.model}
        models={models}
        onModelChange={model => {
          if (model === intelligence.model) return;
          void session.queueModelChange(model).catch(() => undefined);
          intelligence.setModel(model);
        }}
        reasoningEffort={intelligence.reasoningEffort}
        onReasoningEffortChange={intelligence.setReasoningEffort}
        intelligenceModes={intelligence.intelligenceModes}
        disabled={session.loadingSession}
        loadingTranscript={session.loadingSession}
        placeholder={source ? `Ask Bread to edit ${title}…` : "Ask Bread to edit your video…"}
        emptyState={
          <div className="flex flex-col gap-2 px-4 py-6">
            <p className="text-sm text-[var(--ink-heading)]">{source ? "What should Bread change in this video?" : "Bring a clip into the editor, then tell Bread what to change."}</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map(starter => (
                <button key={starter} type="button" onClick={() => setInput(starter)}
                  className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-left text-xs">{starter}</button>
              ))}
            </div>
          </div>
        }
        beforeComposer={source ? (
          <div className="mb-1 truncate px-3 text-[11px] leading-5 text-[var(--ink-muted)]" title={title}>Editing {title}</div>
        ) : undefined}
      />
    </div>
  );
}
