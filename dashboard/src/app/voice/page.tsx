'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import VoiceConversationOverlay from '@/app/components/voice-conversation-overlay';
import VoiceAssistantRuntime from '@/app/components/voice-assistant-runtime';
import LinkedVoiceConversation from '@/app/components/linked-voice-conversation';
import { useAgentSession, isActiveAgentRunState } from '@/app/components/hermes/use-agent-session';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';
import type { VoiceMessage } from '@/lib/speech/voice-conversation';
import type { SpokenExchange } from '@/lib/speech/chatgpt-voice';
import { useChatNotificationView } from '@/lib/use-chat-notification-view';
import { voiceRequestOptions } from '@/lib/speech/voice-request';

function Conversation({ onClose, compact }: { onClose: () => void; compact: boolean }) {
  const options = useMemo(() => ({ voice: true, restoreLastConversation: false }), []);
  const session = useAgentSession('dashboard_terminal', options);
  const current = useRef(session);
  useLayoutEffect(() => { current.current = session; });
  useChatNotificationView(session.sessionId ? { surface: 'dashboard_terminal', chatId: session.sessionId } : null);
  const send = useCallback(async (text: string) => {
    const session = current.current;
    return session.send(text, await voiceRequestOptions());
  }, []);
  const messages: readonly VoiceMessage[] = useMemo(() => {
    if (!session.error || isActiveAgentRunState(session.runState)) return session.messages;
    return [...session.messages, { role: 'assistant' as const, content: session.error }];
  }, [session.error, session.runState, session.messages]);
  useEffect(() => {
    const title = session.messages.find(message => message.role === 'user')?.content.trim().slice(0, 70);
    document.title = title ? `Voice: ${title}` : 'Voice';
  }, [session.messages]);
  const record = useCallback((exchange: SpokenExchange) => current.current.appendExternalAgentTurn({
    clientMessageId: exchange.clientMessageId, userContent: exchange.user, assistantContent: exchange.assistant, outcome: 'completed',
  }), []);
  return <VoiceConversationOverlay open={!session.loadingSession} compact={compact} closeOnTabChange={false} greetOnOpen onClose={onClose}
    onSend={send} onInterrupt={session.abort} onRecord={record} messages={messages} busy={isActiveAgentRunState(session.runState)}
    clarification={session.pendingClarification}
    notice={session.pendingPermission ? <div className="voice-note" role="alert">
      <p>{session.pendingPermission.description}</p>
      <div className="voice-permission-actions">
        <button className="voice-chip" onClick={() => void session.respondToPermission('once')}>Allow once</button>
        <button className="voice-chip" onClick={() => void session.respondToPermission('reject')}>Decline</button>
      </div>
    </div> : session.error ? <p className="voice-note" role="alert">{session.error}</p> : null} />;
}

export default function VoicePage() {
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState(false);
  const [compact, setCompact] = useState(true);
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  useEffect(() => {
    const bridge = voiceCompanionBridge();
    const compact = Boolean(bridge) || new URLSearchParams(window.location.search).get('view') !== 'full';
    if (compact) document.documentElement.dataset.voiceWidget = 'true';
    const frame = requestAnimationFrame(() => {
      setCompact(compact);
      if (!bridge) {
        setConversationKey(new URLSearchParams(window.location.search).get('chat'));
        setOpen(true);
      }
    });
    let alive = true;
    let receivedOpen = false;
    const unsubscribe = bridge?.onOpen((value, key) => {
      receivedOpen = true;
      setNative(true);
      setConversationKey(key ?? null);
      setOpen(value);
    });
    if (bridge) void Promise.all([bridge.state(), bridge.conversation?.() ?? null]).then(([value, key]) => {
      if (alive && !receivedOpen) { setNative(true); setConversationKey(key); setOpen(value); }
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      unsubscribe?.();
      delete document.documentElement.dataset.voiceWidget;
    };
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const bridge = voiceCompanionBridge();
    const desktop = desktopTabsBridge();
    if (bridge) void bridge.close();
    else if (desktop) void desktop.tabs({ type: 'close' });
    else { window.close(); if (!window.closed) window.location.assign('/settings'); }
  }, []);
  return <main className="voice-companion-page">
    {native && <VoiceAssistantRuntime conversationOpen={open} />}
    {open ? conversationKey
      ? <LinkedVoiceConversation key={conversationKey} conversationKey={conversationKey} onClose={close} compact={compact} />
      : <Conversation onClose={close} compact={compact} /> : null}
    {compact && <div className="voice-companion-drag" aria-hidden />}
  </main>;
}
