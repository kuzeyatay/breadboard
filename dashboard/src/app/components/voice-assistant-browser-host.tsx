'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';
import { voiceCompanionBridge } from '@/lib/speech/voice-window';
import VoiceAssistantRuntime from './voice-assistant-runtime';

/** Browser fallback elects one page; Electron has its own persistent voice window. */
export default function VoiceAssistantBrowserHost() {
  const path = usePathname();
  const allowed = !/^\/(?:api|notification-overlay|preview|login|register|auth|share|embed)(?:\/|$)/.test(path);
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (!allowed || desktopTabsBridge() || voiceCompanionBridge() || !navigator.locks) return;
    const controller = new AbortController();
    let release = () => {};
    const done = new Promise<void>(resolve => { release = resolve; });
    void navigator.locks.request('breadboard:voice-assistant-browser-owner', { signal: controller.signal }, async () => {
      if (controller.signal.aborted) return;
      setOwner(true); await done;
    }).catch(() => {});
    return () => { controller.abort(); release(); setOwner(false); };
  }, [allowed]);
  return allowed && owner ? <VoiceAssistantRuntime /> : null;
}
