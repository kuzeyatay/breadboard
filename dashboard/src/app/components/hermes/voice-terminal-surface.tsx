'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import VoiceConversationOverlay from '@/app/components/voice-conversation-overlay';
import { prepareVoiceConversation } from '@/lib/speech/voice-conversation-preparation';
import { voiceHostMessages } from '@/lib/speech/voice-host-messages';
import type { SpokenExchange } from '@/lib/speech/chatgpt-voice';
import { isActiveAgentRunState, type AgentMessage, type useAgentSession } from './use-agent-session';

export interface VoiceTerminalSurfaceOptions { onClose: () => void; compact: boolean }
interface Props extends VoiceTerminalSurfaceOptions {
  session: ReturnType<typeof useAgentSession>;
  messages: readonly AgentMessage[];
  busy: boolean;
  onSend: (text: string, context?: import('@/lib/speech/voice-screen-context').VoiceScreenContext) => Promise<void>;
  onInterrupt: () => void | Promise<void>;
  notice?: ReactNode;
  personalizedGreeting?: boolean;
}

/** Presentation only: the normal Terminal owns tools, workers and cancellation. */
export default function VoiceTerminalSurface({ session, messages, busy, onSend, onInterrupt, notice, onClose, compact, personalizedGreeting = false }: Props) {
  const current = useRef(session);
  useLayoutEffect(() => { current.current = session; });
  useEffect(() => {
    const controller = new AbortController();
    void prepareVoiceConversation(() => current.current.ensureConversation(), controller.signal).catch(() => {});
    return () => controller.abort();
  }, []);
  const visible = useMemo(() => {
    const publicMessages = voiceHostMessages(messages, session.activities, busy);
    if (!session.error || isActiveAgentRunState(session.runState)) return publicMessages;
    return [...publicMessages, { role: 'assistant' as const, content: session.error }];
  }, [messages, session.activities, session.error, session.runState, busy]);
  useEffect(() => {
    const title = messages.find(message => message.role === 'user' && !message.internalAgentContinuation)?.content.trim().slice(0, 70);
    document.title = title ? `Voice: ${title}` : 'Voice';
  }, [messages]);
  const record = useCallback((exchange: SpokenExchange) => current.current.appendExternalAgentTurn({
    clientMessageId: exchange.clientMessageId, userContent: exchange.user, assistantContent: exchange.assistant, outcome: 'completed',
  }), []);
  return <VoiceConversationOverlay open={!session.loadingSession} compact={compact} closeOnTabChange={false} greetOnOpen onClose={onClose}
    personalizedGreeting={personalizedGreeting}
    notificationTarget={session.sessionId ? { surface: 'dashboard_terminal', chatId: session.sessionId } : null}
    onSend={onSend} onInterrupt={onInterrupt} onRecord={record} messages={visible} busy={busy}
    clarification={session.pendingClarification}
    notice={<>
      {notice ? <div className="voice-note">{notice}</div> : null}
      {session.pendingPermission ? <div className="voice-note" role="alert">
        <p>{session.pendingPermission.description}</p>
        <div className="voice-permission-actions">
          <button className="voice-chip" onClick={() => void session.respondToPermission('once')}>Allow once</button>
          <button className="voice-chip" onClick={() => void session.respondToPermission('reject')}>Decline</button>
        </div>
      </div> : session.error ? <p className="voice-note" role="alert">{session.error}</p> : null}
    </>} />;
}
