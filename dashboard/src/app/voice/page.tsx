'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import VoiceConversationOverlay from '@/app/components/voice-conversation-overlay';
import VoiceAssistantRuntime from '@/app/components/voice-assistant-runtime';
import { useAgentSession, isActiveAgentRunState } from '@/app/components/hermes/use-agent-session';
import { useAssistantIntelligence } from '@/app/components/use-assistant-intelligence';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';
import type { VoiceMessage } from '@/lib/speech/voice-conversation';
import { setActiveChatNotificationTarget } from '@/lib/chat-notification-inbox';

function Conversation({ onClose }: { onClose: () => void }) {
  const options = useMemo(() => ({ voice: true, restoreLastConversation: false }), []);
  const session = useAgentSession('dashboard_terminal', options);
  const intelligence = useAssistantIntelligence();
  const current = useRef({ session, intelligence });
  useLayoutEffect(() => { current.current = { session, intelligence }; });
  useEffect(() => {
    setActiveChatNotificationTarget(session.sessionId ? { surface: 'dashboard_terminal', chatId: session.sessionId } : null);
    return () => setActiveChatNotificationTarget(null);
  }, [session.sessionId]);
  const send = useCallback((text: string) => {
    const { session, intelligence } = current.current;
    void session.send(text, { model: intelligence.model, reasoningEffort: intelligence.reasoningEffort });
  }, []);
  const messages: readonly VoiceMessage[] = useMemo(() => {
    if (!session.error || isActiveAgentRunState(session.runState)) return session.messages;
    return [...session.messages, { role: 'assistant' as const, content: session.error }];
  }, [session.error, session.runState, session.messages]);
  useEffect(() => {
    const title = session.messages.find(message => message.role === 'user')?.content.trim().slice(0, 70);
    document.title = title ? `Voice: ${title}` : 'Voice';
  }, [session.messages]);
  return <VoiceConversationOverlay open={!session.loadingSession} compact greetOnOpen onClose={onClose}
    onSend={send} messages={messages} busy={isActiveAgentRunState(session.runState)}
    notice={session.pendingPermission ? <div className="voice-note" role="alert">
      <p>{session.pendingPermission.description}</p>
      <div className="voice-permission-actions">
        <button className="voice-chip" onClick={() => void session.respondToPermission('once')}>Allow once</button>
        <button className="voice-chip" onClick={() => void session.respondToPermission('reject')}>Decline</button>
      </div>
    </div> : session.pendingClarification ? <div className="voice-note" role="status">
      <p>{session.pendingClarification.question}</p>
      <p>Tap the ring to answer aloud.</p>
    </div> : session.error ? <p className="voice-note" role="alert">{session.error}</p> : null} />;
}

export default function VoicePage() {
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.voiceWidget = 'true';
    return () => { delete document.documentElement.dataset.voiceWidget; };
  }, []);
  useEffect(() => {
    const bridge = voiceCompanionBridge();
    if (!bridge) {
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    let alive = true;
    const unsubscribe = bridge.onOpen(setOpen);
    void bridge.state().then(value => { if (alive) { setNative(true); setOpen(value); } });
    return () => { alive = false; unsubscribe(); };
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const bridge = voiceCompanionBridge();
    if (bridge) void bridge.close();
    else { window.close(); if (!window.closed) window.location.assign('/profile'); }
  }, []);
  return <main className="voice-companion-page">
    {native && <VoiceAssistantRuntime conversationOpen={open} />}
    {open ? <Conversation onClose={close} /> : null}
    <div className="voice-companion-drag" aria-hidden />
  </main>;
}
