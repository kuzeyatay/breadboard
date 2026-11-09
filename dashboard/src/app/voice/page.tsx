'use client';
import { useCallback, useEffect, useState } from 'react';
import DashboardAgentTerminal from '@/app/components/hermes/dashboard-agent-terminal';
import VoiceAssistantRuntime from '@/app/components/voice-assistant-runtime';
import LinkedVoiceConversation from '@/app/components/linked-voice-conversation';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';

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
      : <DashboardAgentTerminal scope="mine" restoreOwnerKey="voice-companion" presentation="voice" voiceSurface={{ onClose: close, compact }} /> : null}
    {compact && <div className="voice-companion-drag" aria-hidden />}
  </main>;
}
