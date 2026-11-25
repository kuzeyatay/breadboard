"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { SideChatContext, type SideChatRequest } from "../side-chat-context";
import { useStarredMessages } from "../use-starred-messages";

const SideChatPanel = lazy(() => import("./side-chat-panel"));

const MAX_SIDE_CHATS = 4;
const WIDTH_KEY = "breadboard:side-chat:width";
const MIN_WIDTH = 320;

type OpenedSideChat = SideChatRequest & { key: string };

function readWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? value : null;
  } catch {
    return null;
  }
}

// tmux-like tiling: one pane fills the dock, two sit side by side, three keep
// the first pane tall on the left, four make a 2x2 grid.
function paneArea(index: number, count: number): string {
  if (count === 3 && index === 0) return "row-span-2";
  return "";
}

/** Side-chat host per workspace: up to four tiled panes in one resizable dock. */
export default function WorkspaceSideChat({ children, gardenSlug, messages = [], hidden = false, onReveal }: {
  children: ReactElement;
  gardenSlug?: string;
  messages?: readonly { role: string; content: string }[];
  /** Hide the dock without closing its chats, e.g. while the host terminal is shut. */
  hidden?: boolean;
  /** Called when a side chat is opened while hidden, so the host can show itself. */
  onReveal?: () => void;
}) {
  const [opened, setOpened] = useState<OpenedSideChat[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [width, setWidth] = useState<number | null>(null);
  const { saving } = useStarredMessages();
  const returnFocus = useRef<HTMLElement | null>(null);
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => setWidth(readWidth()), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const focusPane = useCallback((key: string) => {
    setActive(key);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(`[data-side-chat-pane="${key}"] textarea`)?.focus();
    });
  }, []);

  const open = useCallback((request?: SideChatRequest) => {
    if (saving) return;
    if (openedRef.current.length >= MAX_SIDE_CHATS) {
      setNotice(`${MAX_SIDE_CHATS} side chats are open. Close one to start another.`);
      return;
    }
    if (!openedRef.current.length) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // Snapshot the visible conversation only when the side chat opens. Its
    // later turns must neither modify nor follow changes in the main thread.
    const context = request?.conversationId || request?.quote ? undefined : messages.slice(-8)
      .filter(message => message.role === "user" || message.role === "assistant")
      .map(message => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n").slice(-12000) || undefined;
    const key = crypto.randomUUID();
    setOpened(current => [...current, { ...request, context, key }]);
    setActive(key);
    if (hiddenRef.current) onRevealRef.current?.();
  }, [saving, messages]);

  const close = useCallback((key: string) => {
    const remaining = openedRef.current.filter(item => item.key !== key);
    setOpened(remaining);
    setTitles(({ [key]: _closed, ...rest }) => rest);
    const next = remaining.at(-1);
    if (next) focusPane(next.key);
    else returnFocus.current?.focus();
  }, [focusPane]);

  const setTitle = useCallback((key: string, title: string) => {
    setTitles(current => current[key] === title ? current : { ...current, [key]: title });
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const conversationId = query.get("sideChat");
    if (!conversationId) return;
    const frame = window.requestAnimationFrame(() => {
      open({ conversationId, messageId: query.get("message") ?? undefined });
    });
    return () => window.cancelAnimationFrame(frame);
    // Only the URL present at mount opens a saved chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dock = event.currentTarget.parentElement;
    if (!dock) return;
    const right = dock.getBoundingClientRect().right;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let latest = dock.getBoundingClientRect().width;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.round(Math.min(window.innerWidth - 32, Math.max(MIN_WIDTH, right - moveEvent.clientX)));
      setWidth(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      try { window.localStorage.setItem(WIDTH_KEY, String(latest)); } catch { /* width is a convenience */ }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }, []);

  const resizeWithKeys = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 512;
    const next = Math.min(window.innerWidth - 32, Math.max(MIN_WIDTH, current + (event.key === "ArrowLeft" ? 48 : -48)));
    setWidth(next);
    try { window.localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* width is a convenience */ }
  }, []);

  const count = opened.length;
  const defaultWidth = count > 1 ? "min(64rem, calc(100vw - 2rem))" : "min(32rem, calc(100vw - 2rem))";

  return <SideChatContext.Provider value={open}>
    {children}
    {count ? createPortal(
      <SideChatContext.Provider value={null}>
        <div data-side-chat-dock hidden={hidden} aria-hidden={hidden || undefined} inert={hidden || undefined}
          className={`fixed bottom-4 right-4 top-20 z-[150] ${hidden ? "hidden" : "flex"} min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-2xl`}
          style={{ width: width ? `min(${width}px, calc(100vw - 2rem))` : defaultWidth }}>
          <div role="separator" aria-orientation="vertical" aria-label="Resize side chat" tabIndex={0}
            title="Drag to resize. Double-click to reset."
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-[var(--botanical)]/40 focus-visible:bg-[var(--botanical)]/60 focus-visible:outline-none"
            onPointerDown={startResize} onKeyDown={resizeWithKeys}
            onDoubleClick={() => {
              setWidth(null);
              try { window.localStorage.removeItem(WIDTH_KEY); } catch { /* width is a convenience */ }
            }} />
          <div className={`grid min-h-0 flex-1 gap-px bg-[var(--line)] ${count > 1 ? "grid-cols-2" : "grid-cols-1"} ${count > 2 ? "grid-rows-2" : "grid-rows-1"}`}>
            {opened.map((request, index) => (
              <div key={request.key} data-side-chat-pane={request.key}
                className={`min-h-0 min-w-0 bg-[var(--paper-raised)] ${paneArea(index, count)}`}
                onFocusCapture={() => setActive(request.key)} onPointerDownCapture={() => setActive(request.key)}>
                <Suspense fallback={null}>
                  <SideChatPanel request={request} gardenSlug={gardenSlug} index={index}
                    active={count > 1 && active === request.key}
                    onTitle={title => setTitle(request.key, title)}
                    onClose={() => close(request.key)} />
                </Suspense>
              </div>
            ))}
          </div>
          <nav aria-label="Side chats" className="flex shrink-0 items-center gap-1 border-t border-[var(--line)] bg-[var(--paper-strong)] px-2 py-1 font-mono text-[11px]">
              {opened.map((request, index) => (
                <button key={request.key} type="button" onClick={() => focusPane(request.key)}
                  aria-current={active === request.key ? "true" : undefined}
                  className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 ${active === request.key ? "bg-[#4f6f68] text-[#fff]" : "text-[var(--ink-muted)] hover:bg-[var(--paper-raised)]"}`}>
                  {index}:{titles[request.key] || "side chat"}{active === request.key ? "*" : ""}
                </button>
              ))}
              <span role="status" className="ml-auto truncate text-[var(--ink-muted)]">{notice || `${count}/${MAX_SIDE_CHATS}`}</span>
              <button type="button" aria-label="New side chat" title="New side chat" disabled={count >= MAX_SIDE_CHATS || saving}
                className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--paper-raised)] disabled:opacity-40" onClick={() => open()}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </nav>
        </div>
      </SideChatContext.Provider>, document.body,
    ) : null}
  </SideChatContext.Provider>;
}
