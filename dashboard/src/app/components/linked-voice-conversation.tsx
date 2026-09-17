'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectVoiceChat, type VoiceChatSnapshot } from '@/lib/speech/voice-chat-link';
import VoiceConversationOverlay from './voice-conversation-overlay';

export default function LinkedVoiceConversation({ conversationKey, compact, onClose }: {
  conversationKey: string;
  compact: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<VoiceChatSnapshot | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const connection = useRef<ReturnType<typeof connectVoiceChat> | null>(null);
  useEffect(() => {
    const link = connectVoiceChat(conversationKey, setSnapshot, () => setDisconnected(true));
    connection.current = link;
    return () => { connection.current = null; link.close(); };
  }, [conversationKey]);
  const send = useCallback((text: string) => connection.current?.send(text), []);
  if (disconnected) return <div className="voice-note" role="alert">
    <p>The original chat is no longer connected. Reopen voice from that chat.</p>
    <button type="button" className="voice-action" onClick={onClose}>Close voice</button>
  </div>;
  if (!snapshot) return null;
  return <VoiceConversationOverlay open compact={compact} closeOnTabChange={false} greetOnOpen
    onClose={onClose} onSend={send} messages={snapshot.messages} busy={snapshot.busy} clarification={snapshot.clarification} />;
}
