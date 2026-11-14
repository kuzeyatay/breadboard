"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import DashboardAgentTerminal from "@/app/components/hermes/dashboard-agent-terminal";
import BrowserNavigation from "./browser-navigation";
import BrowserOrganizationPanel from "./browser-organization-panel";
import { BROWSER_REVEAL_TERMINAL_EVENT } from "@/lib/browser-inline-answer";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useChatGreeting } from "@/app/components/hermes/use-chat-greeting";
import { ChatSuggestionCards } from '@/app/components/hermes/chat-greeting-empty-state';
import type { ChatGreetingSignals } from "@/lib/hermes/chat-greeting";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { publishDesktopNotificationToast } from "@/lib/desktop-notification-overlay";
import BrowserTabPanes from "./browser-tab-panes";
import { usePageLoading } from "@/app/components/use-page-loading";
import {
  browserBookmarksControl,
  openBrowserInDesktop,
  refreshDesktopTabsState,
  sendDesktopTabsCommand as sendTabsCommand,
  type DesktopTabsCommand,
} from "@/lib/desktop-browser-tabs";
import {
  AnimatedBrowserGreeting,
  BrowserQuickLinks,
  BrowserSketchOutline,
  GoogleGlyph,
  SearchGlyph,
  websiteIconUrl,
} from "./browser-home-widgets";
import { looksLikeBrowserAddress, searchSuggestions, type SearchSuggestion } from "./browser-recent-searches";
import PageAppearance from "@/app/components/page-appearance";
import { usePageAppearance } from "@/app/components/use-page-appearance";
import BrowserHomeAccessories from "./browser-home-accessories";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { useBrowserRecentSearches } from "./use-browser-recent-searches";
import { BrowserHistoryPanel } from "./browser-history-panel";
import { BrowserStarredPanel } from "./browser-starred-panel";
import { BrowserSuggestionList } from "./browser-suggestion-list";
import BrowserDownloadsPanel from "./browser-downloads";
import PrivateBrowserHome from "./private-browser-home";
import privateStyles from "./browser-private.module.css";
import homeControls from "@/app/new-tab/new-tab-controls.module.css";
import { useBrowserContextBookmark } from "./use-browser-context-bookmark";
import { registerClapDock } from '@/lib/speech/clap/targets';
import homeStyles from "@/app/new-tab/combined-home.module.css";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

interface BrowserBookmark {
  url: string;
  title: string;
  iconUrl: string;
}

type BrowserToolPanel = "terminal" | "history" | "visited-pages" | "starred" | "downloads";

const TERMINAL_DEFAULT_WIDTH = 640;
const TERMINAL_MIN_WIDTH = 420;
const TERMINAL_MAX_VIEWPORT_SHARE = 0.5;
const TERMINAL_SIDEBAR_EXPAND_WIDTH = 660;
const BROWSER_MIN_CONTENT_WIDTH = 320;
const MAX_BOOKMARKS = 40;

function bookmarksKey(ownerKey: string): string {
  return `breadboard:browser-bookmarks:${ownerKey}`;
}

function terminalMaxWidth(viewportWidth: number): number {
  return Math.min(
    Math.max(TERMINAL_MIN_WIDTH, Math.floor(viewportWidth * TERMINAL_MAX_VIEWPORT_SHARE)),
    Math.max(40, viewportWidth - BROWSER_MIN_CONTENT_WIDTH),
  );
}

function clampTerminalWidth(value: number, viewportWidth: number): number {
  return Math.round(Math.min(
    terminalMaxWidth(viewportWidth),
    Math.max(TERMINAL_MIN_WIDTH, value),
  ));
}

function safeBookmarkIcon(value: unknown, pageUrl: string): string {
  if (typeof value === "string" && value.length <= 2_048) {
    if (/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/iu.test(value)) {
      return value;
    }
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // The site favicon fallback below is safer than retaining an invalid URL.
    }
  }
  return websiteIconUrl(pageUrl);
}

function bookmarkFromUnknown(value: unknown): BrowserBookmark | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.title !== "string") return null;
  try {
    const url = new URL(record.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const title = record.title.trim().slice(0, 100);
    if (!title) return null;
    return {
      url: url.toString(),
      title,
      iconUrl: safeBookmarkIcon(record.iconUrl, url.toString()),
    };
  } catch {
    return null;
  }
}

function normalizeBookmarks(value: unknown): BrowserBookmark[] {
  return (Array.isArray(value) ? value : [])
    .map(bookmarkFromUnknown)
    .filter((bookmark): bookmark is BrowserBookmark => Boolean(bookmark))
    .filter((bookmark, index, values) =>
      values.findIndex((candidate) => candidate.url === bookmark.url) === index,
    )
    .slice(0, MAX_BOOKMARKS);
}

function pageBookmarkTitle(title: string | undefined, pageUrl: string): string {
  const clean = (title ?? "").trim().slice(0, 100);
  if (clean && !/^(?:browser|new tab|terminal|breadboard)$/iu.test(clean)) return clean;
  try {
    return new URL(pageUrl).hostname.replace(/^www\./iu, "").slice(0, 100);
  } catch {
    return "Bookmark";
  }
}

function looksLikeAddress(value: string): boolean {
  return looksLikeBrowserAddress(value);
}

const GOOGLE_SUGGESTION_DEBOUNCE_MS = 60;
const GOOGLE_SUGGESTION_CACHE_LIMIT = 100;
const googleSuggestionCache = new Map<string, string[]>();

function useGoogleSuggestions(query: string): string[] {
  const value = query.trim();
  const [result, setResult] = useState<{ query: string; suggestions: string[] }>({
    query: "",
    suggestions: [],
  });
  useEffect(() => {
    if (!value || looksLikeAddress(value)) {
      const frame = window.requestAnimationFrame(() => {
        setResult({ query: value, suggestions: [] });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const cacheKey = value.toLocaleLowerCase();
    const cached = googleSuggestionCache.get(cacheKey);
    if (cached) {
      const frame = window.requestAnimationFrame(() => {
        setResult({ query: value, suggestions: cached });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const url = new URL("/api/browser/suggestions", window.location.origin);
      url.searchParams.set("q", value);
      void fetch(url, { cache: "default", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Suggestions unavailable");
          const payload = (await response.json()) as { suggestions?: unknown };
          return Array.isArray(payload.suggestions)
            ? payload.suggestions.filter((entry): entry is string => typeof entry === "string")
            : [];
        })
        .then((next) => {
          const suggestions = next.slice(0, 8);
          if (googleSuggestionCache.size >= GOOGLE_SUGGESTION_CACHE_LIMIT) {
            const oldest = googleSuggestionCache.keys().next().value;
            if (oldest) googleSuggestionCache.delete(oldest);
          }
          googleSuggestionCache.set(cacheKey, suggestions);
          setResult({ query: value, suggestions });
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setResult({ query: value, suggestions: [] });
          }
        });
    }, GOOGLE_SUGGESTION_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);
  return result.query === value ? result.suggestions : [];
}

type BrowserClientProps = { showFlowers: boolean; restoreOwnerKey: string; initialGreetingSignals: ChatGreetingSignals; home?: ReactNode };

export default function BrowserClient(props: BrowserClientProps) {
  const tabs = useDesktopTabs();
  if (!tabs?.persistentShell) return <BrowserContent {...props} />;
  return <BrowserTabPanes state={tabs}>{() => <BrowserContent {...props} />}</BrowserTabPanes>;
}

function BrowserContent({
  showFlowers,
  restoreOwnerKey,
  initialGreetingSignals,
  home,
}: {
  showFlowers: boolean;
  restoreOwnerKey: string;
  initialGreetingSignals: ChatGreetingSignals;
  home?: ReactNode;
}) {
  const tabs = useDesktopTabs();
  // The outgoing page stays visible while a cold tab loads. Its navbar must
  // keep describing this page, not the newly selected (possibly non-browser) tab.
  const pageTab = tabs?.tabs.find((tab) => tab.id === (
    tabs.selfId === undefined ? tabs.activeId : tabs.selfId
  ));
  const browser = pageTab?.browser;
  const browserAvailable = Boolean(browser);
  // Bind commands to the page and document that received the input. A late
  // toolbar command must not navigate a different tab that became active.
  const sendDesktopTabsCommand = useCallback((command: DesktopTabsCommand) => {
    return sendTabsCommand({
      targetTabId: pageTab?.id, generation: pageTab?.generation,
      presentationRevision: tabs?.presentationRevision,
      ...command,
    });
  }, [pageTab?.id, pageTab?.generation, tabs?.presentationRevision]);
  useEffect(() => {
    if (!tabs?.persistentShell) return;
    void sendTabsCommand({ type: "browser-shell-context", ownerKey: restoreOwnerKey } as DesktopTabsCommand);
  }, [tabs?.persistentShell, restoreOwnerKey]);
  // The persistent shell puts a native website in front as soon as it has an
  // address, including while loading. Switch home to its rail in the same state
  // update. Legacy windows wait for a first frame, then keep the rail on reload.
  const browserKey = `${pageTab?.id ?? ""}:${browser?.uiKey ?? ""}`;
  const [nativePagePresentation, setNativePagePresentation] = useState({
    browserKey,
    visible: false,
  });
  const hasNativePage = Boolean(browser?.address) && (
    tabs?.persistentShell === true ||
    (browser?.pageReady ?? true) ||
    (nativePagePresentation.browserKey === browserKey && nativePagePresentation.visible)
  );
  if (nativePagePresentation.browserKey !== browserKey || nativePagePresentation.visible !== hasNativePage) {
    setNativePagePresentation({ browserKey, visible: hasNativePage });
  }
  const privateBrowsing = browser?.private === true;
  const isActive = Boolean(pageTab && pageTab.id === tabs?.activeId);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchFrameRef = useRef<HTMLFormElement | null>(null);
  const terminalWidthRef = useRef(TERMINAL_DEFAULT_WIDTH);
  const terminalPreferenceLoadedRef = useRef<string | null>(null);
  const terminalResizeRef = useRef<{
    pointerId: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const lastSelectionRef = useRef("");
  const browserRepairAttemptedRef = useRef(false);
  const [submittedAddress, setSubmittedAddress] = useState<string | null>(null);
  const submissionRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState("");
  const recentSearchStore = useBrowserRecentSearches(restoreOwnerKey, browser?.address, privateBrowsing);
  const recentSearches = recentSearchStore.items;
  const bookmarkStore = useBrowserSavedItems(
    restoreOwnerKey,
    bookmarksKey(restoreOwnerKey),
    browserBookmarksControl,
    normalizeBookmarks,
  );
  const bookmarks = bookmarkStore.items;
  useBrowserContextBookmark(bookmarkStore, bookmarkFromUnknown, MAX_BOOKMARKS, isActive);
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [terminalWidth, setTerminalWidthState] = useState(TERMINAL_DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(
    TERMINAL_DEFAULT_WIDTH / TERMINAL_MAX_VIEWPORT_SHARE,
  );
  const [terminalResizing, setTerminalResizing] = useState(false);
  const [activePanel, setActivePanel] = useState<BrowserToolPanel>("terminal");
  // The code arrives with the browser shell, but mounting stays on demand.
  // Opening Terminal must not wait for another chunk behind background requests,
  // and unopened browser tabs must not start chat sessions or their polling.
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [recommendationDraft, setRecommendationDraft] = useState<{ text: string; selectionKey: string; key: number } | null>(null);
  const [browserRecoveryFailed, setBrowserRecoveryFailed] = useState(false);
  usePageLoading(isActive && (submittedAddress !== null || (browser ? pageTab?.loading === true || browser.translation?.status === "translating" : !browserRecoveryFailed)));
  const chatGreeting = useChatGreeting({
    scope: "mine",
    temporary: privateBrowsing,
    initialSignals: initialGreetingSignals,
  });
  const personalization = usePageAppearance(restoreOwnerKey, "browser");
  const terminalOpen = browser?.terminalOpen ?? false;
  const selectionKey = browser?.selection
    ? browser.selection.requestId ?? `${browser.selection.url}\n${browser.selection.text}`
    : "";
  const googleSearchSuggestions = useGoogleSuggestions(!privateBrowsing && searchFocused ? searchQuery : "");
  const suggestions = useMemo(
    () => searchSuggestions(searchQuery, recentSearches, googleSearchSuggestions),
    [googleSearchSuggestions, recentSearches, searchQuery],
  );
  function setTerminalWidth(value: number) {
    const next = clampTerminalWidth(value, window.innerWidth);
    terminalWidthRef.current = next;
    setTerminalWidthState(next);
    return next;
  }

  useEffect(() => {
    if (!browserAvailable) return;
    const syncViewportWidth = (event?: UIEvent) => {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);
      const current = terminalWidthRef.current;
      const next = clampTerminalWidth(current, nextViewportWidth);
      if (next === current && !event) return;
      terminalWidthRef.current = next;
      setTerminalWidthState(next);
      // A zoom resize can leave the CSS width unchanged while its native
      // footprint changes. Relayout the website in that case as well.
      void sendDesktopTabsCommand({ type: "browser-terminal", open: terminalOpen, width: next });
    };
    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    return () => window.removeEventListener("resize", syncViewportWidth);
  }, [browserAvailable, terminalOpen, sendDesktopTabsCommand]);

  useEffect(() => {
    if (!browserAvailable || terminalPreferenceLoadedRef.current === restoreOwnerKey) return;
    const frame = window.requestAnimationFrame(() => {
      const storedWidthValue = window.localStorage.getItem(
        `breadboard:browser-terminal-width:${restoreOwnerKey}`,
      );
      const storedWidth = storedWidthValue === null ? null : Number(storedWidthValue);
      if (storedWidth !== null && Number.isFinite(storedWidth)) {
        const next = setTerminalWidth(storedWidth);
        // Restoring only the CSS drawer lets the website cover its right edge.
        void sendDesktopTabsCommand({ type: "browser-terminal", open: terminalOpen, width: next });
      }
      terminalPreferenceLoadedRef.current = restoreOwnerKey;
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [browserAvailable, restoreOwnerKey, sendDesktopTabsCommand, terminalOpen]);

  useEffect(() => {
    if (terminalPreferenceLoadedRef.current !== restoreOwnerKey || terminalResizeRef.current || !browser?.terminalWidth) return;
    const frame = window.requestAnimationFrame(() => setTerminalWidth(browser.terminalWidth));
    return () => window.cancelAnimationFrame(frame);
  }, [browser?.terminalWidth, terminalOpen, restoreOwnerKey]);

  useEffect(() => () => {
    const session = terminalResizeRef.current;
    if (!session) return;
    document.body.style.cursor = session.previousCursor;
    document.body.style.userSelect = session.previousUserSelect;
  }, []);

  const browserHomeActive = isActive && Boolean(browser) && !browser?.address;
  useEffect(() => {
    if (!browserHomeActive) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [browserHomeActive]);

  useEffect(() => {
    if (!selectionKey) {
      lastSelectionRef.current = "";
      return;
    }
    if (selectionKey === lastSelectionRef.current) return;
    lastSelectionRef.current = selectionKey;
    const frame = window.requestAnimationFrame(() => setActivePanel("terminal"));
    return () => window.cancelAnimationFrame(frame);
  }, [selectionKey]);

  useEffect(() => {
    if ((!terminalOpen && browser?.selection?.reference?.mode !== "inline") || activePanel !== "terminal" || terminalLoaded) return;
    const frame = window.requestAnimationFrame(() => setTerminalLoaded(true));
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, browser?.selection?.reference?.mode, terminalLoaded, terminalOpen]);

  useEffect(() => {
    if (browser || !tabs?.enabled || !pageTab || !isActive || browserRepairAttemptedRef.current) return;
    let isPlainBrowserRoute = false;
    try {
      isPlainBrowserRoute = new URL(pageTab.url, window.location.href).pathname === "/browser";
    } catch {
      // An invalid tab address cannot be the recoverable browser shell.
    }
    if (!isPlainBrowserRoute) return;
    browserRepairAttemptedRef.current = true;
    let live = true;
    const frame = window.requestAnimationFrame(() => {
      void openBrowserInDesktop({ replaceCurrent: true }).then(async (opened) => {
        if (!live || opened) return;
        await refreshDesktopTabsState();
        if (live) setBrowserRecoveryFailed(true);
      });
    });
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
    };
  }, [pageTab, browser, isActive, tabs?.enabled]);

  async function navigate(input: string) {
    const value = input.trim();
    if (!value) return;
    const submission = ++submissionRef.current;
    // Keep the submitted text and top bar visible through the IPC handoff,
    // before the shell publishes the new address/loading state.
    setSubmittedAddress(value);
    setSearchFocused(false);
    setHighlightedSuggestion(-1);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      // A busy history store must not delay the website request.
      void recentSearchStore.remember(value);
      if (submission !== submissionRef.current) return;
      if (browser) {
        await sendDesktopTabsCommand({ type: "browser-navigate", input: value });
        await refreshDesktopTabsState();
      } else {
        setBrowserRecoveryFailed(false);
        const opened = await openBrowserInDesktop({ url: value, replaceCurrent: true });
        if (!opened) setBrowserRecoveryFailed(true);
      }
    } finally {
      if (submission === submissionRef.current) setSubmittedAddress(null);
    }
  }

  function searchWeb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const suggestion = highlightedSuggestion >= 0 ? suggestions[highlightedSuggestion] : null;
    navigate(suggestion?.value ?? searchQuery);
  }

  function chooseSuggestion(suggestion: SearchSuggestion) {
    navigate(suggestion.value);
  }

  function saveBookmarks(next: BrowserBookmark[]) {
    void bookmarkStore.save(next);
  }

  function removeBookmark(url: string) {
    saveBookmarks(bookmarks.filter((bookmark) => bookmark.url !== url));
  }

  function removeHistoryEntry(value: string) {
    void recentSearchStore.remove(value);
  }

  function handleSearchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchFocused(true);
      setHighlightedSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchFocused(true);
      setHighlightedSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Escape") {
      setSearchFocused(false);
      setHighlightedSuggestion(-1);
    }
  }

  function setBrowserPanelOpen(open: boolean) {
    void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
    void sendDesktopTabsCommand({ type: "browser-terminal", open, width: terminalWidthRef.current });
  }

  useEffect(() => {
    if (!isActive) return;
    const reveal = () => { setTerminalLoaded(true); setActivePanel("terminal"); setBrowserPanelOpen(true); };
    window.addEventListener(BROWSER_REVEAL_TERMINAL_EVENT, reveal);
    return () => window.removeEventListener(BROWSER_REVEAL_TERMINAL_EVENT, reveal);
  });

  useEffect(() => isActive ? registerClapDock(() => {
    setTerminalLoaded(true);
    setActivePanel('terminal');
    void sendDesktopTabsCommand({ type: 'browser-address-suggestions', open: false });
    void sendDesktopTabsCommand({ type: 'browser-terminal', open: true, width: terminalWidthRef.current });
  }, 1) : undefined, [isActive, sendDesktopTabsCommand]);

  function toggleToolPanel(panel: BrowserToolPanel) {
    const nextOpen = !terminalOpen || activePanel !== panel;
    if (panel === "terminal" && nextOpen) setTerminalLoaded(true);
    setActivePanel(panel);
    setBrowserPanelOpen(nextOpen);
  }

  function resizeTerminalTo(clientX: number) {
    const next = setTerminalWidth(clientX);
    void sendDesktopTabsCommand({ type: "browser-terminal", open: true, width: next });
  }

  function startTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    terminalResizeRef.current = {
      pointerId: event.pointerId,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setTerminalResizing(true);
  }

  function moveTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (terminalResizeRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    resizeTerminalTo(event.clientX);
  }

  function finishTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = terminalResizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    terminalResizeRef.current = null;
    document.body.style.cursor = session.previousCursor;
    document.body.style.userSelect = session.previousUserSelect;
    setTerminalResizing(false);
    window.localStorage.setItem(
      `breadboard:browser-terminal-width:${restoreOwnerKey}`,
      String(terminalWidthRef.current),
    );
    void sendDesktopTabsCommand({
      type: "browser-terminal",
      open: true,
      width: terminalWidthRef.current,
    });
  }

  function handleTerminalResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home"
      ? TERMINAL_MIN_WIDTH
      : event.key === "End"
        ? terminalMaxWidth(window.innerWidth)
        : terminalWidthRef.current + (event.key === "ArrowLeft" ? -24 : 24);
    resizeTerminalTo(next);
    window.localStorage.setItem(
      `breadboard:browser-terminal-width:${restoreOwnerKey}`,
      String(terminalWidthRef.current),
    );
  }

  function retryBrowser() {
    setBrowserRecoveryFailed(false);
    browserRepairAttemptedRef.current = false;
    void refreshDesktopTabsState().then(() =>
      openBrowserInDesktop({ replaceCurrent: true }),
    ).then((opened) => {
      if (!opened) setBrowserRecoveryFailed(true);
    });
  }

  const selectionDraft = browser?.selection && !browser.selection.reference
    ? `Ask about this selection from ${browser.selection.title}:\n\n“${browser.selection.text}”\n\n`
    : null;
  const normalizedAddress = (() => {
    try {
      return browser?.address ? new URL(browser.address).toString() : "";
    } catch {
      return "";
    }
  })();
  useEffect(() => {
    if (!isActive) return;
    const action = (event: Event) => {
      const panel = (event as CustomEvent).detail;
      if (panel !== "history" && panel !== "visited-pages" && panel !== "bookmarks" && panel !== "downloads") return;
      setActivePanel(panel === "bookmarks" ? "starred" : panel);
      void sendDesktopTabsCommand({ type: "browser-terminal", open: true });
    };
    window.addEventListener("breadboard:browser-menu-action", action);
    return () => window.removeEventListener("breadboard:browser-menu-action", action);
  }, [isActive, sendDesktopTabsCommand]);
  const closePanelButton = (
    <button type="button" className="browser-terminal-close" onClick={() => setBrowserPanelOpen(false)} aria-label={`Close ${activePanel === "terminal" ? "Terminal" : activePanel === "history" ? "history" : activePanel === "visited-pages" ? "visited pages" : activePanel === "downloads" ? "downloads" : "starred pages"}`} title="Close panel">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" {...STROKE} /></svg>
    </button>
  );

  const startSearch = (
    <form ref={searchFrameRef} className={privateBrowsing ? homeControls.search : "browser-home-search"} onSubmit={searchWeb}>
      {privateBrowsing ? <Search size={19} aria-hidden="true" /> : <GoogleGlyph />}
      <input
        ref={searchRef}
        type="search"
        role="combobox"
        aria-label="Search the web or enter a web address"
        aria-autocomplete="list"
        aria-controls="browser-search-suggestions"
        aria-expanded={searchFocused && suggestions.length > 0}
        aria-activedescendant={highlightedSuggestion >= 0 ? `browser-search-suggestions-${highlightedSuggestion}` : undefined}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Search with Google or enter an address"
        value={searchQuery}
        onPointerDown={() => setSearchFocused(true)}
        onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
        onKeyDown={handleSearchKeys}
        onChange={(event) => {
          setSearchQuery(event.target.value);
          setSearchFocused(true);
          setHighlightedSuggestion(-1);
        }}
      />
      <button type="submit" className={privateBrowsing ? privateStyles.searchButton : undefined} aria-label="Search the web"><SearchGlyph /></button>
      <BrowserSketchOutline targetRef={searchFrameRef} index={0} />
      {searchFocused && suggestions.length ? (
        <BrowserSuggestionList
          id="browser-search-suggestions"
          suggestions={suggestions}
          highlighted={highlightedSuggestion}
          onHighlight={setHighlightedSuggestion}
          onChoose={chooseSuggestion}
          onRemoveHistory={(value) => {
            removeHistoryEntry(value);
            setHighlightedSuggestion(-1);
          }}
        />
      ) : null}
    </form>
  );

  // Private home shares Terminal layout while retaining private browser search.
  // A normal empty browser now presents the same live home as a new app tab.
  // Before native state arrives, the browser route may already be opening a
  // website. Do not briefly mount the terminal home as its hydration fallback.
  const showingHome = Boolean(home && browser && !hasNativePage && !privateBrowsing);
  const privateHome = privateBrowsing && !hasNativePage;
  const browserTools = (
    <nav className={privateHome ? homeControls.places : "browser-side-rail"} aria-label="Browser tools" data-open={terminalOpen} data-panel={activePanel}>
      <div className={privateHome ? privateStyles.actions : "browser-rail-actions"}>
        <button
          type="button"
          className={privateHome ? homeControls.destinationButton : "browser-terminal-launcher"}
          aria-label={terminalOpen && activePanel === "terminal" ? "Close Terminal" : "Open Terminal"}
          aria-pressed={terminalOpen && activePanel === "terminal"}
          title="Terminal"
          onClick={() => toggleToolPanel("terminal")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 4 4-4 4m7 0h7" {...STROKE} /></svg>
          {privateHome && "Terminal"}
        </button>
        <button
          type="button"
          className={privateHome ? homeControls.destinationButton : "browser-terminal-launcher"}
          aria-label={terminalOpen && activePanel === "history" ? "Close history" : "Open history"}
          aria-pressed={terminalOpen && activePanel === "history"}
          title="Browsing history"
          onClick={() => toggleToolPanel("history")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" {...STROKE} /><path d="M12 8v4.4l3 1.7M5.2 6.8 3.8 9.5" {...STROKE} /></svg>
          {privateHome && "History"}
        </button>
        <button
          type="button"
          className={privateHome ? homeControls.destinationButton : "browser-terminal-launcher"}
          aria-label={terminalOpen && activePanel === "starred" ? "Close starred pages" : "Open starred pages"}
          aria-pressed={terminalOpen && activePanel === "starred"}
          title="Starred"
          onClick={() => toggleToolPanel("starred")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.05 5.57.81-4.03 3.93.95 5.55L12 16.32l-4.99 2.62.95-5.55L3.93 9.46l5.57-.81L12 3.6Z" {...STROKE} /></svg>
          {privateHome && "Starred"}
        </button>
        {browser && !privateBrowsing && tabs?.browserPreferences?.organizationSidebarEnabled !== false && <button
          type="button"
          className="browser-terminal-launcher"
          aria-label="Organization"
          title="Organization — Coming soon"
          onClick={() => publishDesktopNotificationToast({ message: "Coming soon", type: "success" })}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="3" {...STROKE} /><path d="M12 3.5v13" {...STROKE} /></svg>
        </button>}
        <button
          type="button"
          className={privateHome ? homeControls.destinationButton : "browser-terminal-launcher"}
          aria-label={terminalOpen && activePanel === "downloads" ? "Close downloads" : "Open downloads"}
          aria-pressed={terminalOpen && activePanel === "downloads"}
          title="Downloads"
          onClick={() => toggleToolPanel("downloads")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" {...STROKE} /></svg>
          {privateHome && "Downloads"}
        </button>
      </div>
      {!privateHome && <svg className="browser-rail-sketch" viewBox="0 0 18 600" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength={1} d="M9 4 C6 92 12 170 8 256 S12 418 8 596" />
        <path pathLength={1} d="M11 4 C8 104 13 188 9 274 S13 432 10 596" />
      </svg>}
    </nav>
  );

  return (
    <>
      {showingHome ? <div className={homeStyles.browserHome} data-persistent-shell={tabs?.persistentShell || undefined}>
        {tabs?.persistentShell && <div style={{ height: 103, flexShrink: 0 }} aria-hidden="true" />}
        {home}
      </div> : <>
      {tabs?.persistentShell ? <div style={{ height: 103, flexShrink: 0 }} aria-hidden="true" /> :
        <BrowserNavigation showFlowers={showFlowers} restoreOwnerKey={restoreOwnerKey} onPanel={panel => { setActivePanel(panel); setBrowserPanelOpen(true); }} />}

      {!browser && browserRecoveryFailed ? (
        <div className="browser-recovery-error" role="alert">
          <span>Couldn’t open the browser.</span>
          <button type="button" onClick={retryBrowser}>Try again</button>
          <Link href="/new-tab">Back to home</Link>
        </div>
      ) : null}

      {privateHome ? (
        <PrivateBrowserHome ownerKey={restoreOwnerKey} active={isActive} navigate={navigate}>
          {startSearch}
          {browserTools}
        </PrivateBrowserHome>
      ) : <main
        className="browser-start-page browser-home-widget-surface"
        data-native-page={hasNativePage}
        aria-live="polite"
        data-wallpaper-ready={personalization.ready}
        data-has-wallpaper={personalization.hasWallpaper}
        data-wallpaper-tone={personalization.wallpaperTone}
        style={personalization.ready && personalization.wallpaper ? {
          "--browser-wallpaper-image": `url("${personalization.wallpaper.src}")`,
        } as CSSProperties : undefined}
      >
        {!hasNativePage && <PageAppearance page="browser" ownerKey={restoreOwnerKey} />}
        {!hasNativePage ? (
          <div className="browser-start-copy">
            <AnimatedBrowserGreeting greeting={chatGreeting.greeting} />
            {startSearch}
            {!privateBrowsing && Object.keys(chatGreeting.suggestionSources).length > 0 ? (
              <div className="mx-auto mt-4 w-full max-w-xl">
                <ChatSuggestionCards suggestions={chatGreeting.suggestions}
                  suggestionScopeKey={chatGreeting.suggestionScopeKey}
                  suggestionDetails={chatGreeting.suggestionDetails}
                  onSelectSuggestion={prompt => {
                    setRecommendationDraft(previous => ({ text: prompt, selectionKey, key: (previous?.key ?? 0) + 1 }));
                    setTerminalLoaded(true);
                    setActivePanel('terminal');
                    setBrowserPanelOpen(true);
                  }} />
              </div>
            ) : null}
            <BrowserQuickLinks navigate={navigate} ownerKey={restoreOwnerKey} active={isActive} />
          </div>
        ) : null}
        {!hasNativePage ? (
          <>
            <BrowserHomeAccessories ownerKey={restoreOwnerKey} active={isActive} />

          </>
        ) : null}
      </main>}
      </>}

      {!showingHome && !privateHome && browserTools}

      {browser?.organizationOpen && !browser.private && tabs?.browserPreferences?.organizationSidebarEnabled !== false && <BrowserOrganizationPanel
        key={pageTab?.id} url={browser.address} title={pageTab?.title ?? ""} target={browser.annotationTarget}
        send={sendDesktopTabsCommand} onClose={() => void sendDesktopTabsCommand({ type: "browser-organization", open: false })} />}

      {(!showingHome || terminalOpen) && <aside
        className="browser-terminal-drawer"
        data-open={terminalOpen}
        data-resizing={terminalResizing}
        aria-hidden={!terminalOpen}
        inert={!terminalOpen ? true : undefined}
        data-panel={activePanel}
        style={{ "--browser-terminal-width": `${terminalWidth}px` } as CSSProperties}
      >
        {activePanel === "terminal" ? closePanelButton : null}
        <div className="browser-tool-panel browser-tool-panel-terminal" data-active={activePanel === "terminal"} aria-hidden={activePanel !== "terminal"} inert={activePanel !== "terminal" ? true : undefined}>
          {/* Ask here owns a live chat even while this drawer is covered. A
              covered native renderer may not receive the animation frame
              that normally finishes lazy mounting the visible panel. */}
          {terminalLoaded || browser?.selection?.reference?.mode === "inline" ? (
            <DashboardAgentTerminal
              scope="mine"
              restoreOwnerKey={restoreOwnerKey}
              presentation="drawer"
              drawerSidebarExpanded={terminalWidth >= TERMINAL_SIDEBAR_EXPAND_WIDTH}
              initialDraft={recommendationDraft?.selectionKey === selectionKey ? recommendationDraft.text : selectionDraft}
              initialDraftKey={recommendationDraft?.selectionKey === selectionKey ? recommendationDraft.key : undefined}
              initialChatId={browser?.selection?.conversationId}
              webSelection={browser?.selection?.requestId && browser.selection.reference ? {
                requestId: browser.selection.requestId, reference: browser.selection.reference,
                conversationId: browser.selection.conversationId,
              } : null}
              viewingWebsite={hasNativePage && /^https?:\/\//iu.test(browser?.address ?? "")
                ? pageBookmarkTitle(pageTab?.title, browser?.address ?? "")
                : null}
            />
          ) : null}
        </div>
        <BrowserHistoryPanel active={isActive && terminalOpen && (activePanel === "history" || activePanel === "visited-pages")} visitedOnly={activePanel === "visited-pages"} searches={recentSearchStore} navigate={navigate} closeButton={closePanelButton} />
        <BrowserStarredPanel active={activePanel === "starred"} bookmarks={bookmarks} ready={bookmarkStore.ready && !bookmarkStore.saving} normalizedAddress={normalizedAddress} navigate={navigate} remove={removeBookmark} closeButton={closePanelButton} />
        <BrowserDownloadsPanel active={isActive && terminalOpen && activePanel === "downloads"} closeButton={closePanelButton} />
        <div
          className="browser-terminal-resizer"
          role="separator"
          aria-label="Resize browser panel"
          aria-orientation="vertical"
          aria-valuemin={Math.min(TERMINAL_MIN_WIDTH, terminalMaxWidth(viewportWidth))}
          aria-valuemax={terminalMaxWidth(viewportWidth)}
          aria-valuenow={terminalWidth}
          tabIndex={terminalOpen ? 0 : -1}
          onDoubleClick={() => resizeTerminalTo(TERMINAL_DEFAULT_WIDTH)}
          onKeyDown={handleTerminalResizeKey}
          onPointerDown={startTerminalResize}
          onPointerMove={moveTerminalResize}
          onPointerUp={finishTerminalResize}
          onPointerCancel={finishTerminalResize}
        />
      </aside>}
    </>
  );
}
