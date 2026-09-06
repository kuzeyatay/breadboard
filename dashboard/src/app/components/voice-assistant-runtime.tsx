'use client';
import { useEffect, useRef } from 'react';
import { DEFAULT_VOICE_ASSISTANT, VOICE_ASSISTANT_CHANNEL, parseVoiceAssistantPreferences } from '@/lib/speech/assistant-preferences';
import { listenForHeyBread } from '@/lib/speech/wake-listener';
import { speakNotification } from '@/lib/speech/notification-speech';
import { AUDIO_FOCUS_EVENT, audioFocusChannel, foregroundAudioActive, holdForegroundAudio } from '@/lib/speech/clap/audio-focus';
import { openVoiceWindow, voiceCompanionBridge } from '@/lib/speech/voice-window';
import { activeChatNotificationTarget, isChatNotificationRecord } from '@/lib/chat-notification-inbox';

export default function VoiceAssistantRuntime({ conversationOpen = false }: { conversationOpen?: boolean }) {
  const openRef = useRef(conversationOpen); openRef.current = conversationOpen;
  useEffect(() => {
    let alive = true, preferences = DEFAULT_VOICE_ASSISTANT, userId = '', provider = '', polling = false;
    let wake: AbortController | null = null, speech: AbortController | null = null, busy = false, retryAt = 0;
    let lastStatus = '', baseline = false;
    const seen = new Set<string>(), pending: string[] = [];
    const lifecycle = new AbortController(), channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    const status = (message: string) => { lastStatus = message; channel.postMessage({ type: 'status', message }); };
    const stopWake = () => { wake?.abort(); wake = null; };
    function sync() {
      if (!alive) return;
      const blocked = foregroundAudioActive() || openRef.current || busy;
      if (!preferences.alwaysOnVoiceAssistant || blocked) {
        stopWake();
        if (preferences.alwaysOnVoiceAssistant) status('“Hey Bread” is paused during audio.');
      } else if (!wake && userId && Date.now() >= retryAt) {
        const controller = new AbortController(); wake = controller;
        void navigator.locks.request(`breadboard:wake-owner:${userId}`, { signal: controller.signal }, () => listenForHeyBread(controller.signal, () => {
          stopWake(); retryAt = Date.now() + 2500;
          void openVoiceWindow().catch(error => status(error.message));
        }, status)).catch(error => {
          if (!controller.signal.aborted) { status(error.message || 'Allow microphone access to use “Hey Bread”.'); retryAt = Date.now() + 15_000; }
        }).finally(() => { if (wake === controller) wake = null; });
      }
      if (preferences.readAloudNotifications && pending.length && !blocked && !speech) {
        busy = true; stopWake();
        const controller = new AbortController(); speech = controller;
        const release = holdForegroundAudio();
        void speakNotification(pending.shift()!, controller.signal).catch(error => { if (!controller.signal.aborted) status(error.message); })
          .finally(() => { release(); speech = null; busy = false; retryAt = Date.now() + 800; });
      }
    }
    function enqueue(notice: { message: string; title?: string; response?: string; dismissed?: boolean }) {
      if (!preferences.readAloudNotifications || notice.dismissed) return;
      const text = [notice.title, notice.message, notice.response].filter(Boolean).join('. ');
      if (text.trim()) { pending.push(text); if (pending.length > 20) pending.shift(); sync(); }
    }
    const removeNotifications = voiceCompanionBridge()?.onNotification(enqueue);
    channel.onmessage = event => {
      if (event.data.type === 'preferences') { retryAt = 0; void refresh(); }
      if (event.data.type === 'status-request') status(lastStatus);
      if (event.data.type === 'notification') enqueue(event.data.notice);
    };
    async function refresh() {
      if (polling) return; polling = true;
      try {
        const response = await fetch('/api/profile/voice-assistant', { cache: 'no-store', signal: lifecycle.signal });
        if (!response.ok) { preferences = DEFAULT_VOICE_ASSISTANT; userId = ''; stopWake(); speech?.abort(); pending.length = 0; baseline = false; return; }
        const body = await response.json();
        if (!alive) return;
        if (body.userId !== userId) { stopWake(); speech?.abort(); pending.length = 0; seen.clear(); baseline = false; }
        userId = body.userId; preferences = parseVoiceAssistantPreferences(body.preferences) ?? DEFAULT_VOICE_ASSISTANT;
        if (!preferences.readAloudNotifications) { pending.length = 0; speech?.abort(); baseline = false; }
        if (preferences.alwaysOnVoiceAssistant || preferences.readAloudNotifications) {
          const settings = await fetch('/api/speech/settings', { cache: 'no-store', signal: lifecycle.signal }).then(r => r.json());
          const nextProvider = settings.settings?.speechProvider;
          if (nextProvider !== provider) { provider = nextProvider; stopWake(); }
        }
        if (preferences.readAloudNotifications) {
          const response = await fetch('/api/chat-notifications', { cache: 'no-store', signal: lifecycle.signal });
          if (response.ok) {
            const inbox = await response.json();
            for (const record of (Array.isArray(inbox.messages) ? inbox.messages : []).filter(isChatNotificationRecord)) {
              const key = `${record.id}:${record.updatedAt}`;
              if (!seen.has(key) && baseline && record.target.chatId !== activeChatNotificationTarget()?.chatId) enqueue({ title: record.title, message: record.chatTitle, response: record.response || record.message });
              seen.add(key);
            }
            baseline = true;
          }
        }
        sync();
      } catch (error) { if (alive && !lifecycle.signal.aborted) status(error instanceof Error ? error.message : 'Voice settings could not load.'); }
      finally { polling = false; }
    }
    audioFocusChannel(); window.addEventListener(AUDIO_FOCUS_EVENT, sync);
    void refresh(); const poll = window.setInterval(() => void refresh(), 3000), tick = window.setInterval(sync, 500);
    return () => { alive = false; lifecycle.abort(); stopWake(); speech?.abort(); channel.close(); removeNotifications?.(); window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener(AUDIO_FOCUS_EVENT, sync); };
  }, []);
  return null;
}
