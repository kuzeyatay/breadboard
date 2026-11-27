"use client";

import { readBrowserAssistantChatSites } from "./browser-assistant-chat-sites.ts";
import { openBrowserInDesktop } from "./desktop-browser-tabs.ts";

/**
 * Client half of `lib/hermes/chat-surface-launch.ts`: read the launch target a
 * session summary carries and open that surface on the chat.
 *
 * A launch to the page already on screen does not navigate (a same-address
 * push would leave the progress bar waiting on a route change that never
 * comes). The page's surface hears `CHAT_SURFACE_LAUNCH_EVENT` instead and
 * opens the chat in place.
 */
export type ChatSurfaceKind = "terminal" | "workspace" | "explore" | "pdf" | "browser" | "code";

export interface ChatSurfaceLaunch {
  kind: ChatSurfaceKind;
  href: string | null;
  gardenSlug?: string | null;
  pageKey?: string | null;
  legacyChatId?: number | null;
  pageSlug?: string | null;
}

export interface ChatSurfaceLaunchDetail {
  conversationId: string;
  launch: ChatSurfaceLaunch;
}

export const ASSISTANT_CHAT_PARAM = "assistantChat";
export const CHAT_SURFACE_LAUNCH_EVENT = "breadboard:chat-surface-launch";
/** The Quartz Assistant's remembered selection, per `<garden>#<page>` scope. */
export const QUARTZ_CHAT_SELECTION_KEY_PREFIX = "second-brain:quartz-ai-selection:";
const BROWSER_LAUNCH_KEY = "breadboard:browser-assistant:launch-chat";
const BROWSER_LAUNCH_FRESH_MS = 2 * 60_000;

const KINDS: readonly ChatSurfaceKind[] = ["terminal", "workspace", "explore", "pdf", "browser", "code"];

export function parseChatSurfaceLaunch(value: unknown): ChatSurfaceLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!KINDS.includes(raw.kind as ChatSurfaceKind)) return null;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  const href = text("href");
  return {
    kind: raw.kind as ChatSurfaceKind,
    href: href && href.startsWith("/") && !href.startsWith("//") ? href : null,
    gardenSlug: text("gardenSlug"),
    pageKey: text("pageKey"),
    legacyChatId: Number.isSafeInteger(raw.legacyChatId) ? (raw.legacyChatId as number) : null,
    pageSlug: text("pageSlug"),
  };
}

export function sameChatSurfaceLaunch(
  a: ChatSurfaceLaunch | null | undefined,
  b: ChatSurfaceLaunch | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.href === b.href && a.gardenSlug === b.gardenSlug &&
    a.pageKey === b.pageKey && a.legacyChatId === b.legacyChatId && a.pageSlug === b.pageSlug;
}

/** Whether this chat has a surface of its own that can be launched from here. */
export function chatSurfaceLaunchable(
  conversationId: string,
  launch: ChatSurfaceLaunch | null | undefined,
): boolean {
  if (!launch || launch.kind === "terminal") return false;
  if (launch.kind === "browser") return Boolean(readBrowserAssistantChatSites()[conversationId]?.url);
  return Boolean(launch.href);
}

export function persistQuartzChatSelection(scope: string | null, sessionId: number | null): void {
  if (typeof window === "undefined" || !scope) return;
  try {
    window.localStorage.setItem(
      `${QUARTZ_CHAT_SELECTION_KEY_PREFIX}${scope}`,
      sessionId === null ? "new" : String(sessionId),
    );
  } catch { /* The page still opens; the Assistant falls back to its newest chat. */ }
}

/** Address without the launch-only parameters, for "is this the page on screen?". */
function pageIdentity(href: string): string {
  const url = new URL(href, window.location.origin);
  url.searchParams.delete(ASSISTANT_CHAT_PARAM);
  url.searchParams.delete("chat");
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
}

/**
 * Open the chat's own surface in this tab. Resolves false when nothing could
 * be launched, so the caller can say so instead of looking busy.
 */
export async function launchChatSurface(
  detail: ChatSurfaceLaunchDetail,
  navigate: (href: string) => void,
): Promise<boolean> {
  const { conversationId, launch } = detail;
  if (launch.kind === "browser") {
    const site = readBrowserAssistantChatSites()[conversationId];
    if (!site?.url) return false;
    try {
      window.localStorage.setItem(
        BROWSER_LAUNCH_KEY,
        JSON.stringify({ chatId: conversationId, url: site.url, at: Date.now() }),
      );
    } catch { /* The site still opens; the drawer just starts on its own chat. */ }
    const opened = await openBrowserInDesktop({ url: site.url, replaceCurrent: true });
    if (!opened) {
      takeBrowserLaunchChat();
      return false;
    }
    return true;
  }
  if (launch.kind === "code") {
    // Bread runs on the extension's own origin inside VS Code, so the chat is
    // handed over through the server; Bread takes it when it next asks.
    const handed = await fetch("/api/code/bread-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: conversationId }),
    }).then((response) => response.ok, () => false);
    if (!handed) return false;
    if (window.location.pathname !== "/code") navigate("/code");
    return true;
  }
  if (!launch.href) return false;
  if (launch.kind === "explore" && launch.gardenSlug && launch.legacyChatId) {
    // The Assistant restores the selection kept for its page, so selecting the
    // chat before the reader mounts is what opens it on arrival.
    persistQuartzChatSelection(`${launch.gardenSlug}#${launch.pageKey ?? ""}`, launch.legacyChatId);
  }
  const here = `${window.location.pathname}${window.location.search}`;
  if (pageIdentity(launch.href) === pageIdentity(here)) {
    window.dispatchEvent(new CustomEvent<ChatSurfaceLaunchDetail>(CHAT_SURFACE_LAUNCH_EVENT, { detail }));
    return true;
  }
  if (launch.kind === "explore" && new URL(launch.href, window.location.origin).pathname === window.location.pathname) {
    // The reader keeps its frame across a soft navigation between its own
    // pages, so only a fresh load reliably lands on the other page with the
    // Assistant open on the selected chat.
    window.location.assign(launch.href);
    return true;
  }
  navigate(launch.href);
  return true;
}

/** Bread's half of a Code launch: the chat waiting for it, once. */
export async function takeBreadLaunchChat(): Promise<string | null> {
  try {
    const response = await fetch("/api/code/bread-launch", { method: "DELETE", cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { chatId?: unknown };
    return typeof body.chatId === "string" && body.chatId.startsWith("conv_") ? body.chatId : null;
  } catch {
    return null;
  }
}

/** The browser drawer's half of a browser launch: the chat waiting for it, once. */
export function takeBrowserLaunchChat(url?: string | null): string | null {
  try {
    const raw = window.localStorage.getItem(BROWSER_LAUNCH_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as { chatId?: unknown; url?: unknown; at?: unknown };
    if (
      typeof pending.chatId !== "string" || !pending.chatId.startsWith("conv_") ||
      typeof pending.at !== "number" || Date.now() - pending.at > BROWSER_LAUNCH_FRESH_MS
    ) {
      window.localStorage.removeItem(BROWSER_LAUNCH_KEY);
      return null;
    }
    if (url !== undefined && pending.url !== url) return null;
    window.localStorage.removeItem(BROWSER_LAUNCH_KEY);
    return pending.chatId;
  } catch {
    return null;
  }
}

/** Read and drop the `assistantChat` parameter a launch arrived with. */
export function takeAssistantChatParam(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get(ASSISTANT_CHAT_PARAM);
  if (!id) return null;
  url.searchParams.delete(ASSISTANT_CHAT_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return /^conv_[\w-]+$/.test(id) ? id : null;
}
