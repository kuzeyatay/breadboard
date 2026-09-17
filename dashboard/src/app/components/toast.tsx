'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, X } from 'lucide-react';
import ChatMarkdown from './chat-markdown';
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
  activeChatNotificationTarget,
  chatNotificationHref,
  chatNotificationKind,
  isChatNotificationRecord,
  isChatNotificationRecordViewed,
  sameChatNotificationTarget,
  sendChatNotificationReply,
  type ChatNotificationRecord,
  type ChatNotificationTarget,
} from '@/lib/chat-notification-inbox';
import { publishDesktopNotificationToast, handleWebsiteNotification, respondToWebsiteNotificationPermission, openDesktopNotificationTarget, onDesktopNotificationOverlayVisibility } from '@/lib/desktop-notification-overlay';
import { desktopTabsBridge } from '@/lib/desktop-browser-tabs';
import { VOICE_ASSISTANT_CHANNEL } from '@/lib/speech/assistant-preferences';
import { dismissNotificationSpeech, notificationRequestTime, publishNotificationSpeech, type NotificationInboxSnapshot, type NotificationSpeechNotice } from '@/lib/speech/notification-events';
import { isNotificationPageActive, subscribeNotificationViews } from '@/lib/notification-view-presence';
import { chimeForNotifications } from '@/lib/notification-sound';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  title?: string;
  chatId?: string;
  response?: string;
  notificationId?: string;
  question?: boolean;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string };
  target?: ChatNotificationTarget;
  /** 0-100 for a notice that tracks a running pipeline; renders a status bar. */
  progressPercent?: number;
}

interface ChatNotificationPollResponse {
  messages?: unknown;
}

const POLL_INTERVAL_MS = 4_000;
const CHAT_NOTIFICATION_TOAST_PREFIX = 'chat-notification:';
const TOAST_ACTION_BUTTON_CLASS =
  'bb-toast-action flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition-[transform,background-color,color,border-color,box-shadow] duration-150 ease-out hover:text-[var(--ink-heading)] active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]';
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
    };
  }
  return {
    id: `${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`,
    notificationId: record.id,
    message: record.chatTitle,
    question: chatNotificationKind(record) === 'chat_question',
    title: record.title,
    type: record.type,
    chatId: record.target.chatId,
    response: record.response,
    target: record.target,
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
}): Promise<void> {
  try {
    await fetch('/api/chat-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The arrow on a notice navigates away right after dismissing it. The
      // dismissal must still reach the server, or the notice greets the
      // person again on the destination page.
      keepalive: true,
    });
  } catch {
    // The notice stays hidden here; the next poll re-shows it only if the
    // server never learned of the dismissal, which is the truthful outcome.
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
export function useToast({ desktopOverlay = false }: { desktopOverlay?: boolean } = {}) {
  const [localToasts, setLocalToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<ChatNotificationRecord[]>([]);
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

  const dismissToast = useCallback((id: string, notifySource = true) => {
    dismissedLocalIdsRef.current.add(id);
    dismissNotificationSpeech([id]);
    const notificationId = id.startsWith(CHAT_NOTIFICATION_TOAST_PREFIX)
      ? id.slice(CHAT_NOTIFICATION_TOAST_PREFIX.length)
      : null;
    if (notificationId) {
      hiddenIdsRef.current.add(notificationId);
      hideNotifications((record) => record.id === notificationId);
      void postChatNotificationDismissal({ dismiss: [notificationId] });
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
    hideNotifications((record) => targetCoversRecord(target, record));
    void postChatNotificationDismissal({ seen: target });
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
    notificationPermission?: { id: string; origin: string },
    noticeId?: string,
  ) => {
    const id = notificationPermission ? `website-permission:${notificationPermission.id}` : website ? `website:${website.id}` : noticeId ?? `toast:${crypto.randomUUID()}`;
    if (dismissedLocalIdsRef.current.has(id)) return;
    if (!desktopOverlay) publishNotificationSpeech({ id, message, type, title, chatId, response, website, notificationPermission });
    if (
      !desktopOverlay &&
      publishDesktopNotificationToast({ id, message, type, title, chatId, response, website, notificationPermission })
    ) {
      return;
    }
    setLocalToasts((current) => [
      ...current.filter(toast => toast.id !== id),
      { id, message, type, title, chatId, response, website, notificationPermission },
    ]);
  }, [desktopOverlay]);

  const applyInboxSnapshot = useCallback(({ messages: incoming, requestedAt }: NotificationInboxSnapshot) => {
    // Voice may have delivered a newer inbox while our own GET was waiting.
    // An older response must never remove those newly visible messages.
    if (requestedAt < latestInboxRequestRef.current) return;
    latestInboxRequestRef.current = requestedAt;
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
      void postChatNotificationDismissal({ dismiss: readAlready });
    }
  }, [replaceNotifications]);

  const pollChatNotifications = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    const requestedAt = notificationRequestTime();
    try {
      const response = await fetch('/api/chat-notifications', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as ChatNotificationPollResponse;
      applyInboxSnapshot({ requestedAt, messages: Array.isArray(data.messages) ? data.messages.filter(isChatNotificationRecord) : [] });
    } catch {
      // The next interval reads the same server-side inbox again.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [applyInboxSnapshot]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    channel.onmessage = event => {
      const data = event.data;
      if (data.type === 'notification-inbox' && Number.isFinite(data.requestedAt) && Array.isArray(data.messages)) {
        applyInboxSnapshot({ requestedAt: data.requestedAt, messages: data.messages.filter(isChatNotificationRecord) });
      }
      if (data.type === 'notification-delivery' && (desktopOverlay || !desktopTabsBridge())) {
        const notice = data.notice as NotificationSpeechNotice;
        if (!notice || typeof notice.id !== 'string' || typeof notice.message !== 'string') return;
        const id = notice.id;
        if (notice.dismissed) dismissedLocalIdsRef.current.add(id);
        setLocalToasts(current => {
          const kept = current.filter(toast => toast.id !== id);
          return dismissedLocalIdsRef.current.has(id) ? kept : [...kept, { ...notice, id, type: notice.type === 'error' ? 'error' : 'success' }];
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
  }, [applyInboxSnapshot, desktopOverlay, hideNotifications]);

  useEffect(() => {
    // Pages and native overlays have separate JS realms. Retire a visible
    // card as soon as any tab starts showing its target, without another poll.
    const dismissViewed = () => {
      const hidden = hideNotifications(record => isChatNotificationRecordViewed(record));
      if (hidden.length) void postChatNotificationDismissal({ dismiss: hidden.map(record => record.id) });
    };
    const unsubscribe = subscribeNotificationViews(dismissViewed);
    dismissViewed();
    return unsubscribe;
  }, [hideNotifications]);

  useEffect(() => {
    void pollChatNotifications();
    const timer = window.setInterval(() => {
      // An empty native overlay can be hidden/offscreen until it has cards.
      if (desktopOverlay || document.visibilityState === 'visible') {
        void pollChatNotifications();
      }
    }, POLL_INTERVAL_MS);
    const pollWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void pollChatNotifications();
      }
    };
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
      const activeTarget = activeChatNotificationTarget();
      if (!detail?.chatId || !activeTarget) return;
      if (String(detail.chatId) !== activeTarget.chatId) return;
      dismissChatToasts(activeTarget);
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

  return { toasts, addToast, dismissToast, dismissChatToasts, dismissLearnToasts };
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
      className={`${TOAST_CARD_CLASS} w-[min(20rem,calc(100vw-2rem))] shrink-0 p-3`}
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
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="mb-1 break-all text-[11px] leading-4 text-[var(--ink-muted)]">{request.origin}</p>
          <p id={titleId} className="text-xs font-semibold text-[var(--ink-heading)]">{toast.title}</p>
        </div>
        <button
          type="button" disabled={responding} onClick={() => void respond('default')}
          className="flex size-7 items-center justify-center rounded-md text-xl leading-none text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50"
          aria-label="Dismiss notification request" title="Not now"
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
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onOpenChat?: (target: ChatNotificationTarget) => boolean | void;
}) {
  const router = useRouter();
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const hasAssistantResponse = Boolean(toast.response);
  const canReply = Boolean(hasAssistantResponse && toast.target && !toast.question);
  const progressPercent =
    typeof toast.progressPercent === 'number' && Number.isFinite(toast.progressPercent)
      ? Math.max(0, Math.min(100, Math.round(toast.progressPercent)))
      : null;
  const opensLearnPanel = toast.target?.surface === 'garden_learn';

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

  async function submitReply() {
    const message = reply.trim();
    if (!message || !toast.target || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      await sendChatNotificationReply(toast.target, message);
      onDismiss(toast.id);
    } catch (error) {
      setReplyError(
        error instanceof Error ? error.message : 'The reply could not be sent.',
      );
      setSendingReply(false);
    }
  }

  return (
    <div
      className={`${TOAST_CARD_CLASS} ${
        hasAssistantResponse
          ? 'w-[min(36rem,calc(100vw-2rem))] p-4'
          : 'w-[min(20rem,calc(100vw-2rem))] px-3 py-2.5'
      }`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="min-w-0">
          {toast.website ? <span className="mb-1 block break-all text-[11px] text-[var(--ink-muted)]">{toast.website.origin}</span> : null}
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={`size-2 shrink-0 rounded-full ${
                toast.type === 'error'
                  ? 'bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_14%,transparent)]'
                  : 'bg-[var(--botanical)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--botanical)_14%,transparent)]'
              }`}
              aria-hidden
            />
            {toast.title ? (
              <span className="min-w-0 text-xs font-semibold leading-5 text-[var(--ink-heading)]">
                {toast.title}
              </span>
            ) : !hasAssistantResponse ? (
              <span className="min-w-0 leading-5">{toast.message}</span>
            ) : null}
          </span>
          {!hasAssistantResponse && toast.title ? (
            <span className="mt-0.5 block pl-[18px] text-xs leading-5 text-[var(--ink-muted)]">
              {toast.message}
            </span>
          ) : null}
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
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {toast.website ? <button type="button" className={TOAST_ACTION_BUTTON_CLASS} aria-label={`Open ${toast.website.origin}`} title="Open website"
            onClick={() => { handleWebsiteNotification(toast.website!.id, 'click'); onDismiss(toast.id); }}><ArrowUpRight size={15} strokeWidth={1.8} aria-hidden /></button> : null}
          {toast.target && opensLearnPanel ? (
            <button
              type="button"
              onClick={openChat}
              className={TOAST_ACTION_BUTTON_CLASS}
              aria-label="Open the Learn panel"
              title="Open Learn panel"
            >
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
            </button>
          ) : toast.target ? (
            <button
              type="button"
              onClick={openChat}
              className={TOAST_ACTION_BUTTON_CLASS}
              aria-label={toast.question ? 'Open chat to answer' : 'Open this chat'}
              title={toast.question ? 'Open chat to answer' : 'Open chat'}
            >
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={TOAST_ACTION_BUTTON_CLASS}
            aria-label="Dismiss message"
            title="Dismiss"
          >
            <X size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </span>
      </div>

      {hasAssistantResponse ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--line)] pt-3">
          <div
            className="max-h-[min(42vh,24rem)] overflow-y-auto overscroll-contain pr-2 text-sm leading-6 text-[var(--ink)] [scrollbar-width:thin]"
            tabIndex={0}
            aria-label={toast.question ? 'Question from Breadboard' : 'AI response'}
          >
            <ChatMarkdown content={toast.response ?? ''} />
          </div>
          {toast.question ? (
            <button type="button" onClick={openChat}
              className="mt-3 self-start text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]">
              Open chat to answer
            </button>
          ) : null}

          {canReply ? (
            <form
              className="mt-3 border-t border-[var(--line)] pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReply();
              }}
            >
              <label
                className="mb-1.5 block text-[11px] font-medium text-[var(--ink-muted)]"
                htmlFor={`toast-reply-${toast.id}`}
              >
                Reply to this chat
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                <textarea
                  id={`toast-reply-${toast.id}`}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    void submitReply();
                  }}
                  rows={2}
                  disabled={sendingReply}
                  placeholder="Write a reply…"
                  className="min-h-16 min-w-0 resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm leading-5 text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--botanical)_12%,transparent)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendingReply}
                  className="min-h-16 self-stretch rounded-lg bg-[var(--botanical)] px-4 text-xs font-semibold text-[#fff] transition-[transform,background-color] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-[color-mix(in_srgb,var(--botanical)_48%,var(--paper-strong))] disabled:text-[#fff]"
                >
                  {sendingReply ? 'Sending…' : 'Send'}
                </button>
              </div>
              {replyError ? (
                <p className="mt-1.5 text-xs text-[var(--danger)]" role="alert">
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

  useEffect(() => {
    // A hook can collect notices without rendering them. Only mounted cards
    // may chime, and desktop pages leave announcements to their native overlay.
    if (mode === 'page' && desktopTabsBridge()) return;
    const host = hostRef.current;
    if (!host || !toasts.length) return;
    let nativeVisible = mode !== 'desktop-overlay';
    const cards = new Map(toasts.map((toast, index) => [toast.id, host.children[index]]));
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
      return Math.min(bounds.right, clip.right, innerWidth) > Math.max(bounds.left, clip.left, 0) &&
        Math.min(bounds.bottom, clip.bottom, innerHeight) > Math.max(bounds.top, clip.top, 0);
    };
    const ids = toasts.filter(toast => !toast.notificationPermission).map(toast => toast.id);
    const pending = new Set<() => void>();
    const announce = () => { pending.add(chimeForNotifications(ids, isVisible)); };
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
      for (const cancel of pending) cancel();
      unsubscribe?.();
      observer.disconnect();
      document.removeEventListener('visibilitychange', announce);
      host.removeEventListener('animationend', announce);
    };
  }, [mode, toasts]);

  useEffect(() => {
    if (!onSizeChange) return;
    const host = hostRef.current;
    if (!host || toasts.length === 0) {
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
  }, [onSizeChange, toasts.length]);

  if (toasts.length === 0) return null;
  return (
    <div
      ref={hostRef}
      className={
        mode === 'desktop-overlay'
          ? 'bb-desktop-toast-host pointer-events-none inline-flex max-h-screen flex-col items-end gap-2 overflow-y-auto p-4 [scrollbar-width:thin]'
          : 'bb-page-toast-host pointer-events-none fixed bottom-4 right-4 z-[10000] flex max-h-[calc(100vh-2rem)] flex-col items-end gap-2 overflow-y-auto [scrollbar-width:thin]'
      }
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        toast.notificationPermission ? <WebsiteNotificationPermissionCard key={toast.id} toast={toast} /> : <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onOpenChat={onOpenChat}
        />
      ))}
    </div>
  );
}
