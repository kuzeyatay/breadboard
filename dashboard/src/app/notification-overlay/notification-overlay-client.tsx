"use client";

import { useCallback, useEffect, type CSSProperties } from "react";
import { Toaster, useToast } from "@/app/components/toast";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import {
  onDesktopNotificationToast,
  openDesktopNotificationTarget,
  resizeDesktopNotificationOverlay,
} from "@/lib/desktop-notification-overlay";

export default function NotificationOverlayClient() {
  const { toasts, addToast, dismissToast } = useToast({ desktopOverlay: true });
  const viewport = useDesktopTabs()?.notificationViewport;

  useEffect(() => {
    return onDesktopNotificationToast((notice) => {
      if (notice.dismissed && notice.notificationPermission) { dismissToast(`website-permission:${notice.notificationPermission.id}`, false); return; }
      if (notice.dismissed && notice.website) { dismissToast(`website:${notice.website.id}`, false); return; }
      addToast(
        notice.message,
        notice.type,
        notice.title,
        notice.chatId,
        notice.response,
        notice.website,
        notice.notificationPermission,
        notice.id,
      );
    }) ?? undefined;
  }, [addToast, dismissToast]);

  const reportSize = useCallback((width: number, height: number) => {
    resizeDesktopNotificationOverlay(width, height);
  }, []);

  return (
    <main className="bb-notification-overlay-page" aria-label="Notifications" style={viewport ? {
      "--bb-toast-viewport-width": `${viewport.width}px`,
      "--bb-toast-viewport-height": `${viewport.height}px`,
    } as CSSProperties : undefined}>
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
