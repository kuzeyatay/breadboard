'use client';

import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, X } from 'lucide-react';
import dynamic from 'next/dynamic';

import { startNavigationProgress } from './navigation-progress';
import {
  CHAT_RESPONSE_SEEN_EVENT,
  TASK_COMPLETION_NOTIFICATION_EVENT,
  type ChatResponseSeenDetail,
  type TaskCompletionNotificationDetail,
} from '@/lib/task-completion-notification';
import {
  CHAT_NOTIFICATION_OPENED_EVENT,
  LEARN_NOTIFICATION_ANY_JOB,
  LEARN_NOTIFICATION_OPENED_EVENT,
  activeChatNotificationTargets,
  chatNotificationHref,
  chatNotificationUrls,
  chatNotificationKind,
  isChatNotificationRecord,
  isChatNotificationRecordViewed,
  sameChatNotificationTarget,
  sendChatNotificationReply,
  type ChatNotificationRecord,
  type ChatNotificationTarget,
  type NotificationClarification,
} from '@/lib/chat-notification-inbox';
import { publishDesktopNotificationToast, handleWebsiteNotification, respondToWebsiteNotificationPermission, openDesktopNotificationTarget, onDesktopNotificationOverlayVisibility, reportDesktopChatNotifications, onDesktopChatNotificationDelivered, type DesktopChatNotification } from '@/lib/desktop-notification-overlay';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';
import { VOICE_ASSISTANT_CHANNEL } from '@/lib/speech/assistant-preferences';
import { dismissNotificationSpeech, notificationRequestTime, publishNotificationSpeech, type NotificationInboxSnapshot, type NotificationSpeechNotice } from '@/lib/speech/notification-events';
import { isNotificationPageActive, subscribeNotificationViews } from '@/lib/notification-view-presence';
import { chimeForNotifications, getNotificationSoundEnabled, notificationDeliveryReceipts, subscribeNotificationSound } from '@/lib/notification-sound';
import { isNotificationHistoryItem, type NotificationHistoryItem } from '@/lib/notification-history';
import { updateNotificationHistory } from '@/lib/notification-history-client';
import { publishNotificationDelivery } from '@/lib/speech/notification-events';
import { submitClarificationAnswer } from './hermes/permission-client';
import NotificationReplyComposer, { type NotificationReplyDraft } from './notification-reply-composer';

// Rich response toasts are uncommon on initial load. Keep their Markdown/math
// renderer out of every page's startup bundle; ordinary toasts stay synchronous.
const ChatMarkdown = lazy(() => import('./chat-markdown'));
// Load question choices only when needed; the lightweight reply input is immediate.
const NotificationQuestionReply = dynamic(() => import('./notification-question-reply'));

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  title?: string;
  chatId?: string;
  response?: string;
  notificationId?: string;
  question?: boolean;
  clarification?: NotificationClarification;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string; media?: ("microphone" | "camera")[] };
  target?: ChatNotificationTarget;
  /** 0-100 for a notice that tracks a running pipeline; renders a status bar. */
  progressPercent?: number;
  updatedAt?: string;
  read?: boolean;
}

interface ChatNotificationPollResponse {
  messages?: unknown;
  history?: unknown;
}

const POLL_INTERVAL_MS = 4_000;
const CHAT_NOTIFICATION_TOAST_PREFIX = 'chat-notification:';
const TOAST_ACTION_BUTTON_CLASS =
  'bb-toast-action flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition-[transform,background-color,color,border-color,box-shadow] duration-150 ease-out hover:text-[var(--ink-heading)] active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]';
const TOAST_CARD_CLASS =
  'bb-toast-card pointer-events-auto flex max-h-[calc(100vh-2rem)] flex-col rounded-[18px] border text-sm text-[var(--ink)]';

function notificationToast(record: ChatNotificationRecord): ToastItem {
  if (chatNotificationKind(record) === 'learn') {
    // A Learn notice is a status line about a Garden, not an answer to read:
    // the Garden's name is the headline and the stage is the body.
    const detail = record.message?.trim();
    return {
      id: `${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`,
      notificationId: record.id,
      message: detail ? `${record.chatTitle} · ${detail}` : record.chatTitle,
      title: record.title,
      type: record.type,
      target: record.target,
      progressPercent: record.progressPercent,
      updatedAt: record.updatedAt,
    };
  }
  return {
    id: `${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`,
    notificationId: record.id,
    message: record.chatTitle,
    question: chatNotificationKind(record) === 'chat_question',
    clarification: record.clarification,
    title: record.title,
    type: record.type,
    chatId: record.target.chatId,
    response: record.response,
    target: record.target,
    updatedAt: record.updatedAt,
  };
}

function sameNotificationList(
  left: readonly ChatNotificationRecord[],
  right: readonly ChatNotificationRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      record.id === other.id &&
      record.updatedAt === other.updatedAt &&
      record.title === other.title &&
      record.type === other.type &&
      record.kind === other.kind &&
      JSON.stringify(record.clarification) === JSON.stringify(other.clarification) &&
      record.inlineSelectionId === other.inlineSelectionId &&
      JSON.stringify(record.messageKeys) === JSON.stringify(other.messageKeys) &&
      JSON.stringify(record.target) === JSON.stringify(other.target) &&
      record.response === other.response &&
      record.chatTitle === other.chatTitle &&
      record.message === other.message &&
      record.progressPercent === other.progressPercent
    );
  });
}

/**
 * Whether a target the page reported viewing covers a notice. A Garden's Learn
 * panel covers every Learn notice of that Garden; a chat covers its own.
 */
function targetCoversRecord(
  viewed: ChatNotificationTarget,
  record: ChatNotificationRecord,
): boolean {
  if (viewed.surface === 'garden_learn') {
    return (
      record.target.surface === 'garden_learn' &&
      record.target.gardenSlug === viewed.gardenSlug &&
      (viewed.chatId === LEARN_NOTIFICATION_ANY_JOB ||
        viewed.chatId === record.target.chatId)
    );
  }
  return sameChatNotificationTarget(record.target, viewed);
}

function learnGardenTarget(gardenSlug: string): ChatNotificationTarget {
  return {
    surface: 'garden_learn',
    gardenSlug,
    chatId: LEARN_NOTIFICATION_ANY_JOB,
  };
}

async function postChatNotificationDismissal(body: {
  dismiss?: string[];
  seen?: ChatNotificationTarget;
}): Promise<boolean> {
  try {
    const response = await fetch('/api/chat-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The arrow on a notice navigates away right after dismissing it. The
      // dismissal must still reach the server, or the notice greets the
      // person again on the destination page.
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Corner notices.
 *
 * Plain notices (`addToast`) also travel through the voice reader, which
 * relays their complete contents to the UI and replays them after a reload.
 * The desktop shell shows them in its window-level overlay so no tab can cover them.
 * Chat-response notices are a different thing: they are read from the
 * account's server-side inbox, so the same list appears in every window and
 * survives restarts, and dismissing one anywhere dismisses it everywhere.
 * Three rules decide what that inbox shows:
 *
 * 1. Opening the chat a notice belongs to closes the notice.
 * 2. An answer that lands in the chat already on screen is never announced.
 * 3. A dismissed notice never returns.
 */
export function useToast({ desktopOverlay = false, notificationCenter = false }: { desktopOverlay?: boolean; notificationCenter?: boolean } = {}) {
  const [localToasts, setLocalToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<ChatNotificationRecord[]>([]);
  const [inboxStatus, setInboxStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [centerNotifications, setCenterNotifications] = useState<NotificationHistoryItem[]>([]);
  const historyRequestRef = useRef(0);
  const notificationsRef = useRef<ChatNotificationRecord[]>([]);
  // Dismissed here, awaiting the server's confirmation on a later poll.
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  const pollInFlightRef = useRef(false);
  const latestInboxRequestRef = useRef(0);
  const dismissedLocalIdsRef = useRef(new Set<string>());

  const replaceNotifications = useCallback((next: ChatNotificationRecord[]) => {
    if (sameNotificationList(notificationsRef.current, next)) return;
    const kept = new Set(next.map(record => record.id));
    dismissNotificationSpeech(notificationsRef.current
      .filter(record => !kept.has(record.id))
      .map(record => `${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`));
    notificationsRef.current = next;
    setNotifications(next);
  }, []);

  const hideNotifications = useCallback((
    predicate: (record: ChatNotificationRecord) => boolean,
  ): ChatNotificationRecord[] => {
    const hidden: ChatNotificationRecord[] = [];
    const kept: ChatNotificationRecord[] = [];
    for (const record of notificationsRef.current) {
      if (predicate(record)) hidden.push(record);
      else kept.push(record);
    }
    for (const record of hidden) hiddenIdsRef.current.add(record.id);
    if (hidden.length > 0) replaceNotifications(kept);
    return hidden;
  }, [replaceNotifications]);

  const dismissToast = useCallback((id: string, notifySource = true, persistChat = true) => {
    dismissedLocalIdsRef.current.add(id);
    dismissNotificationSpeech([id]);
    const notificationId = id.startsWith(CHAT_NOTIFICATION_TOAST_PREFIX)
      ? id.slice(CHAT_NOTIFICATION_TOAST_PREFIX.length)
      : null;
    if (notificationId) {
      hiddenIdsRef.current.add(notificationId);
      hideNotifications((record) => record.id === notificationId);
      if (persistChat) void postChatNotificationDismissal({ dismiss: [notificationId] }).then(saved => {
        if (!saved) hiddenIdsRef.current.delete(notificationId);
      });
      return;
    }
    if (notifySource && id.startsWith('website:')) handleWebsiteNotification(id.slice('website:'.length), 'close');
    if (notifySource && id.startsWith('website-permission:')) {
      void respondToWebsiteNotificationPermission(id.slice('website-permission:'.length), 'default').catch(() => undefined);
    }
    setLocalToasts((current) => current.filter((toast) => toast.id !== id));
  }, [hideNotifications]);

  /** The person is looking at this chat (or Learn panel): every notice for it is read. */
  const dismissChatToasts = useCallback((target: ChatNotificationTarget) => {
    if (!isNotificationPageActive()) return;
    const hidden = hideNotifications((record) => targetCoversRecord(target, record));
    void postChatNotificationDismissal({ seen: target }).then(saved => {
      if (!saved) for (const record of hidden) hiddenIdsRef.current.delete(record.id);
    });
  }, [hideNotifications]);

  /** The Garden's Learn panel is on screen: its Learn notices are read. */
  const dismissLearnToasts = useCallback((gardenSlug: string) => {
    dismissChatToasts(learnGardenTarget(gardenSlug));
  }, [dismissChatToasts]);

  const addToast = useCallback((
    message: string,
    type: 'success' | 'error' = 'error',
    title?: string,
    chatId?: string,
    response?: string,
    website?: { id: string; origin: string },
    notificationPermission?: { id: string; origin: string; media?: ("microphone" | "camera")[] },
    noticeId?: string,
  ) => {
    const id = notificationPermission ? `website-permission:${notificationPermission.id}` : website ? `website:${website.id}` : noticeId ?? `toast:${crypto.randomUUID()}`;
    if (dismissedLocalIdsRef.current.has(id)) return;
    const notice = { id, message, type, title, chatId, response, website, notificationPermission };
    if (!notificationPermission) void updateNotificationHistory({ notice }).catch(() => undefined);
    // Native notices must reach every page even when the voice companion is off.
    if (desktopOverlay) publishNotificationDelivery(notice);
    if (!desktopOverlay) publishNotificationSpeech({ id, message, type, title, chatId, response, website, notificationPermission });
    const published =
      !desktopOverlay &&
      publishDesktopNotificationToast({ id, message, type, title, chatId, response, website, notificationPermission });
    if (published && !notificationCenter) return;
    setLocalToasts((current) => [
      ...current.filter(toast => toast.id !== id),
      { id, message, type, title, chatId, response, website, notificationPermission, updatedAt: new Date().toISOString() },
    ]);
  }, [desktopOverlay, notificationCenter]);

  const applyInboxSnapshot = useCallback(({ messages: incoming, requestedAt }: NotificationInboxSnapshot) => {
    // Voice may have delivered a newer inbox while our own GET was waiting.
    // An older response must never remove those newly visible messages.
    if (requestedAt < latestInboxRequestRef.current) return;
    latestInboxRequestRef.current = requestedAt;
    if (!notificationCenter) setInboxStatus('ready');
    const visible: ChatNotificationRecord[] = [];
    const readAlready: string[] = [];
    for (const record of incoming) {
      if (hiddenIdsRef.current.has(record.id)) continue;
      if (isChatNotificationRecordViewed(record)) {
        hiddenIdsRef.current.add(record.id);
        readAlready.push(record.id);
      } else {
        visible.push(record);
      }
    }
    // The server has caught up with every dismissal it no longer returns.
    const returned = new Set(incoming.map((record) => record.id));
    for (const id of hiddenIdsRef.current) {
      if (!returned.has(id)) hiddenIdsRef.current.delete(id);
    }
    replaceNotifications(visible);
    if (readAlready.length > 0) {
      void postChatNotificationDismissal({ dismiss: readAlready }).then(saved => {
        if (!saved) for (const id of readAlready) hiddenIdsRef.current.delete(id);
      });
    }
  }, [replaceNotifications, notificationCenter]);

  const pollChatNotifications = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    const requestedAt = notificationRequestTime();
    try {
      const response = await fetch(notificationCenter ? '/api/chat-notifications?center=1' : '/api/chat-notifications', {
        cache: 'no-store', priority: 'low', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Notification inbox unavailable');
      const data = (await response.json()) as ChatNotificationPollResponse;
      if (!Array.isArray(data.messages)) throw new Error('Invalid notification inbox');
      if (notificationCenter) {
        if (!Array.isArray(data.history)) throw new Error('Invalid notification history');
        if (requestedAt >= historyRequestRef.current) {
          historyRequestRef.current = requestedAt;
          setCenterNotifications(data.history.filter(isNotificationHistoryItem));
        }
      }
      applyInboxSnapshot({ requestedAt, messages: data.messages.filter(isChatNotificationRecord) });
      setInboxStatus('ready');
    } catch {
      if (requestedAt >= latestInboxRequestRef.current) setInboxStatus('error');
      // The next interval reads the same server-side inbox again.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [applyInboxSnapshot, notificationCenter]);

  const updateCenterNotifications = useCallback(async (ids: string[], clear: boolean) => {
    if (!ids.length) return;
    // Do not erase the card until its durable receipt succeeds.
    try {
      await updateNotificationHistory(clear ? { clearHistory: ids } : { readHistory: ids });
      historyRequestRef.current = notificationRequestTime();
      const updated = new Set(ids);
      setCenterNotifications(current => clear ? current.filter(item => !updated.has(item.id))
        : current.map(item => updated.has(item.id) ? { ...item, read: true } : item));
      for (const id of ids) dismissToast(id, true, false);
    } catch {
      setInboxStatus('error');
    }
  }, [dismissToast]);
  const dismissCenterNotification = useCallback((id: string) => { void updateCenterNotifications([id], true); }, [updateCenterNotifications]);
  const readCenterNotification = useCallback((id: string) => { void updateCenterNotifications([id], false); }, [updateCenterNotifications]);
  const clearCenterNotifications = useCallback((ids: string[]) => { void updateCenterNotifications(ids, true); }, [updateCenterNotifications]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    channel.onmessage = event => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'notification-history-changed' && notificationCenter) void pollChatNotifications();
      if (data.type === 'notification-inbox' && Number.isFinite(data.requestedAt) && Array.isArray(data.messages)) {
        applyInboxSnapshot({ requestedAt: data.requestedAt, messages: data.messages.filter(isChatNotificationRecord) });
      }
      if ((data.type === 'notification-delivery' || data.type === 'notification') && (desktopOverlay || notificationCenter || !desktopTabsBridge())) {
        const notice = data.notice as NotificationSpeechNotice;
        if (!notice || typeof notice.id !== 'string' || typeof notice.message !== 'string') return;
        const id = notice.id;
        if (notice.dismissed) dismissedLocalIdsRef.current.add(id);
        setLocalToasts(current => {
          const kept = current.filter(toast => toast.id !== id);
          const updatedAt = current.find(toast => toast.id === id)?.updatedAt ?? new Date().toISOString();
          return dismissedLocalIdsRef.current.has(id) ? kept : [...kept, { ...notice, id, updatedAt, type: notice.type === 'error' ? 'error' : 'success' }];
        });
      }
      if (data.type === 'notification-dismissed' && Array.isArray(data.ids)) {
        const ids = new Set<string>(data.ids.filter((id: unknown): id is string => typeof id === 'string'));
        for (const id of ids) {
          dismissedLocalIdsRef.current.add(id);
          if (id.startsWith(CHAT_NOTIFICATION_TOAST_PREFIX)) hiddenIdsRef.current.add(id.slice(CHAT_NOTIFICATION_TOAST_PREFIX.length));
        }
        hideNotifications(record => ids.has(`${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`));
        setLocalToasts(current => current.filter(toast => !ids.has(toast.id)));
      }
    };
    // Recover notices that arrived before this overlay mounted or reloaded.
    channel.postMessage({ type: 'notification-delivery-request' });
    return () => channel.close();
  }, [applyInboxSnapshot, desktopOverlay, notificationCenter, hideNotifications, pollChatNotifications]);

  useEffect(() => {
    // Pages and native overlays have separate JS realms. Retire a visible
    // card as soon as any tab starts showing its target, without another poll.
    const dismissViewed = () => {
      const hidden = hideNotifications(record => isChatNotificationRecordViewed(record));
      if (hidden.length) void postChatNotificationDismissal({ dismiss: hidden.map(record => record.id) }).then(saved => {
        if (!saved) for (const record of hidden) hiddenIdsRef.current.delete(record.id);
      });
    };
    const unsubscribe = subscribeNotificationViews(dismissViewed);
    dismissViewed();
    return unsubscribe;
  }, [hideNotifications]);

  useEffect(() => {
    const pollWhenVisible = () => {
      // Parked Electron views can still report visible. The native overlay
      // and voice reader keep the inbox current while those tabs are inactive.
      if (desktopOverlay || (desktopTabsBridge()
        ? isNotificationPageActive() : document.visibilityState === 'visible')) {
        void pollChatNotifications();
      }
    };
    pollWhenVisible();
    const timer = window.setInterval(pollWhenVisible, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', pollWhenVisible);
    window.addEventListener('focus', pollWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', pollWhenVisible);
      window.removeEventListener('focus', pollWhenVisible);
    };
  }, [desktopOverlay, pollChatNotifications]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<TaskCompletionNotificationDetail>).detail;
      if (!detail?.message) return;
      // Chat responses come from the durable server-side inbox above. Ignoring
      // the process-local completion event prevents a restored monitor from
      // recreating a message the person already dismissed before restarting.
      if (
        detail.chatId &&
        (detail.title === 'Response ready' || detail.title === 'Response failed')
      ) {
        return;
      }
      addToast(
        detail.message,
        detail.type,
        detail.title,
        detail.chatId,
        detail.response,
      );
    };
    window.addEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
    return () =>
      window.removeEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
  }, [addToast]);

  useEffect(() => {
    const opened = (raw: Event) => {
      const target = (raw as CustomEvent<ChatNotificationTarget>).detail;
      if (!target?.chatId) return;
      dismissChatToasts(target);
    };
    // An answer finished in the chat on screen. The surface names the chat by
    // id only; the target it maps to is the one this page reported viewing.
    const seen = (raw: Event) => {
      const detail = (raw as CustomEvent<ChatResponseSeenDetail>).detail;
      if (!detail?.chatId) return;
      for (const target of activeChatNotificationTargets()) {
        if (String(detail.chatId) === target.chatId || String(detail.chatId) === target.conversationId) {
          dismissChatToasts(target);
        }
      }
    };
    window.addEventListener(CHAT_NOTIFICATION_OPENED_EVENT, opened);
    window.addEventListener(LEARN_NOTIFICATION_OPENED_EVENT, opened);
    window.addEventListener(CHAT_RESPONSE_SEEN_EVENT, seen);
    return () => {
      window.removeEventListener(CHAT_NOTIFICATION_OPENED_EVENT, opened);
      window.removeEventListener(LEARN_NOTIFICATION_OPENED_EVENT, opened);
      window.removeEventListener(CHAT_RESPONSE_SEEN_EVENT, seen);
    };
  }, [dismissChatToasts]);

  const toasts = useMemo(
    () => [...localToasts, ...notifications.map(notificationToast)],
    [localToasts, notifications],
  );

  return { toasts, centerNotifications, addToast, dismissToast, dismissChatToasts, dismissLearnToasts,
    dismissCenterNotification, readCenterNotification, clearCenterNotifications, inboxStatus, refreshNotifications: pollChatNotifications };
}

function WebsiteNotificationPermissionCard({ toast }: { toast: ToastItem }) {
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = toast.notificationPermission!;
  const titleId = `permission-title-${request.id}`;
  const descriptionId = `permission-description-${request.id}`;

  async function respond(permission: NotificationPermission) {
    if (responding) return;
    setResponding(true);
    setError(null);
    try {
      const accepted = await respondToWebsiteNotificationPermission(request.id, permission);
      if (!accepted) throw new Error('This request is no longer available.');
      // The shell dismisses the card after resolving the website's request.
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your choice. Try again.');
      setResponding(false);
    }
  }

  return (
    <div
      className={`${TOAST_CARD_CLASS} w-[min(20rem,calc(100vw-2rem))] shrink-0 p-3 text-[var(--ink)]`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={responding}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); void respond('default'); }
      }}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-[var(--paper-strong)] text-[var(--botanical)]" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {request.media?.includes('camera') ? <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>
              : request.media?.includes('microphone') ? <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>
              : <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />}
          </svg>
        </span>
        <div className="min-w-0">
          <p className="mb-1 break-all text-[11px] leading-4 text-[var(--ink-muted)]">{request.origin}</p>
          <p id={titleId} className="text-xs font-semibold text-[var(--ink-heading)]">{toast.title}</p>
        </div>
        <button
          type="button" disabled={responding} onClick={() => void respond('default')}
          className="flex size-7 items-center justify-center rounded-md text-xl leading-none text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50"
          aria-label={request.media ? "Dismiss device access request" : "Dismiss notification request"} title="Not now"
        ><span aria-hidden>×</span></button>
      </div>
      <p id={descriptionId} className="mt-2.5 text-xs leading-5 text-[var(--ink-muted)]">{toast.message}</p>
      <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
        <button type="button" disabled={responding} onClick={() => void respond('default')}
          className="mr-auto min-h-8 rounded-md px-2 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50">Not now</button>
        <button type="button" disabled={responding} onClick={() => void respond('denied')}
          className="min-h-8 rounded-md border border-[var(--line)] px-3 text-xs font-medium transition-colors hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50">Block</button>
        <button type="button" disabled={responding} onClick={() => void respond('granted')}
          className="min-h-8 rounded-md bg-[var(--botanical)] px-3 text-xs font-semibold text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50">Allow</button>
      </div>
      {error ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  onOpenChat,
  onReply,
  initialDraft,
  replyError,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onOpenChat?: (target: ChatNotificationTarget) => boolean | void;
  onReply: (toast: ToastItem, draft: NotificationReplyDraft) => void;
  initialDraft?: NotificationReplyDraft;
  replyError?: string;
}) {
  const router = useRouter();
  const [reply, setReply] = useState(initialDraft?.text ?? '');
  const hasAssistantResponse = Boolean(toast.response);
  const response = toast.clarification?.question ?? toast.response ?? '';
  const canReply = Boolean(hasAssistantResponse && toast.target && !toast.question);
  const progressPercent =
    typeof toast.progressPercent === 'number' && Number.isFinite(toast.progressPercent)
      ? Math.max(0, Math.min(100, Math.round(toast.progressPercent)))
      : null;
  const opensLearnPanel = toast.target?.surface === 'garden_learn';
  const isChatNotice = Boolean(toast.target && !opensLearnPanel);
  const heading = isChatNotice ? toast.message.trim() || 'Untitled chat' : toast.title || toast.message;

  function openChat() {
    if (!toast.target) return;
    // Dismiss first: the durable dismissal has to be on its way before a
    // navigation unmounts this page.
    onDismiss(toast.id);
    const handled = openDesktopNotificationTarget(toast.target) || onOpenChat?.(toast.target) === true;
    if (!handled) {
      const href = chatNotificationHref(toast.target);
      if (href !== `${window.location.pathname}${window.location.search}`) {
        startNavigationProgress();
      }
      router.push(href);
    }
  }

  return (
    <div
      className={`${TOAST_CARD_CLASS} ${
        hasAssistantResponse
          ? 'w-[min(30rem,calc(100vw-2rem))] p-4'
          : 'w-[min(20rem,calc(100vw-2rem))] px-3 py-2.5'
      }`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      data-response={hasAssistantResponse ? 'true' : undefined}
    >
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          {toast.website ? <span className="mb-1 block break-all text-[11px] text-[var(--ink-muted)]">{toast.website.origin}</span> : null}
          <h2 className="min-w-0 break-words text-sm font-semibold leading-5 text-[var(--ink-heading)]">
            {heading}
          </h2>
          {progressPercent !== null ? (
            <span
              className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-[var(--paper-strong)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
              aria-label="Learn progress"
              data-testid="toast-progress"
            >
              <span
                className="block h-full rounded-full bg-[var(--botanical)] transition-[width] duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </span>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {toast.website ? <button type="button" className={TOAST_ACTION_BUTTON_CLASS} aria-label={`Open ${toast.website.origin}`} title="Open website"
            onClick={() => { handleWebsiteNotification(toast.website!.id, 'click'); onDismiss(toast.id); }}><ArrowUpRight size={13} strokeWidth={1.8} aria-hidden /></button> : null}
          {toast.target && opensLearnPanel ? (
            <button
              type="button"
              onClick={openChat}
              className={TOAST_ACTION_BUTTON_CLASS}
              aria-label="Open the Learn panel"
              title="Open Learn panel"
            >
              <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
            </button>
          ) : toast.target ? (
            <button
              type="button"
              onClick={openChat}
              className={TOAST_ACTION_BUTTON_CLASS}
              aria-label="Open this chat"
              title="Open chat"
            >
              <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={TOAST_ACTION_BUTTON_CLASS}
            aria-label="Dismiss message"
            title="Dismiss"
          >
            <X size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </span>
      </div>

      {!hasAssistantResponse && toast.title && !isChatNotice ? (
        <div
          className="bb-toast-message mt-0.5 min-h-0 min-w-0 max-h-[min(42vh,24rem)] overflow-x-hidden overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-xs leading-5 text-[var(--ink-muted)] [overflow-wrap:anywhere]"
          tabIndex={0}
          aria-label="Notification message"
        >
          {toast.message}
        </div>
      ) : null}

      {hasAssistantResponse ? (
        <div className="bb-toast-scroll-shell -ml-2 mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain pl-2">
          <div
            className="bb-toast-message min-h-0 min-w-0 max-h-[min(42vh,24rem)] overflow-x-hidden overflow-y-auto overscroll-contain pr-2 text-sm leading-6 text-[var(--ink)]"
            tabIndex={0}
            aria-label={toast.question ? 'Question from Breadboard' : 'AI response'}
          >
            <Suspense fallback={<div className="whitespace-pre-wrap">{response}</div>}>
              <ChatMarkdown content={response} />
            </Suspense>
          </div>
          {toast.question && toast.clarification ? (
            <NotificationQuestionReply key={`${toast.clarification.sessionId}:${toast.clarification.requestId}`}
              clarification={toast.clarification} initialDraft={initialDraft} initialError={replyError}
              onSubmitReply={draft => onReply(toast, draft)} />
          ) : toast.question ? (
            <button type="button" onClick={openChat}
              className="mt-3 self-start text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]">
              Open chat to answer
            </button>
          ) : null}

          {canReply ? (
            <form
              className="mt-2 shrink-0"
              aria-label="Reply to this chat"
              onSubmit={(event) => {
                event.preventDefault();
                onReply(toast, { text: reply });
              }}
            >
              <NotificationReplyComposer id={`toast-reply-${toast.id}`} value={reply}
                onChange={setReply} onSubmit={() => onReply(toast, { text: reply })} label="Reply to this chat"
                placeholder="Write a reply…" canSubmit={Boolean(reply.trim())} sending={false}
                describedBy={replyError ? `toast-reply-error-${toast.id}` : undefined} />
              {replyError ? (
                <p id={`toast-reply-error-${toast.id}`} className="mt-1.5 text-xs text-[var(--danger)]" role="alert">
                  {replyError}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface NotificationReplySubmission {
  toast: ToastItem;
  draft: NotificationReplyDraft;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
}

export function Toaster({
  toasts,
  onDismiss,
  onOpenChat,
  mode = 'page',
  onSizeChange,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onOpenChat?: (target: ChatNotificationTarget) => boolean | void;
  mode?: 'page' | 'desktop-overlay';
  onSizeChange?: (width: number, height: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Own delivery above the cards: sending hides a card immediately, and a failed
  // request can restore its draft even if an inbox refresh removed the notice.
  const [replies, setReplies] = useState(() => new Map<string, NotificationReplySubmission>());
  const repliesRef = useRef(replies);
  const visibleToasts = useMemo(() => {
    const visible = new Map<string, ToastItem>();
    for (const toast of toasts) {
      const reply = replies.get(toast.id);
      if (!reply) visible.set(toast.id, toast);
      else if (reply.status === 'failed') visible.set(toast.id, reply.toast);
    }
    for (const [id, reply] of replies) {
      if (reply.status === 'failed') visible.set(id, reply.toast);
    }
    return [...visible.values()];
  }, [toasts, replies]);

  function updateReply(id: string, reply?: NotificationReplySubmission) {
    const next = new Map(repliesRef.current);
    if (reply) next.set(id, reply);
    else next.delete(id);
    repliesRef.current = next;
    setReplies(next);
  }

  function dismissToast(id: string) {
    updateReply(id);
    onDismiss(id);
  }

  async function submitReply(toast: ToastItem, draft: NotificationReplyDraft) {
    const message = draft.text.trim() || draft.choice || '';
    const previous = repliesRef.current.get(toast.id);
    if (!message || (!toast.clarification && !toast.target) ||
      previous?.status === 'pending' || previous?.status === 'sent') return;
    const submission = { toast, draft, status: 'pending' as const };
    updateReply(toast.id, submission);
    try {
      if (toast.clarification) {
        await submitClarificationAnswer(toast.clarification.requestId, toast.clarification.sessionId, message);
      } else if (toast.target) {
        await sendChatNotificationReply(toast.target, message);
      }
      updateReply(toast.id, { ...submission, status: 'sent' });
      // Persist dismissal only after delivery has been accepted.
      onDismiss(toast.id);
    } catch (error) {
      updateReply(toast.id, { ...submission, status: 'failed',
        error: error instanceof Error ? error.message : 'The reply could not be sent. Try again.' });
    }
  }

  useEffect(() => {
    const liveIds = new Set(toasts.map(toast => toast.id));
    const next = new Map(repliesRef.current);
    for (const [id, reply] of next) {
      if (reply.status === 'sent' && !liveIds.has(id)) next.delete(id);
    }
    if (next.size !== repliesRef.current.size) {
      repliesRef.current = next;
      setReplies(next);
    }
  }, [toasts, replies]);

  useEffect(() => {
    // A hook can collect notices without rendering them. Only mounted cards
    // may chime, and desktop pages leave announcements to their native overlay.
    if (mode === 'page' && desktopTabsBridge()) return;
    const host = hostRef.current;
    if (!host || !visibleToasts.length) return;
    let nativeVisible = mode !== 'desktop-overlay';
    let nativeRects: Array<{ x: number; y: number; width: number; height: number }> | undefined = mode === 'desktop-overlay' ? [] : undefined;
    const cards = new Map(visibleToasts.map((toast, index) => [toast.id, host.children[index]]));
    const isVisible = (id: string) => {
      const card = cards.get(id);
      if (!nativeVisible || document.visibilityState !== 'visible' || !card?.isConnected) return false;
      const cssVisible = () => {
        const style = getComputedStyle(card);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      let visible = false;
      try { visible = typeof card.checkVisibility === 'function'
        ? card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : cssVisible(); }
      catch { visible = cssVisible(); }
      if (!visible) return false;
      const bounds = card.getBoundingClientRect();
      const clip = host.getBoundingClientRect();
      if (nativeRects && !nativeRects.some(rect => Math.min(bounds.right, clip.right, rect.x + rect.width) - Math.max(bounds.left, clip.left, rect.x) >= Math.min(24, bounds.width) &&
        Math.min(bounds.bottom, clip.bottom, rect.y + rect.height) - Math.max(bounds.top, clip.top, rect.y) >= Math.min(16, bounds.height))) return false;
      return Math.min(bounds.right, clip.right, innerWidth) > Math.max(bounds.left, clip.left, 0) &&
        Math.min(bounds.bottom, clip.bottom, innerHeight) > Math.max(bounds.top, clip.top, 0);
    };
    const ids = visibleToasts.filter(toast => !toast.notificationPermission).map(toast => toast.id);
    const pending = new Set<() => void>();
    const announce = () => { pending.add(chimeForNotifications(ids, isVisible)); };
    const desktop = mode === 'desktop-overlay' ? desktopTabsBridge() : undefined;
    let disposed = false;
    const updateRegions = (state: Awaited<ReturnType<NonNullable<typeof desktop>['getTabsState']>>) => {
      if (disposed) return;
      nativeRects = state.notificationVisibleRects;
      announce();
    };
    let receivedState = false;
    const unsubscribeRegions = desktop?.onTabsState(state => { receivedState = true; updateRegions(state); });
    if (desktop) void desktop.getTabsState().then(state => { if (!receivedState) updateRegions(state); }).catch(() => undefined);
    const unsubscribe = mode === 'desktop-overlay' ? onDesktopNotificationOverlayVisibility(visible => {
      nativeVisible = visible;
      if (visible) announce();
      else { for (const cancel of pending) cancel(); pending.clear(); }
    }) : null;
    const observer = new IntersectionObserver(announce, { threshold: 0.01 });
    for (const card of cards.values()) if (card) observer.observe(card);
    document.addEventListener('visibilitychange', announce);
    // Cards materialize from opacity 0, so every check made while a card is
    // mounting reads it as hidden and nothing else fires once it has faded in.
    // The end of that entrance is the moment the card is actually shown.
    host.addEventListener('animationend', announce);
    announce();
    return () => {
      disposed = true;
      for (const cancel of pending) cancel();
      unsubscribe?.();
      unsubscribeRegions?.();
      observer.disconnect();
      document.removeEventListener('visibilitychange', announce);
      host.removeEventListener('animationend', announce);
    };
  }, [mode, visibleToasts]);

  useEffect(() => {
    if (mode !== 'desktop-overlay') return;
    // The shell's OS alert is silent. The app owns the sound: one chime per
    // delivery, shared receipt with the in-app chime, honouring the toggle.
    return onDesktopChatNotificationDelivered(ids => { chimeForNotifications(ids, () => true); });
  }, [mode]);

  useEffect(() => {
    if (mode !== 'desktop-overlay') return;
    const host = hostRef.current;
    let last = '';
    const report = () => {
      const receipts = notificationDeliveryReceipts();
      const clip = host?.getBoundingClientRect();
      const cards: DesktopChatNotification[] = [];
      for (const [index, toast] of visibleToasts.entries()) {
        const target = toast.target ?? (toast.chatId ? { surface: 'dashboard_terminal' as const, chatId: toast.chatId } : undefined);
        if (!target || target.surface === 'garden_learn') continue;
        const node = host?.children[index];
        const bounds = node?.getBoundingClientRect();
        const style = node && getComputedStyle(node);
        let rect: DesktopChatNotification['rect'] = null;
        if (bounds && clip && style?.visibility !== 'hidden' && style?.display !== 'none' && Number(style?.opacity) > 0) {
          const x = Math.max(0, clip.left, bounds.left), y = Math.max(0, clip.top, bounds.top);
          const width = Math.min(innerWidth, clip.right, bounds.right) - x;
          const height = Math.min(innerHeight, clip.bottom, bounds.bottom) - y;
          if (width >= Math.min(24,bounds.width) && height >= Math.min(16,bounds.height)) rect = { x, y, width, height };
        }
        cards.push({ id: toast.id, title: (toast.message || 'Breadboard').slice(0,256),
          body: (toast.response || toast.title || 'Response ready').slice(0,8192),
          urls: chatNotificationUrls(target), rect, delivered: receipts.has(toast.id), soundEnabled: getNotificationSoundEnabled() });
      }
      const signature = JSON.stringify(cards);
      if (signature !== last) { last = signature; reportDesktopChatNotifications(cards); }
    };
    report();
    const observer = new ResizeObserver(report);
    if (host) observer.observe(host);
    for (const card of host?.children ?? []) observer.observe(card);
    host?.addEventListener('animationend', report);
    host?.addEventListener('scroll', report);
    window.addEventListener('resize', report);
    const unsubscribe = subscribeNotificationSound(report);
    return () => {
      observer.disconnect(); unsubscribe();
      host?.removeEventListener('animationend', report);
      host?.removeEventListener('scroll', report);
      window.removeEventListener('resize', report);
    };
  }, [mode, visibleToasts]);

  useEffect(() => {
    if (mode === 'desktop-overlay') return () => reportDesktopChatNotifications([]);
  }, [mode]);

  useEffect(() => {
    if (!onSizeChange) return;
    const host = hostRef.current;
    if (!host || visibleToasts.length === 0) {
      onSizeChange(0, 0);
      return;
    }
    const report = () => {
      const bounds = host.getBoundingClientRect();
      onSizeChange(Math.ceil(bounds.width), Math.ceil(bounds.height));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [onSizeChange, visibleToasts.length]);

  if (visibleToasts.length === 0) return null;
  return (
    <div
      ref={hostRef}
      className={
        mode === 'desktop-overlay'
          ? 'bb-desktop-toast-host bb-toast-scroll-shell pointer-events-none inline-flex flex-col items-end gap-2 overflow-y-auto p-4'
          : 'bb-page-toast-host bb-toast-scroll-shell pointer-events-none fixed bottom-4 right-4 z-[10000] flex max-h-[calc(100vh-2rem)] flex-col items-end gap-2 overflow-y-auto'
      }
      aria-live="polite"
      aria-atomic="false"
    >
      {visibleToasts.map((toast) => (
        toast.notificationPermission ? <WebsiteNotificationPermissionCard key={toast.id} toast={toast} /> : <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
          onOpenChat={onOpenChat}
          onReply={(item, draft) => void submitReply(item, draft)}
          initialDraft={replies.get(toast.id)?.draft}
          replyError={replies.get(toast.id)?.error}
        />
      ))}
    </div>
  );
}
