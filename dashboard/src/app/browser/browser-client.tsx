"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useChatGreeting } from "@/app/components/hermes/use-chat-greeting";
import type { ChatGreetingSignals } from "@/lib/hermes/chat-greeting";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { usePageLoading } from "@/app/components/use-page-loading";
import {
  browserBookmarksControl,
  openBrowserInDesktop,
  refreshDesktopTabsState,
  sendDesktopTabsCommand,
} from "@/lib/desktop-browser-tabs";
import {
  AnimatedBrowserGreeting,
  BrowserQuickLinks,
  BrowserSiteIcon,
  BrowserSketchOutline,
  GoogleGlyph,
  SearchGlyph,
  websiteIconUrl,
} from "./browser-home-widgets";
import { looksLikeBrowserAddress, searchSuggestions, type SearchSuggestion } from "./browser-recent-searches";
import PageAppearance from "@/app/components/page-appearance";
import { usePageAppearance } from "@/app/components/use-page-appearance";
import BrowserHomeAccessories from "./browser-home-accessories";
import { browserAddressDisplayValue } from "./browser-address-display";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { useBrowserRecentSearches } from "./use-browser-recent-searches";
import { useBrowserAddressSuggestions } from "./use-browser-address-suggestions";
import { BrowserHistoryPanel } from "./browser-history-panel";
import BrowserDownloadsPanel from "./browser-downloads";
import BrowserDownloadsButton from "./browser-downloads-button";
import BrowserExtensionsButton from "./browser-extensions-button";
import BrowserMenuControls from "./browser-menu-controls";
import privateStyles from "./browser-private.module.css";
import PrivateBrowserGreeting from "./private-browser-greeting";
import BrowserTranslationControls from "./browser-translation-controls";
import { useBrowserBookmarkReorder } from "./use-browser-bookmark-reorder";
import { useBrowserContextBookmark } from "./use-browser-context-bookmark";
import { registerClapDock } from '@/lib/speech/clap/targets';

const DashboardAgentTerminal = dynamic(
  () => import("@/app/components/hermes/dashboard-agent-terminal"),
  {
    ssr: false,
    loading: () => <div className="browser-tool-loading"><span className="bb-tab-spinner" aria-hidden="true" />Loading Terminal…</div>,
  },
);

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

type BrowserToolPanel = "terminal" | "history" | "starred" | "downloads";

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
  return Math.max(
    TERMINAL_MIN_WIDTH,
    Math.floor(viewportWidth * TERMINAL_MAX_VIEWPORT_SHARE),
  );
}

function clampTerminalWidth(value: number, viewportWidth: number): number {
  const available = Math.max(TERMINAL_MIN_WIDTH, viewportWidth - BROWSER_MIN_CONTENT_WIDTH);
  return Math.round(Math.max(
    TERMINAL_MIN_WIDTH,
    Math.min(terminalMaxWidth(viewportWidth), available, value),
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
  if (clean && !/^(?:browser|new tab|breadboard)$/iu.test(clean)) return clean;
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

function BrowserSuggestionGlyph({ source }: { source: SearchSuggestion["source"] }) {
  return source === "history" ? (
    <svg className="browser-suggestion-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" {...STROKE} />
      <path d="M10 6.4V10l2.6 1.7" {...STROKE} />
    </svg>
  ) : (
    <SearchGlyph className="browser-suggestion-glyph" />
  );
}

function BrowserSuggestionList({
  id,
  suggestions,
  highlighted,
  onHighlight,
  onChoose,
  onRemoveHistory,
  address = false,
  dropdownRef,
}: {
  id: string;
  suggestions: readonly SearchSuggestion[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (suggestion: SearchSuggestion) => void;
  onRemoveHistory: (value: string) => void;
  address?: boolean;
  dropdownRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={dropdownRef} id={id} className={`browser-search-suggestions ${address ? "browser-address-suggestions" : ""}`} role="listbox" aria-label={address ? "Address suggestions and recent searches" : "Search suggestions and recent searches"}>
      {suggestions.map((suggestion, index) => (
        <div
          key={`${suggestion.source}-${suggestion.value}`}
          id={`${id}-${index}`}
          className="browser-suggestion-row"
          data-source={suggestion.source}
          role="option"
          aria-selected={highlighted === index}
          data-selected={highlighted === index}
          onMouseEnter={() => onHighlight(index)}
        >
          <button
            type="button"
            className="browser-suggestion-select"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(suggestion)}
          >
            <BrowserSuggestionGlyph source={suggestion.source} />
            <span className="browser-suggestion-copy">
              <strong>{suggestion.label}</strong>
              {suggestion.detail ? <small>— {suggestion.detail}</small> : null}
            </span>
          </button>
          {suggestion.source === "history" ? (
            <button
              type="button"
              className="browser-suggestion-remove"
              aria-label={`Remove ${suggestion.label} from recent searches`}
              title="Remove from recent searches"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveHistory(suggestion.value);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function BrowserClient({
  showFlowers,
  restoreOwnerKey,
  initialGreetingSignals,
}: {
  showFlowers: boolean;
  restoreOwnerKey: string;
  initialGreetingSignals: ChatGreetingSignals;
}) {
  const tabs = useDesktopTabs();
  // The outgoing page stays visible while a cold tab loads. Its navbar must
  // keep describing this page, not the newly selected (possibly non-browser) tab.
  const pageTab = tabs?.tabs.find((tab) => tab.id === (
    tabs.selfId === undefined ? tabs.activeId : tabs.selfId
  ));
  const browser = pageTab?.browser;
  // The address changes as soon as navigation starts. Only let the native
  // page show through once it is ready to cover the dashboard underneath.
  const hasNativePage = Boolean(browser?.address) && (browser?.pageReady ?? true);
  const privateBrowsing = browser?.private === true;
  const isActive = Boolean(pageTab && pageTab.id === tabs?.activeId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchFrameRef = useRef<HTMLFormElement | null>(null);
  const terminalWidthRef = useRef(TERMINAL_DEFAULT_WIDTH);
  const terminalPreferenceLoadedRef = useRef(false);
  const terminalResizeRef = useRef<{
    pointerId: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const lastSelectionRef = useRef("");
  const browserRepairAttemptedRef = useRef(false);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
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
  useBrowserContextBookmark(bookmarkStore, bookmarkFromUnknown, MAX_BOOKMARKS);
  const bookmarkReorder = useBrowserBookmarkReorder(
    restoreOwnerKey,
    bookmarks,
    bookmarkStore.ready && !bookmarkStore.saving,
    bookmarkStore.save,
  );
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [addressFocused, setAddressFocused] = useState(false);
  const [highlightedAddressSuggestion, setHighlightedAddressSuggestion] = useState(-1);
  const [terminalWidth, setTerminalWidthState] = useState(TERMINAL_DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(
    TERMINAL_DEFAULT_WIDTH / TERMINAL_MAX_VIEWPORT_SHARE,
  );
  const [terminalResizing, setTerminalResizing] = useState(false);
  const [activePanel, setActivePanel] = useState<BrowserToolPanel>("terminal");
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [browserRecoveryFailed, setBrowserRecoveryFailed] = useState(false);
  usePageLoading(submittedAddress !== null || (browser ? pageTab?.loading === true || browser.translation?.status === "translating" : !browserRecoveryFailed));
  const address = draftAddress ?? submittedAddress ?? browser?.address ?? "";
  const addressDisplay = draftAddress ?? submittedAddress ?? browserAddressDisplayValue(browser?.address ?? "");
  const addressLookupQuery = addressFocused && address === browser?.address ? "" : address;
  const chatGreeting = useChatGreeting({
    scope: "mine",
    temporary: false,
    initialSignals: initialGreetingSignals,
  });
  const personalization = usePageAppearance(restoreOwnerKey, "browser");
  const terminalOpen = browser?.terminalOpen ?? false;
  const selectionKey = browser?.selection
    ? `${browser.selection.url}\n${browser.selection.text}`
    : "";
  const googleSearchSuggestions = useGoogleSuggestions(!privateBrowsing && searchFocused ? searchQuery : "");
  const googleAddressSuggestions = useGoogleSuggestions(!privateBrowsing && addressFocused ? addressLookupQuery : "");
  const suggestions = useMemo(
    () => searchSuggestions(searchQuery, recentSearches, googleSearchSuggestions),
    [googleSearchSuggestions, recentSearches, searchQuery],
  );
  const addressSuggestions = useMemo(
    () => searchSuggestions(addressLookupQuery, recentSearches, googleAddressSuggestions),
    [addressLookupQuery, googleAddressSuggestions, recentSearches],
  );

  function setTerminalWidth(value: number) {
    const next = clampTerminalWidth(value, window.innerWidth);
    terminalWidthRef.current = next;
    setTerminalWidthState(next);
    return next;
  }

  useEffect(() => {
    const syncViewportWidth = () => {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);
      const current = terminalWidthRef.current;
      const next = clampTerminalWidth(current, nextViewportWidth);
      if (next === current) return;
      terminalWidthRef.current = next;
      setTerminalWidthState(next);
      void sendDesktopTabsCommand({ type: "browser-terminal", open: terminalOpen, width: next });
    };
    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    return () => window.removeEventListener("resize", syncViewportWidth);
  }, [terminalOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedWidthValue = window.localStorage.getItem(
        `breadboard:browser-terminal-width:${restoreOwnerKey}`,
      );
      const storedWidth = storedWidthValue === null ? null : Number(storedWidthValue);
      if (storedWidth !== null && Number.isFinite(storedWidth)) setTerminalWidth(storedWidth);
      terminalPreferenceLoadedRef.current = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [restoreOwnerKey]);

  useEffect(() => {
    if (!terminalPreferenceLoadedRef.current || terminalResizeRef.current || !browser?.terminalWidth) return;
    const frame = window.requestAnimationFrame(() => setTerminalWidth(browser.terminalWidth));
    return () => window.cancelAnimationFrame(frame);
  }, [browser?.terminalWidth]);

  const addressSuggestionsRef = useBrowserAddressSuggestions(
    Boolean(browser?.address && addressFocused && addressSuggestions.length),
  );

  useEffect(() => () => {
    const session = terminalResizeRef.current;
    if (!session) return;
    document.body.style.cursor = session.previousCursor;
    document.body.style.userSelect = session.previousUserSelect;
  }, []);

  useEffect(() => {
    const focusAddress = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("breadboard:focus-browser-address", focusAddress);
    if (isActive && browser && !browser.address) requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("breadboard:focus-browser-address", focusAddress);
  }, [browser, browser?.address, isActive]);

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
    if (!terminalOpen || activePanel !== "terminal" || terminalLoaded) return;
    const frame = window.requestAnimationFrame(() => setTerminalLoaded(true));
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, terminalLoaded, terminalOpen]);

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
    // Keep the submitted text and top bar visible through saving and the IPC
    // handoff, before the shell can publish the new address/loading state.
    setSubmittedAddress(value);
    setDraftAddress(null);
    setSearchFocused(false);
    setHighlightedSuggestion(-1);
    setAddressFocused(false);
    setHighlightedAddressSuggestion(-1);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      // Finish the durable save before handing the search to the browser.
      await recentSearchStore.remember(value);
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

  function navigateFromAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const suggestion = highlightedAddressSuggestion >= 0
      ? addressSuggestions[highlightedAddressSuggestion]
      : null;
    navigate(suggestion?.value ?? address);
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

  function toggleCurrentBookmark() {
    const pageUrl = browser?.address;
    if (!pageUrl) return;
    let normalizedUrl: string;
    try {
      const parsed = new URL(pageUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      normalizedUrl = parsed.toString();
    } catch {
      return;
    }
    const existing = bookmarks.find((bookmark) => bookmark.url === normalizedUrl);
    if (existing) {
      removeBookmark(normalizedUrl);
      return;
    }
    saveBookmarks([
      ...bookmarks,
      {
        url: normalizedUrl,
        title: pageBookmarkTitle(pageTab?.title, normalizedUrl),
        iconUrl: safeBookmarkIcon(browser?.favicon, normalizedUrl),
      },
    ]);
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

  function handleAddressKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setAddressFocused(false);
      setHighlightedAddressSuggestion(-1);
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
      event.currentTarget.blur();
      return;
    }
    if (!addressSuggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedAddressSuggestion((current) => (current + 1) % addressSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedAddressSuggestion((current) =>
        current <= 0 ? addressSuggestions.length - 1 : current - 1,
      );
    }
  }

  function setBrowserPanelOpen(open: boolean) {
    setAddressFocused(false);
    void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
    void sendDesktopTabsCommand({ type: "browser-terminal", open, width: terminalWidthRef.current });
  }

  useEffect(() => registerClapDock(() => {
    setTerminalLoaded(true);
    setActivePanel('terminal');
    setAddressFocused(false);
    void sendDesktopTabsCommand({ type: 'browser-address-suggestions', open: false });
    void sendDesktopTabsCommand({ type: 'browser-terminal', open: true, width: terminalWidthRef.current });
  }, 1), []);

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

  const selectionDraft = browser?.selection
    ? `Ask about this selection from ${browser.selection.title}:\n\n“${browser.selection.text}”\n\n`
    : null;
  const normalizedAddress = (() => {
    try {
      return browser?.address ? new URL(browser.address).toString() : "";
    } catch {
      return "";
    }
  })();
  const currentBookmarked = Boolean(
    normalizedAddress && bookmarks.some((bookmark) => bookmark.url === normalizedAddress),
  );
  const closePanelButton = (
    <button type="button" className="browser-terminal-close" onClick={() => setBrowserPanelOpen(false)} aria-label={`Close ${activePanel === "terminal" ? "Terminal" : activePanel === "history" ? "history" : activePanel === "downloads" ? "downloads" : "starred pages"}`} title="Close panel">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" {...STROKE} /></svg>
    </button>
  );

  return (
    <>
      <div className="browser-toolbar" role="toolbar" aria-label="Browser navigation">
        <NavbarFlowerWind showFlowers={showFlowers} />
        <div className="browser-navigation-controls">
          <button type="button" className="browser-toolbar-button" aria-label="Back" title="Back (Alt+Left)" disabled={!browser?.canGoBack} onClick={() => void sendDesktopTabsCommand({ type: "back" })}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H4m5-5-5 5 5 5" {...STROKE} /></svg>
          </button>
          <button type="button" className="browser-toolbar-button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!browser?.canGoForward} onClick={() => void sendDesktopTabsCommand({ type: "forward" })}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" {...STROKE} /></svg>
          </button>
          <button
            type="button"
            className="browser-toolbar-button"
            aria-label={pageTab?.loading ? "Stop loading" : "Reload"}
            title={pageTab?.loading ? "Stop loading" : "Reload (Ctrl+R)"}
            disabled={!browser}
            onClick={() => void sendDesktopTabsCommand(pageTab?.loading ? { type: "browser-stop" } : { type: "reload" })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {pageTab?.loading ? <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" /> : <path d="M15.2 7A6 6 0 1 0 16 11m-.8-4V3.8M15.2 7H12" {...STROKE} />}
            </svg>
          </button>
        </div>
        <form className="browser-address-form" onSubmit={navigateFromAddress}>
          <span className="browser-address-security" aria-hidden="true">
            {browser?.address ? (
              <BrowserSiteIcon
                src={privateBrowsing ? undefined : browser.favicon}
                pageUrl={privateBrowsing ? undefined : browser.address}
                fallback={<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" {...STROKE} /><path d="M2.5 8h11M8 2.5c-2 2-2 9 0 11M8 2.5c2 2 2 9 0 11" {...STROKE} /></svg>}
              />
            ) : <GoogleGlyph />}
          </span>
          <input
            ref={inputRef}
            className="browser-address-input"
            role="combobox"
            aria-label="Address and search"
            aria-autocomplete="list"
            aria-controls="browser-address-suggestions"
            aria-expanded={addressFocused && addressSuggestions.length > 0}
            aria-activedescendant={highlightedAddressSuggestion >= 0 ? `browser-address-suggestions-${highlightedAddressSuggestion}` : undefined}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search with Google or enter an address"
            value={addressDisplay}
            onFocus={(event) => {
              setDraftAddress(browser?.address ?? "");
              setHighlightedAddressSuggestion(-1);
              event.currentTarget.select();
            }}
            onPointerDown={() => setAddressFocused(true)}
            onBlur={() => window.setTimeout(() => {
              setAddressFocused(false);
              setDraftAddress(null);
              setHighlightedAddressSuggestion(-1);
              void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
            }, 120)}
            onKeyDown={handleAddressKeys}
            onChange={(event) => {
              setDraftAddress(event.target.value);
              setAddressFocused(true);
              setHighlightedAddressSuggestion(-1);
            }}
          />
          <div className="browser-address-actions">
            <BrowserTranslationControls browser={browser} />
            <button
              type="button"
              className="browser-bookmark-toggle"
              aria-label={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
              aria-pressed={currentBookmarked}
              title={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
              disabled={!browser?.address || !bookmarkStore.ready || bookmarkStore.saving}
              onClick={toggleCurrentBookmark}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.7 2.1 4.35 4.8.7-3.47 3.38.82 4.77L10 13.65 5.75 15.9l.82-4.77L3.1 7.75l4.8-.7L10 2.7Z" {...STROKE} /></svg>
            </button>
            <BrowserExtensionsButton open={browser?.extensionsOpen ?? false} count={tabs?.extensions.length ?? 0}
              onOpen={() => setAddressFocused(false)} />
          </div>
          {addressFocused && addressSuggestions.length ? (
            <BrowserSuggestionList
              id="browser-address-suggestions"
              dropdownRef={addressSuggestionsRef}
              address
              suggestions={addressSuggestions}
              highlighted={highlightedAddressSuggestion}
              onHighlight={setHighlightedAddressSuggestion}
              onChoose={chooseSuggestion}
              onRemoveHistory={(value) => {
                removeHistoryEntry(value);
                setHighlightedAddressSuggestion(-1);
              }}
            />
          ) : null}
        </form>
        {privateBrowsing && <span className={privateStyles.badge} title="Private browsing: history and searches are not saved. Site data is cleared when the last private tab closes.">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2.5 16 5v4.5c0 3.5-3 6.2-6 8-3-1.8-6-4.5-6-8V5Z" {...STROKE} /></svg>
          Private
        </span>}
        <BrowserDownloadsButton active={isActive} open={browser?.downloadsOpen ?? false} />
        <BrowserMenuControls profileLabel={restoreOwnerKey} onPanel={panel => {
          setActivePanel(panel);
          setBrowserPanelOpen(true);
        }} />
      </div>

      <nav className="browser-bookmarks-bar" aria-label="Bookmarks">
        {bookmarkStore.error && (
          <span role="alert" className="browser-bookmarks-empty">
            {bookmarkStore.error}{" "}
            {!bookmarkStore.ready && <button type="button" onClick={bookmarkStore.retry}>Retry</button>}
          </span>
        )}
        <span id="browser-bookmark-reorder-help" className="sr-only">Drag to reorder. You can also use Alt+Shift and the left or right arrow key.</span>
        <span className="sr-only" role="status">{bookmarkReorder.announcement}</span>
        <div
          className="browser-bookmarks-list"
          data-reordering={Boolean(bookmarkReorder.drag)}
          onDragOver={bookmarkReorder.over}
          onDrop={bookmarkReorder.drop}
        >
          {bookmarks.length ? bookmarks.map((bookmark) => (
            <span
              key={bookmark.url}
              className="browser-bookmark-item"
              data-bookmark-url={bookmark.url}
              data-current={bookmark.url === normalizedAddress}
              data-dragging={bookmarkReorder.drag?.url === bookmark.url}
              data-drop-before={bookmarkReorder.drag?.beforeUrl === bookmark.url && bookmarkReorder.drag.url !== bookmark.url}
              data-drop-after={bookmarkReorder.drag?.beforeUrl === null && bookmark === bookmarks.at(-1)}
              draggable={bookmarkStore.ready && !bookmarkStore.saving && bookmarks.length > 1}
              onDragStart={(event) => bookmarkReorder.start(event, bookmark.url)}
              onDragEnd={bookmarkReorder.end}
            >
              <button type="button" className="browser-bookmark-link" title={bookmark.title} aria-describedby="browser-bookmark-reorder-help" aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" onKeyDown={(event) => bookmarkReorder.keyDown(event, bookmark.url)} onClick={() => navigate(bookmark.url)}>
                <BrowserSiteIcon src={bookmark.iconUrl} pageUrl={bookmark.url} fallback={bookmark.title.slice(0, 1).toUpperCase()} />
                <span className="browser-bookmark-label">{bookmark.title}</span>
              </button>
              <button type="button" className="browser-bookmark-remove" aria-label={`Remove ${bookmark.title} bookmark`} title="Remove bookmark" disabled={!bookmarkStore.ready || bookmarkStore.saving} onClick={() => removeBookmark(bookmark.url)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg>
              </button>
            </span>
          )) : (
            !bookmarkStore.error && <span className="browser-bookmarks-empty">{bookmarkStore.ready ? "Pages you bookmark will appear here." : "Loading bookmarks…"}</span>
          )}
        </div>
      </nav>

      {!browser && browserRecoveryFailed ? (
        <div className="browser-recovery-error" role="alert">
          <span>Couldn’t open the browser.</span>
          <button type="button" onClick={retryBrowser}>Try again</button>
          <a href="/dashboard">Back to dashboard</a>
        </div>
      ) : null}

      <main
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
            {privateBrowsing ? <PrivateBrowserGreeting /> : <AnimatedBrowserGreeting greeting={chatGreeting.greeting} />}
            <form ref={searchFrameRef} className="browser-home-search" onSubmit={searchWeb}>
              <GoogleGlyph />
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
              <button type="submit" aria-label="Search the web"><SearchGlyph /></button>
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
            <BrowserQuickLinks navigate={navigate} ownerKey={restoreOwnerKey} />
          </div>
        ) : null}
        {!hasNativePage ? (
          <>
            <BrowserHomeAccessories ownerKey={restoreOwnerKey} />

          </>
        ) : null}
      </main>

      <nav className="browser-side-rail" aria-label="Browser tools" data-open={terminalOpen} data-panel={activePanel}>
        <div className="browser-rail-actions">
          <button
            type="button"
            className="browser-terminal-launcher"
            aria-label={terminalOpen && activePanel === "terminal" ? "Close Terminal" : "Open Terminal"}
            aria-pressed={terminalOpen && activePanel === "terminal"}
            title="Terminal"
            onClick={() => toggleToolPanel("terminal")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 4 4-4 4m7 0h7" {...STROKE} /></svg>
          </button>
          <button
            type="button"
            className="browser-terminal-launcher"
            aria-label={terminalOpen && activePanel === "history" ? "Close history" : "Open history"}
            aria-pressed={terminalOpen && activePanel === "history"}
            title="Browsing history"
            onClick={() => toggleToolPanel("history")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" {...STROKE} /><path d="M12 8v4.4l3 1.7M5.2 6.8 3.8 9.5" {...STROKE} /></svg>
          </button>
          <button
            type="button"
            className="browser-terminal-launcher"
            aria-label={terminalOpen && activePanel === "starred" ? "Close starred pages" : "Open starred pages"}
            aria-pressed={terminalOpen && activePanel === "starred"}
            title="Starred"
            onClick={() => toggleToolPanel("starred")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.5 5.05 5.57.81-4.03 3.93.95 5.55L12 16.32l-4.99 2.62.95-5.55L3.93 9.46l5.57-.81L12 3.6Z" {...STROKE} /></svg>
          </button>
          <button
            type="button"
            className="browser-terminal-launcher"
            aria-label={terminalOpen && activePanel === "downloads" ? "Close downloads" : "Open downloads"}
            aria-pressed={terminalOpen && activePanel === "downloads"}
            title="Downloads"
            onClick={() => toggleToolPanel("downloads")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" {...STROKE} /></svg>
          </button>
        </div>
        <svg className="browser-rail-sketch" viewBox="0 0 18 600" preserveAspectRatio="none" aria-hidden="true">
          <path pathLength={1} d="M9 4 C6 92 12 170 8 256 S12 418 8 596" />
          <path pathLength={1} d="M11 4 C8 104 13 188 9 274 S13 432 10 596" />
        </svg>
      </nav>

      <aside
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
          {terminalLoaded ? (
            <DashboardAgentTerminal
              scope="mine"
              restoreOwnerKey={restoreOwnerKey}
              presentation="drawer"
              drawerSidebarExpanded={terminalWidth >= TERMINAL_SIDEBAR_EXPAND_WIDTH}
              initialDraft={selectionDraft}
              viewingWebsite={hasNativePage && /^https?:\/\//iu.test(browser?.address ?? "")
                ? pageBookmarkTitle(pageTab?.title, browser?.address ?? "")
                : null}
            />
          ) : null}
        </div>
        <BrowserHistoryPanel active={activePanel === "history"} searches={recentSearchStore} navigate={navigate} closeButton={closePanelButton} />
        <section className="browser-tool-panel browser-library-panel" data-active={activePanel === "starred"} aria-hidden={activePanel !== "starred"} inert={activePanel !== "starred" ? true : undefined} aria-label="Starred pages">
          <header className="browser-library-panel-header">
            <span className="browser-library-panel-mark browser-library-panel-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3.6 2.5 5.05 5.57.81-4.03 3.93.95 5.55L12 16.32l-4.99 2.62.95-5.55L3.93 9.46l5.57-.81L12 3.6Z" {...STROKE} /></svg></span>
            <span><strong>Starred</strong><small>{bookmarks.length} saved {bookmarks.length === 1 ? "page" : "pages"}</small></span>
            <div className="browser-library-panel-actions">{closePanelButton}</div>
          </header>
          <div className="browser-library-list browser-starred-list">
            {bookmarks.length ? bookmarks.map((bookmark) => (
              <div key={bookmark.url} className="browser-library-row" data-current={bookmark.url === normalizedAddress}>
                <button type="button" className="browser-library-link" onClick={() => navigate(bookmark.url)} title={bookmark.title}>
                  <span className="browser-library-icon"><BrowserSiteIcon src={bookmark.iconUrl} pageUrl={bookmark.url} fallback={bookmark.title.slice(0, 1).toUpperCase()} /></span>
                  <span><strong>{bookmark.title}</strong><small>{new URL(bookmark.url).hostname.replace(/^www\./iu, "")}</small></span>
                </button>
                <button type="button" className="browser-library-remove" disabled={!bookmarkStore.ready || bookmarkStore.saving} onClick={() => removeBookmark(bookmark.url)} aria-label={`Remove ${bookmark.title} bookmark`} title="Remove bookmark"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg></button>
              </div>
            )) : <div className="browser-library-empty"><span aria-hidden="true">☆</span><strong>No starred pages yet</strong><small>Use the star in the address bar to save this page.</small></div>}
          </div>
        </section>
        <BrowserDownloadsPanel active={terminalOpen && activePanel === "downloads"} closeButton={closePanelButton} />
        <div
          className="browser-terminal-resizer"
          role="separator"
          aria-label="Resize browser panel"
          aria-orientation="vertical"
          aria-valuemin={TERMINAL_MIN_WIDTH}
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
      </aside>
    </>
  );
}
