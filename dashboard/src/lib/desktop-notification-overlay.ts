import {
  chatNotificationHref,
  type ChatNotificationTarget,
} from "@/lib/chat-notification-inbox";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

export interface DesktopNotificationToast {
  message: string;
  type: "success" | "error";
  title?: string;
  chatId?: string;
  response?: string;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string };
  dismissed?: boolean;
}

export function handleWebsiteNotification(id: string, action: "click" | "close"): void {
  void sendDesktopTabsCommand({ type: "browser-notification-action", id, action });
}

export function respondToWebsiteNotificationPermission(id: string, permission: NotificationPermission): Promise<boolean> {
  return sendDesktopTabsCommand({ type: "browser-notification-permission-response", id, permission });
}

interface DesktopNotificationBridge {
  publishNotificationToast?: (
    notice: DesktopNotificationToast,
  ) => Promise<boolean>;
  onNotificationToast?: (
    listener: (notice: DesktopNotificationToast) => void,
  ) => () => void;
  resizeNotificationOverlay?: (size: {
    width: number;
    height: number;
  }) => Promise<boolean>;
  tabs?: (command: {
    type: "open";
    url: string;
    background?: boolean;
  }) => Promise<boolean>;
}

function bridge(): DesktopNotificationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopNotificationBridge })
    .breadboardDesktop;
}

/** True means the native shell accepted responsibility for presenting it. */
export function publishDesktopNotificationToast(
  notice: DesktopNotificationToast,
): boolean {
  const publish = bridge()?.publishNotificationToast;
  if (!publish) return false;
  void publish(notice).catch(() => undefined);
  return true;
}

export function onDesktopNotificationToast(
  listener: (notice: DesktopNotificationToast) => void,
): (() => void) | null {
  return bridge()?.onNotificationToast?.(listener) ?? null;
}

export function resizeDesktopNotificationOverlay(width: number, height: number): void {
  const resize = bridge()?.resizeNotificationOverlay;
  if (!resize) return;
  void resize({ width, height }).catch(() => undefined);
}

/** The overlay is not a page tab, so its arrow asks the owning window to open
 * the destination instead of navigating the transparent renderer itself. */
export function openDesktopNotificationTarget(target: ChatNotificationTarget): boolean {
  const tabs = bridge()?.tabs;
  if (!tabs || typeof window === "undefined") return false;
  const url = new URL(chatNotificationHref(target), window.location.origin).toString();
  void tabs({ type: "open", url })
    .catch(() => undefined);
  return true;
}
