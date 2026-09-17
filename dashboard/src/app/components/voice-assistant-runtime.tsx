'use client';
import { useEffect, useRef } from 'react';
import { DEFAULT_VOICE_ASSISTANT, VOICE_ASSISTANT_CHANNEL, parseVoiceAssistantPreferences } from '@/lib/speech/assistant-preferences';
import { listenForHeyBread } from '@/lib/speech/wake-listener';
import { speakNotification } from '@/lib/speech/notification-speech';
import { notificationSpeechText, notificationSpeechKey, notificationSpeechId, notificationRequestTime, publishNotificationDelivery, publishNotificationInbox, type NotificationSpeechNotice, type NotificationInboxSnapshot } from '@/lib/speech/notification-events';
import { AUDIO_FOCUS_EVENT, audioFocusChannel, foregroundAudioActive, holdForegroundAudio } from '@/lib/speech/clap/audio-focus';
import { openVoiceWindow, voiceCompanionBridge } from '@/lib/speech/voice-window';
import { isChatNotificationRecordViewed, isChatNotificationRecord } from '@/lib/chat-notification-inbox';
import { preloadSubscriptionVoice, clearSubscriptionPreload } from '@/lib/speech/subscription-live';
import type { SpeechSettings } from '@/lib/speech/settings';

interface QueuedNotificationSpeech { id: string; key: string; text: string; inbox: boolean }

export default function VoiceAssistantRuntime({ conversationOpen = false }: { conversationOpen?: boolean }) {
  const openRef = useRef(conversationOpen); openRef.current = conversationOpen;
  useEffect(() => {
    let alive = true, preferences = DEFAULT_VOICE_ASSISTANT, userId = '', provider = '', polling = false;
    let wake: AbortController | null = null, speech: AbortController | null = null, busy = false, retryAt = 0;
    let lastStatus = '', baseline = false;
    let speechSettings: SpeechSettings | null = null;
    let preloadReady = Promise.resolve();
    const seen = new Set<string>(), dismissed = new Set<string>(), pending: QueuedNotificationSpeech[] = [];
    const delivered = new Map<string, NotificationSpeechNotice & { id: string }>();
    const deferredUntilPreferences = new Map<string, NotificationSpeechNotice & { id: string }>();
    let preferencesReady = false;
    let lastInbox: NotificationInboxSnapshot | null = null;
    let reading: QueuedNotificationSpeech | null = null;
    const lifecycle = new AbortController(), channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    const status = (message: string) => { lastStatus = message; channel.postMessage({ type: 'status', message }); };
    const stopWake = () => { wake?.abort(); wake = null; };
    function dismiss(ids: readonly string[]) {
      for (const id of ids) { dismissed.add(id); delivered.delete(id); deferredUntilPreferences.delete(id); }
      for (let index = pending.length - 1; index >= 0; index--) {
        if (dismissed.has(pending[index].id)) pending.splice(index, 1);
      }
      if (reading?.id && dismissed.has(reading.id)) speech?.abort();
    }
    function sync() {
      if (!alive) return;
      const blocked = foregroundAudioActive() || openRef.current || busy;
      // The companion owns at most the two available voice slots. External
      // audio gets them back; its own conversation/notification adopts them.
      if (speechSettings && userId && !(foregroundAudioActive() && !openRef.current && !busy)) {
        preloadReady = preloadSubscriptionVoice(userId, speechSettings, !preferences.alwaysOnVoiceAssistant, !openRef.current && !busy);
      } else {
        preloadReady = clearSubscriptionPreload();
      }
      if (!preferences.alwaysOnVoiceAssistant || blocked) {
        stopWake();
        if (preferences.alwaysOnVoiceAssistant) status('“Hey Bread” is paused during audio.');
      } else if (!wake && userId && Date.now() >= retryAt) {
        const controller = new AbortController(); wake = controller;
        void navigator.locks.request(`breadboard:wake-owner:${userId}`, { signal: controller.signal }, async () => {
          await preloadReady;
          controller.signal.throwIfAborted();
          return listenForHeyBread(controller.signal, () => {
            stopWake(); retryAt = Date.now() + 2500;
            void openVoiceWindow().catch(error => status(error.message));
          }, status);
        }).catch(error => {
          if (!controller.signal.aborted) { status(error.message || 'Allow microphone access to use “Hey Bread”.'); retryAt = Date.now() + 15_000; }
        }).finally(() => { if (wake === controller) wake = null; });
      }
      if (preferences.readAloudNotifications && pending.length && !blocked && !speech) {
        busy = true; stopWake();
        const controller = new AbortController(); speech = controller;
        reading = pending.shift()!;
        const release = holdForegroundAudio();
        void speakNotification(reading.text, controller.signal).catch(error => { if (!controller.signal.aborted) status(error.message); })
          .finally(() => { release(); speech = null; reading = null; busy = false; retryAt = Date.now() + 800; });
      }
    }
    function enqueue(notice: NotificationSpeechNotice & { id: string }, inbox = false, key = notificationSpeechKey(notice), force = false) {
      const { id } = notice;
      if (!preferences.readAloudNotifications || dismissed.has(id) || (!force && seen.has(key))) return;
      seen.add(key);
      const text = notificationSpeechText(notice);
      // A status update replaces an older queued revision of the same card.
      for (let index = pending.length - 1; index >= 0; index--) {
        if (pending[index].id === id) pending.splice(index, 1);
      }
      if (reading?.id === id && reading.key !== key) speech?.abort();
      if (text.trim()) { pending.push({ id, key, text, inbox }); if (pending.length > 20) pending.shift(); sync(); }
    }
    function receiveNotification(notice: NotificationSpeechNotice) {
      const id = notificationSpeechId(notice) ?? `toast:${crypto.randomUUID()}`;
      const identified = { ...notice, id };
      if (notice.dismissed) { dismiss([id]); publishNotificationDelivery(identified); return; }
      if (dismissed.has(id)) return;
      delivered.set(id, identified);
      publishNotificationDelivery(identified);
      if (preferencesReady) enqueue(identified);
      else deferredUntilPreferences.set(id, identified);
    }
    const companion = voiceCompanionBridge();
    const removeNotifications = companion?.onNotification(receiveNotification);
    const companionReady = companion?.ready?.();
    if (companionReady) void companionReady.catch(() => {});
    void voiceCompanionBridge()?.ready?.();
    channel.onmessage = event => {
      if (event.data.type === 'preferences') { retryAt = 0; void refresh(); }
      if (event.data.type === 'status-request') status(lastStatus);
      if (event.data.type === 'notification') receiveNotification(event.data.notice);
      if (event.data.type === 'notification-delivery-request') {
        for (const notice of delivered.values()) publishNotificationDelivery(notice);
        if (lastInbox) publishNotificationInbox(lastInbox);
      }
      if (event.data.type === 'notification-dismissed' && Array.isArray(event.data.ids)) {
        dismiss(event.data.ids.filter((id: unknown): id is string => typeof id === 'string'));
      }
    };
    async function refresh() {
      if (polling) return; polling = true;
      try {
        const response = await fetch('/api/profile/voice-assistant', { cache: 'no-store', signal: lifecycle.signal });
        if (!response.ok) { preferencesReady = false; preferences = DEFAULT_VOICE_ASSISTANT; userId = ''; speechSettings = null; void clearSubscriptionPreload(); stopWake(); speech?.abort(); pending.length = 0; delivered.clear(); deferredUntilPreferences.clear(); lastInbox = null; baseline = false; return; }
        const body = await response.json();
        if (!alive) return;
        if (body.userId !== userId) { preferencesReady = false; stopWake(); speech?.abort(); pending.length = 0; seen.clear(); dismissed.clear(); deferredUntilPreferences.clear(); if (userId) delivered.clear(); lastInbox = null; baseline = false; }
        userId = body.userId; preferences = parseVoiceAssistantPreferences(body.preferences) ?? DEFAULT_VOICE_ASSISTANT;
        if (!preferences.readAloudNotifications) { pending.length = 0; speech?.abort(); deferredUntilPreferences.clear(); baseline = false; }
        {
          const settings = await fetch('/api/speech/settings', { cache: 'no-store', signal: lifecycle.signal }).then(r => r.json());
          if (!alive) return;
          speechSettings = settings.settings ?? null;
          const nextProvider = settings.settings?.speechProvider;
          if (nextProvider !== provider) { provider = nextProvider; stopWake(); }
        }
        if (preferences.readAloudNotifications) {
          const requestedAt = notificationRequestTime();
          const response = await fetch('/api/chat-notifications', { cache: 'no-store', signal: lifecycle.signal });
          if (response.ok) {
            const inbox = await response.json();
            if (!alive) return;
            const incoming: unknown[] = Array.isArray(inbox.messages) ? inbox.messages : [];
            const records = incoming.filter(isChatNotificationRecord);
            lastInbox = { requestedAt, messages: records };
            publishNotificationInbox(lastInbox);
            const unreadIds = new Set(records.filter(record => !isChatNotificationRecordViewed(record))
              .map(record => `chat-notification:${record.id}`));
            dismiss([...pending, ...(reading ? [reading] : [])]
              .filter(notice => notice.inbox && !unreadIds.has(notice.id)).map(notice => notice.id));
            for (const record of records) {
              const id = `chat-notification:${record.id}`;
              const notice = { id, title: record.title, message: record.chatTitle, response: record.response || record.message };
              const key = notificationSpeechKey(notice);
              if (baseline && unreadIds.has(id)) enqueue(notice, true, key);
              else seen.add(key);
            }
            baseline = true;
          }
        }
        preferencesReady = true;
        if (preferences.readAloudNotifications) {
          const deferred = [...deferredUntilPreferences.values()];
          deferredUntilPreferences.clear();
          for (const notice of deferred) enqueue(notice, false, notificationSpeechKey(notice), true);
        }
        sync();
      } catch (error) { if (alive && !lifecycle.signal.aborted) status(error instanceof Error ? error.message : 'Voice settings could not load.'); }
      finally { polling = false; }
    }
    audioFocusChannel(); window.addEventListener(AUDIO_FOCUS_EVENT, sync);
    void refresh(); const poll = window.setInterval(() => void refresh(), 3000), tick = window.setInterval(sync, 500);
    return () => { alive = false; lifecycle.abort(); stopWake(); speech?.abort(); void clearSubscriptionPreload(); channel.close(); removeNotifications?.(); window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener(AUDIO_FOCUS_EVENT, sync); };
  }, []);
  return null;
}
