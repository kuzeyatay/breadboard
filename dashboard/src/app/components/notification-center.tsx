"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Bell, RotateCw, Settings2, X } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { chatNotificationHref, type ChatNotificationTarget } from "@/lib/chat-notification-inbox";
import { handleWebsiteNotification, openDesktopNotificationTarget } from "@/lib/desktop-notification-overlay";
import { notificationTimestamp, notificationTimeLabel } from "@/lib/notification-center";
import { startNavigationProgress } from "./navigation-progress";
import type { ToastItem } from "./toast";
import NotificationCenterSettings from "./notification-center-settings";
import appearanceStyles from "./page-appearance.module.css";
import styles from "./notification-center.module.css";
import panelStyles from "./utility-panel.module.css";

// Previews (markdown with KaTeX) and question replies (metal-fx) render only
// when the center has notices; keep them out of the home startup bundle.
const NotificationPreview = dynamic(() => import("./notification-preview"));
const NotificationQuestionReply = dynamic(() => import("./notification-question-reply"));

export interface NotificationCenterProps {
  notifications: ToastItem[];
  status: "loading" | "ready" | "error";
  onRefresh: () => Promise<void>;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
  onClear: (ids: string[]) => void;
  onOpenChat: (target: ChatNotificationTarget) => boolean | void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NotificationCenter({ notifications, status, onRefresh, onDismiss, onRead, onClear, onOpenChat, open, onOpenChange }: NotificationCenterProps) {
  const router = useRouter();
  const [now, setNow] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Permission prompts keep their own allow/block controls in the delivery UI.
  const notices = useMemo(() => notifications
    .filter(notice => !notice.notificationPermission)
    .slice().sort((left, right) => notificationTimestamp(right.updatedAt) - notificationTimestamp(left.updatedAt)), [notifications]);
  const unreadCount = notices.filter(notice => !notice.read).length;

  useEffect(() => {
    if (!open) return;
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    void onRefresh();
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [open, onRefresh]);

  function openNotification(notice: ToastItem) {
    if (notice.website) {
      handleWebsiteNotification(notice.website.id, "click");
      onRead(notice.id);
      onOpenChange(false);
      return;
    }
    if (!notice.target) return;
    onRead(notice.id);
    onOpenChange(false);
    if (openDesktopNotificationTarget(notice.target) || onOpenChat(notice.target) === true) return;
    const href = chatNotificationHref(notice.target);
    if (href !== `${window.location.pathname}${window.location.search}`) startNavigationProgress();
    router.push(href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!next) setSettingsOpen(false); onOpenChange(next); }}>
      <div className={appearanceStyles.anchor} data-placement="terminal">
        <Dialog.Trigger asChild>
          <button type="button" className={`${appearanceStyles.customizeButton} ${styles.bell}`}
            aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} title="Notifications">
            <Bell size={22} strokeWidth={1.65} aria-hidden="true" />
            {unreadCount > 0 && <span className={styles.unreadDot} aria-hidden="true" />}
          </button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className={panelStyles.scrim} />
        <Dialog.Content className={panelStyles.panel} data-notification-center aria-describedby={undefined}>
          <header className={panelStyles.header}>
            <div className={styles.titleGroup}>
              {settingsOpen && <button type="button" className={panelStyles.iconButton} aria-label="Back to notifications" onClick={() => setSettingsOpen(false)}>
                <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
              </button>}
              <Dialog.Title className={panelStyles.heading}>{settingsOpen ? "Settings" : "Notifications"}</Dialog.Title>
            </div>
            <div className={styles.actions}>
              {!settingsOpen && <button type="button" className={panelStyles.iconButton} aria-label="Notification settings" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={20} strokeWidth={1.7} aria-hidden="true" />
              </button>}
              <Dialog.Close className={panelStyles.iconButton} aria-label="Close notifications">
                <X size={20} strokeWidth={1.7} aria-hidden="true" />
              </Dialog.Close>
            </div>
          </header>
          {!settingsOpen && <p className={panelStyles.description}>Your updates and conversations, all in one place.</p>}
          {settingsOpen ? <div className={panelStyles.scrollArea}><NotificationCenterSettings /></div> : <>
          {notices.length > 0 && <div className={styles.clearRow}><button type="button" className={styles.clear}
            onClick={() => onClear(notices.map(notice => notice.id))}>Clear all</button></div>}
          {status === "error" && <div className={styles.error} role="alert">
            <span>Couldn’t load notifications.</span>
            <button type="button" className={panelStyles.iconButton} aria-label="Retry notifications" onClick={() => void onRefresh()}>
              <RotateCw size={18} aria-hidden="true" />
            </button>
          </div>}
          <div className={panelStyles.scrollArea} data-notification-scroll>
            {notices.length ? <ul className={styles.list} aria-label="Notifications">
              {notices.map(notice => <NotificationCard key={notice.id} notice={notice} now={now}
                onOpen={openNotification} onDismiss={onDismiss} onRead={onRead} onRefresh={onRefresh} />)}
            </ul> : status === "loading" ? <div className={styles.skeletons} role="status" aria-label="Loading notifications">
              <span /><span /><span />
            </div> : status === "ready" ? <p className={styles.empty}>No notifications</p> : null}
          </div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Keep headlines and navigation immediate. Markdown/math and reply editors
 * only mount for cards near the viewport, not all 200 historical responses. */
function NotificationCard({ notice, now, onOpen, onDismiss, onRead, onRefresh }: {
  notice: ToastItem;
  now: number;
  onOpen: (notice: ToastItem) => void;
  onDismiss: NotificationCenterProps["onDismiss"];
  onRead: NotificationCenterProps["onRead"];
  onRefresh: NotificationCenterProps["onRefresh"];
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const [formatted, setFormatted] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setFormatted(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        startTransition(() => setFormatted(true));
        observer.disconnect();
      }
    }, { root: card.closest("[data-notification-scroll]"), rootMargin: "160px 0px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const headline = notice.notificationId ? notice.message : notice.title || notice.message;
  const detail = notice.clarification?.question || notice.response || (!notice.notificationId && notice.title ? notice.message : "");
  const progress = typeof notice.progressPercent === "number" && Number.isFinite(notice.progressPercent)
    ? Math.max(0, Math.min(100, notice.progressPercent)) : null;
  const timestamp = notificationTimestamp(notice.updatedAt);
  const contents = <>
    <div className={styles.metadata}>
      <span>{notice.website?.origin || (notice.target?.surface === "garden_learn" ? notice.title : null)}</span>
      {timestamp > 0 && <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()}>
        {notificationTimeLabel(timestamp, now)}
      </time>}
    </div>
    <h2 className={styles.cardTitle}>{headline}</h2>
    {detail && (formatted ? <NotificationPreview className={notice.clarification ? styles.questionPreview : styles.preview}
      content={detail} expanded={Boolean(notice.clarification)} /> : <p className={styles.preview}>{detail.slice(0, 360)}</p>)}
    {progress !== null && <progress className={styles.progress} value={progress} max={100} aria-label="Learn progress" />}
  </>;
  return <li ref={cardRef} className={styles.card} data-notification-id={notice.id} data-error={notice.type === "error" || undefined}>
    {notice.target || notice.website ? <button type="button" className={styles.cardContent} onClick={() => onOpen(notice)}>{contents}</button>
      : <div className={styles.cardContent}>{contents}</div>}
    {formatted && notice.question && notice.clarification && <div className={styles.questionReply}>
      <NotificationQuestionReply key={`${notice.clarification.sessionId}:${notice.clarification.requestId}`}
        clarification={notice.clarification} onAnswered={() => { onRead(notice.id); void onRefresh(); }} />
    </div>}
    <button type="button" className={`${panelStyles.iconButton} ${styles.dismiss}`} aria-label={`Dismiss ${headline}`} onClick={() => onDismiss(notice.id)}>
      <X size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </li>;

}
