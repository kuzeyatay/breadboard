'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectVoiceChat, type VoiceChatSnapshot } from '@/lib/speech/voice-chat-link';
import VoiceConversationOverlay from './voice-conversation-overlay';
import type { SpokenExchange } from '@/lib/speech/chatgpt-voice';
import { currentVoiceScreenContext, type VoiceScreenContext } from '@/lib/speech/voice-screen-context';

export default function LinkedVoiceConversation({ conversationKey, compact, onClose }: {
  conversationKey: string;
  compact: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<VoiceChatSnapshot | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState('');
  const connection = useRef<ReturnType<typeof connectVoiceChat> | null>(null);
  useEffect(() => {
    const link = connectVoiceChat(conversationKey, setSnapshot, () => setDisconnected(true), setError);
    connection.current = link;
    return () => { connection.current = null; link.close(); };
  }, [conversationKey]);
  const send = useCallback(async (text: string, context?: VoiceScreenContext) => {
    setError('');
    const link = connection.current;
    try {
      const screen = await currentVoiceScreenContext();
      if (connection.current === link) link?.send(text, { ...context, ...screen });
    } catch {
      // A context failure must not replace this turn with the host's old tab.
      if (connection.current === link) link?.send(text, { ...context, browserAccess: null });
    }
  }, []);
  const interrupt = useCallback(() => connection.current?.interrupt(), []);
  const record = useCallback(async (exchange: SpokenExchange) => {
    if (!connection.current) throw new Error('The original chat is no longer connected.');
    await connection.current.record(exchange);
  }, []);
  if (disconnected) return <div className="voice-note" role="alert">
    <p>The original chat is no longer connected. Reopen voice from that chat.</p>
    <button type="button" className="voice-action" onClick={onClose}>Close voice</button>
  </div>;
  if (!snapshot) return null;
  return <VoiceConversationOverlay open compact={compact} closeOnTabChange={false} greetOnOpen
    personalizedGreeting={snapshot.personalizedGreeting === true}
    notificationTarget={snapshot.notificationTarget}
    onClose={onClose} onSend={send} onInterrupt={interrupt} onRecord={snapshot.recordable ? record : undefined} messages={snapshot.messages} busy={snapshot.busy} clarification={snapshot.clarification}
    notice={error ? <p className="voice-note" role="alert">{error}</p> : null} />;
}
