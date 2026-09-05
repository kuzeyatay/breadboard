"use client";

import { useCallback, useEffect } from "react";
import { Toaster, useToast } from "@/app/components/toast";
import {
  onDesktopNotificationToast,
  openDesktopNotificationTarget,
  resizeDesktopNotificationOverlay,
} from "@/lib/desktop-notification-overlay";

export default function NotificationOverlayClient() {
  const { toasts, addToast, dismissToast } = useToast({ desktopOverlay: true });

  useEffect(() => {
    return onDesktopNotificationToast((notice) => {
      if (notice.dismissed && notice.website) { dismissToast(`website:${notice.website.id}`); return; }
      addToast(
        notice.message,
        notice.type,
        notice.title,
        notice.chatId,
        notice.response,
        notice.website,
      );
    }) ?? undefined;
  }, [addToast, dismissToast]);

  const reportSize = useCallback((width: number, height: number) => {
    resizeDesktopNotificationOverlay(width, height);
  }, []);

  return (
    <main className="bb-notification-overlay-page" aria-label="Notifications">
      <Toaster
        mode="desktop-overlay"
        toasts={toasts}
        onDismiss={dismissToast}
        onOpenChat={openDesktopNotificationTarget}
        onSizeChange={reportSize}
      />
    </main>
  );
}
