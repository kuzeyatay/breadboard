"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useChatGreeting } from "@/app/components/hermes/use-chat-greeting";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import {
  browserBookmarksControl,
  openBrowserInDesktop,
  refreshDesktopTabsState,
  sendDesktopTabsCommand,
} from "@/lib/desktop-browser-tabs";
import {
  AnimatedBrowserGreeting,
  BrowserDock,
  BrowserQuickLinks,
  BrowserSiteIcon,
  BrowserSketchOutline,
  GoogleGlyph,
  SearchGlyph,
  websiteIconUrl,
} from "./browser-home-widgets";
import {
  looksLikeBrowserAddress,
  normalizeRecentSearches,
  recentSearchFromInput,
} from "./browser-recent-searches";
import {
  BrowserDailyQuote,
  BrowserWallpaperPicker,
  useBrowserWallpaper,
} from "./browser-personalization";
import { browserAddressDisplayValue } from "./browser-address-display";
import { useBrowserSavedItems } from "./use-browser-saved-items";

const DashboardAgentTerminal = dynamic(
  () => import("@/app/components/hermes/dashboard-agent-terminal"),
  {
    ssr: false,
    loading: () => <div className="browser-tool-loading"><span className="bb-tab-spinner" aria-hidden="true" />Loading Terminal…</div>,
  },
);

const SettingsDialog = dynamic(() => import("@/app/components/settings-dialog"), {
  ssr: false,
});

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

interface SearchSuggestion {
  value: string;
  label: string;
  detail?: string;
  source: "google" | "history";
}

interface BrowserBookmark {
  url: string;
  title: string;
  iconUrl: string;
}

type BrowserToolPanel = "terminal" | "history" | "starred";

const TERMINAL_DEFAULT_WIDTH = 640;
const TERMINAL_MIN_WIDTH = 420;
const TERMINAL_MAX_VIEWPORT_SHARE = 0.5;
const TERMINAL_SIDEBAR_EXPAND_WIDTH = 660;
const BROWSER_MIN_CONTENT_WIDTH = 320;
const MAX_BOOKMARKS = 40;
const MAX_RECENT_SEARCHES = 80;

function searchesKey(ownerKey: string): string {
  return `breadboard:browser-searches:${ownerKey}`;
}

function legacyHistoryKey(ownerKey: string): string {
  return `breadboard:browser-history:${ownerKey}`;
}

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

function searchSuggestions(
  query: string,
  recentSearches: readonly string[],
  google: readonly string[],
): SearchSuggestion[] {
  const value = query.trim();
  if (!value) {
    return recentSearches.slice(0, 8).map((entry) => ({
      value: entry,
      label: entry,
      source: "history",
    }));
  }
  const normalized = value.toLocaleLowerCase();
  const predictions: SearchSuggestion[] = (looksLikeAddress(value) ? [] : google).map((entry) => ({
    value: entry,
    label: entry,
    source: "google" as const,
  }));
  if (!predictions.some((entry) => entry.value.toLocaleLowerCase() === normalized) && !looksLikeAddress(value)) {
    predictions.unshift({ value, label: value, detail: "Search with Google", source: "google" });
  }
  const remembered: SearchSuggestion[] = recentSearches
    .filter((entry) => entry.toLocaleLowerCase().includes(normalized))
    .map((entry) => ({ value: entry, label: entry, source: "history" as const }));
  const seen = new Set<string>();
  return [...predictions, ...remembered]
    .filter((entry) => !seen.has(entry.value) && seen.add(entry.value))
    .slice(0, 8);
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
}: {
  id: string;
  suggestions: readonly SearchSuggestion[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (suggestion: SearchSuggestion) => void;
  onRemoveHistory: (value: string) => void;
  address?: boolean;
}) {
  return (
    <div id={id} className={`browser-search-suggestions ${address ? "browser-address-suggestions" : ""}`} role="listbox" aria-label={address ? "Address suggestions and recent searches" : "Search suggestions and recent searches"}>
      {suggestions.map((suggestion, index) => (
        <div
          key={`${suggestion.source}-${suggestion.value}`}
          id={`${id}-${index}`}
          className="browser-suggestion-row"
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
}: {
  showFlowers: boolean;
  restoreOwnerKey: string;
}) {
  const tabs = useDesktopTabs();
  const active = tabs?.tabs.find((tab) => tab.id === tabs.activeId);
  const browser = active?.browser;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchFrameRef = useRef<HTMLFormElement | null>(null);
  const extensionsControlRef = useRef<HTMLDivElement | null>(null);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const bookmarkStore = useBrowserSavedItems(
    restoreOwnerKey,
    bookmarksKey(restoreOwnerKey),
    browserBookmarksControl,
    normalizeBookmarks,
  );
  const bookmarks = bookmarkStore.items;
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
  const [historyFilter, setHistoryFilter] = useState("");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [browserRecoverySlow, setBrowserRecoverySlow] = useState(false);
  const [browserRecoveryFailed, setBrowserRecoveryFailed] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extensionAction, setExtensionAction] = useState<string | null>(null);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const address = draftAddress ?? browser?.address ?? "";
  const addressDisplay = draftAddress ?? browserAddressDisplayValue(browser?.address ?? "");
  const extensions = tabs?.extensions ?? [];
  const addressLookupQuery = addressFocused && address === browser?.address ? "" : address;
  const chatGreeting = useChatGreeting({ scope: "mine", temporary: false });
  const personalization = useBrowserWallpaper(restoreOwnerKey);
  const terminalOpen = browser?.terminalOpen ?? false;
  const selectionKey = browser?.selection
    ? `${browser.selection.url}\n${browser.selection.text}`
    : "";
  const googleSearchSuggestions = useGoogleSuggestions(searchFocused ? searchQuery : "");
  const googleAddressSuggestions = useGoogleSuggestions(addressFocused ? addressLookupQuery : "");
  const suggestions = useMemo(
    () => searchSuggestions(searchQuery, recentSearches, googleSearchSuggestions),
    [googleSearchSuggestions, recentSearches, searchQuery],
  );
  const addressSuggestions = useMemo(
    () => searchSuggestions(addressLookupQuery, recentSearches, googleAddressSuggestions),
    [addressLookupQuery, googleAddressSuggestions, recentSearches],
  );
  const visibleHistory = useMemo(() => {
    const filter = historyFilter.trim().toLocaleLowerCase();
    return filter
      ? recentSearches.filter((entry) => entry.toLocaleLowerCase().includes(filter))
      : recentSearches;
  }, [historyFilter, recentSearches]);
  const rememberSearch = useCallback((value: string) => {
    const search = recentSearchFromInput(value);
    if (!search) return;
    setRecentSearches((current) => {
      const next = [search, ...current.filter((entry) => entry !== search)].slice(0, MAX_RECENT_SEARCHES);
      window.localStorage.setItem(
        searchesKey(restoreOwnerKey),
        JSON.stringify(next),
      );
      return next;
    });
  }, [restoreOwnerKey]);

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
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(searchesKey(restoreOwnerKey)) ??
            window.localStorage.getItem(legacyHistoryKey(restoreOwnerKey)) ?? "[]",
        );
        const searches = normalizeRecentSearches(stored, MAX_RECENT_SEARCHES);
        setRecentSearches(searches);
        window.localStorage.setItem(searchesKey(restoreOwnerKey), JSON.stringify(searches));
        window.localStorage.removeItem(legacyHistoryKey(restoreOwnerKey));
      } catch {
        setRecentSearches([]);
      }
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
    const storedSearchesKey = searchesKey(restoreOwnerKey);
    const syncBrowserLibrary = (event: StorageEvent) => {
      if (event.key === storedSearchesKey) {
        try {
          const stored = JSON.parse(event.newValue ?? "[]");
          setRecentSearches(normalizeRecentSearches(stored, MAX_RECENT_SEARCHES));
        } catch {
          setRecentSearches([]);
        }
      }
    };
    window.addEventListener("storage", syncBrowserLibrary);
    return () => window.removeEventListener("storage", syncBrowserLibrary);
  }, [restoreOwnerKey]);

  useEffect(() => {
    if (!terminalPreferenceLoadedRef.current || terminalResizeRef.current || !browser?.terminalWidth) return;
    const frame = window.requestAnimationFrame(() => setTerminalWidth(browser.terminalWidth));
    return () => window.cancelAnimationFrame(frame);
  }, [browser?.terminalWidth]);

  useEffect(() => {
    void sendDesktopTabsCommand({
      type: "browser-address-suggestions",
      open: Boolean(browser?.address && addressFocused && addressSuggestions.length),
    });
  }, [addressFocused, addressSuggestions.length, browser?.address]);

  useEffect(() => {
    if (!extensionsOpen) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!extensionsControlRef.current?.contains(event.target as Node)) {
        setExtensionsOpen(false);
      }
    };
    const closeWithEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setExtensionsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [extensionsOpen]);

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
    if (browser && !browser.address) requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("breadboard:focus-browser-address", focusAddress);
  }, [browser, browser?.address]);

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
    if (browser) return;
    const timer = window.setTimeout(() => setBrowserRecoverySlow(true), 1_200);
    return () => window.clearTimeout(timer);
  }, [browser]);

  useEffect(() => {
    if (browser || !tabs?.enabled || !active || browserRepairAttemptedRef.current) return;
    let isPlainBrowserRoute = false;
    try {
      isPlainBrowserRoute = new URL(active.url, window.location.href).pathname === "/browser";
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
  }, [active, browser, tabs?.enabled]);

  function navigate(input: string) {
    const value = input.trim();
    if (!value) return;
    rememberSearch(value);
    setDraftAddress(null);
    setSearchQuery("");
    setSearchFocused(false);
    setHighlightedSuggestion(-1);
    setAddressFocused(false);
    setExtensionsOpen(false);
    setHighlightedAddressSuggestion(-1);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void sendDesktopTabsCommand({ type: "browser-navigate", input: value });
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
        title: pageBookmarkTitle(active?.title, normalizedUrl),
        iconUrl: safeBookmarkIcon(browser?.favicon, normalizedUrl),
      },
    ]);
  }

  async function loadBrowserExtension() {
    setExtensionAction("load");
    setExtensionError(null);
    const loaded = await sendDesktopTabsCommand({ type: "browser-extension-load" });
    if (!loaded) {
      setExtensionError("That folder could not be loaded. Check that it contains a valid manifest.json file.");
    }
    setExtensionAction(null);
  }

  async function reloadBrowserExtension(id: string) {
    setExtensionAction(`reload:${id}`);
    setExtensionError(null);
    const reloaded = await sendDesktopTabsCommand({ type: "browser-extension-reload", id });
    if (!reloaded) setExtensionError("The extension could not be reloaded.");
    setExtensionAction(null);
  }

  async function removeBrowserExtension(id: string) {
    setExtensionAction(`remove:${id}`);
    setExtensionError(null);
    const removed = await sendDesktopTabsCommand({ type: "browser-extension-remove", id });
    if (!removed) setExtensionError("The extension could not be removed.");
    setExtensionAction(null);
  }

  function saveRecentSearches(next: string[]) {
    const bounded = normalizeRecentSearches(next, MAX_RECENT_SEARCHES);
    setRecentSearches(bounded);
    window.localStorage.setItem(searchesKey(restoreOwnerKey), JSON.stringify(bounded));
  }

  function removeHistoryEntry(value: string) {
    saveRecentSearches(recentSearches.filter((entry) => entry !== value));
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

  if (!browser) {
    const retryBrowser = () => {
      setBrowserRecoveryFailed(false);
      browserRepairAttemptedRef.current = false;
      void refreshDesktopTabsState().then(() =>
        openBrowserInDesktop({ replaceCurrent: true }),
      ).then((opened) => {
        if (!opened) setBrowserRecoveryFailed(true);
      });
    };
    return (
      <main className="browser-unavailable" aria-live="polite" data-recovering={!browserRecoveryFailed}>
        <div className="browser-recovery-card">
          <span className="bb-tab-spinner" aria-hidden="true" />
          <strong>{browserRecoveryFailed ? "Browser did not attach" : "Starting Browser…"}</strong>
          <p>
            {browserRecoveryFailed
              ? "Breadboard could not connect this page to its secure browser view."
              : "Connecting the address bar and secure page view."}
          </p>
          {browserRecoverySlow || browserRecoveryFailed ? (
            <div className="browser-recovery-actions">
              <button type="button" onClick={retryBrowser}>Try again</button>
              <a href="/dashboard">Back to dashboard</a>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  const selectionDraft = browser.selection
    ? `Ask about this selection from ${browser.selection.title}:\n\n“${browser.selection.text}”\n\n`
    : null;
  const normalizedAddress = (() => {
    try {
      return browser.address ? new URL(browser.address).toString() : "";
    } catch {
      return "";
    }
  })();
  const currentBookmarked = Boolean(
    normalizedAddress && bookmarks.some((bookmark) => bookmark.url === normalizedAddress),
  );

  return (
    <>
      <div className="browser-toolbar" role="toolbar" aria-label="Browser navigation">
        <NavbarFlowerWind showFlowers={showFlowers} />
        <div className="browser-navigation-controls">
          <button type="button" className="browser-toolbar-button" aria-label="Back" title="Back (Alt+Left)" disabled={!browser.canGoBack} onClick={() => void sendDesktopTabsCommand({ type: "back" })}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H4m5-5-5 5 5 5" {...STROKE} /></svg>
          </button>
          <button type="button" className="browser-toolbar-button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!browser.canGoForward} onClick={() => void sendDesktopTabsCommand({ type: "forward" })}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" {...STROKE} /></svg>
          </button>
          <button
            type="button"
            className="browser-toolbar-button"
            aria-label={active?.loading ? "Stop loading" : "Reload"}
            title={active?.loading ? "Stop loading" : "Reload (Ctrl+R)"}
            onClick={() => void sendDesktopTabsCommand(active?.loading ? { type: "browser-stop" } : { type: "reload" })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {active?.loading ? <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" /> : <path d="M15.2 7A6 6 0 1 0 16 11m-.8-4V3.8M15.2 7H12" {...STROKE} />}
            </svg>
          </button>
        </div>
        <form className="browser-address-form" onSubmit={navigateFromAddress}>
          <span className="browser-address-security" aria-hidden="true">
            {browser.address ? (
              <BrowserSiteIcon
                src={browser.favicon}
                pageUrl={browser.address}
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
              setDraftAddress(browser.address);
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
            <button
              type="button"
              className="browser-bookmark-toggle"
              aria-label={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
              aria-pressed={currentBookmarked}
              title={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
              disabled={!browser.address || !bookmarkStore.ready || bookmarkStore.saving}
              onClick={toggleCurrentBookmark}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.7 2.1 4.35 4.8.7-3.47 3.38.82 4.77L10 13.65 5.75 15.9l.82-4.77L3.1 7.75l4.8-.7L10 2.7Z" {...STROKE} /></svg>
            </button>
            <div ref={extensionsControlRef} className="browser-extensions-control">
              <button
                type="button"
                className="browser-extensions-toggle"
                aria-label="Extensions"
                aria-expanded={extensionsOpen}
                aria-haspopup="dialog"
                title="Extensions"
                onClick={() => {
                  setExtensionsOpen((open) => !open);
                  setAddressFocused(false);
                  setExtensionError(null);
                  void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M8 3H4a1 1 0 0 0-1 1v4h1.1a2 2 0 1 1 0 4H3v4a1 1 0 0 0 1 1h4v-1.1a2 2 0 1 1 4 0V17h4a1 1 0 0 0 1-1v-4h-1.1a2 2 0 1 1 0-4H17V4a1 1 0 0 0-1-1h-4v1.1a2 2 0 1 1-4 0V3Z" {...STROKE} />
                </svg>
                {extensions.length ? <span className="browser-extensions-count">{extensions.length}</span> : null}
              </button>
              {extensionsOpen ? (
                <section className="browser-extensions-menu" role="dialog" aria-label="Browser extensions">
                  <header>
                    <strong>Extensions</strong>
                    <span>{extensions.length} active</span>
                  </header>
                  <div className="browser-extensions-list">
                    {extensions.length ? extensions.map((extension) => (
                      <div key={extension.id} className="browser-extension-row">
                        <span className="browser-extension-mark" aria-hidden="true">
                          {extension.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="browser-extension-copy">
                          <strong>{extension.name}</strong>
                          <small>Version {extension.version}</small>
                        </span>
                        <span className="browser-extension-actions">
                          <button
                            type="button"
                            aria-label={`Reload ${extension.name}`}
                            title="Reload extension"
                            disabled={extensionAction !== null}
                            onClick={() => void reloadBrowserExtension(extension.id)}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 6A5 5 0 1 0 13 9m-.2-3V3.4M12.8 6h-2.6" {...STROKE} /></svg>
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${extension.name}`}
                            title="Remove extension"
                            disabled={extensionAction !== null}
                            onClick={() => void removeBrowserExtension(extension.id)}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg>
                          </button>
                        </span>
                      </div>
                    )) : (
                      <p className="browser-extensions-empty">No extensions loaded yet.</p>
                    )}
                  </div>
                  {extensionError ? <p className="browser-extensions-error" role="alert">{extensionError}</p> : null}
                  <button
                    type="button"
                    className="browser-extension-load"
                    disabled={extensionAction !== null}
                    onClick={() => void loadBrowserExtension()}
                  >
                    {extensionAction === "load" ? <span className="bb-tab-spinner" aria-hidden="true" /> : (
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" {...STROKE} /></svg>
                    )}
                    Load unpacked
                  </button>
                  <p className="browser-extensions-note">Choose an unpacked Chromium extension folder containing manifest.json.</p>
                </section>
              ) : null}
            </div>
          </div>
          {addressFocused && addressSuggestions.length ? (
            <BrowserSuggestionList
              id="browser-address-suggestions"
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
      </div>

      <nav className="browser-bookmarks-bar" aria-label="Bookmarks" data-loading={active?.loading === true}>
        {bookmarkStore.error && (
          <span role="alert" className="browser-bookmarks-empty">
            {bookmarkStore.error}{" "}
            {!bookmarkStore.ready && <button type="button" onClick={bookmarkStore.retry}>Retry</button>}
          </span>
        )}
        <div className="browser-bookmarks-list">
          {bookmarks.length ? bookmarks.map((bookmark) => (
            <span key={bookmark.url} className="browser-bookmark-item" data-current={bookmark.url === normalizedAddress}>
              <button type="button" className="browser-bookmark-link" title={bookmark.title} onClick={() => navigate(bookmark.url)}>
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

      <main
        className="browser-start-page"
        aria-live="polite"
        data-wallpaper-ready={personalization.ready}
        data-has-wallpaper={personalization.hasWallpaper}
        data-wallpaper-tone={personalization.wallpaper?.tone ?? personalization.theme}
        style={personalization.ready && personalization.wallpaper ? {
          "--browser-wallpaper-image": `url("${personalization.wallpaper.src}")`,
        } as CSSProperties : undefined}
      >
        {!browser.address ? (
          <div className="browser-start-copy">
            <AnimatedBrowserGreeting greeting={chatGreeting.greeting} />
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
        ) : active?.loading ? (
          <div className="browser-start-status"><span className="bb-tab-spinner" aria-hidden="true" />Opening {address || browser.address}…</div>
        ) : null}
        {!browser.address ? (
          <>
            <BrowserDailyQuote ownerKey={restoreOwnerKey} />
            <BrowserDock openConnections={() => setConnectionsOpen(true)} />
            <BrowserWallpaperPicker
              currentTheme={personalization.theme}
              selections={personalization.selections}
              onSelect={personalization.select}
            />
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
            aria-label={terminalOpen && activePanel === "history" ? "Close recent searches" : "Open recent searches"}
            aria-pressed={terminalOpen && activePanel === "history"}
            title="Recent searches"
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
        <button type="button" className="browser-terminal-close" onClick={() => setBrowserPanelOpen(false)} aria-label={`Close ${activePanel === "terminal" ? "Terminal" : activePanel === "history" ? "history" : "starred pages"}`} title="Close panel">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" {...STROKE} /></svg>
        </button>
        <div className="browser-tool-panel browser-tool-panel-terminal" data-active={activePanel === "terminal"} aria-hidden={activePanel !== "terminal"} inert={activePanel !== "terminal" ? true : undefined}>
          {terminalLoaded ? (
            <DashboardAgentTerminal
              scope="mine"
              restoreOwnerKey={restoreOwnerKey}
              presentation="drawer"
              drawerSidebarExpanded={terminalWidth >= TERMINAL_SIDEBAR_EXPAND_WIDTH}
              initialDraft={selectionDraft}
            />
          ) : null}
        </div>
        <section className="browser-tool-panel browser-library-panel" data-active={activePanel === "history"} aria-hidden={activePanel !== "history"} inert={activePanel !== "history" ? true : undefined} aria-label="Recent searches">
          <header className="browser-library-panel-header">
            <span className="browser-library-panel-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.2" {...STROKE} /><path d="M12 8v4.4l3 1.7M5.2 6.8 3.8 9.5" {...STROKE} /></svg></span>
            <span><strong>Recent searches</strong><small>{recentSearches.length} recent {recentSearches.length === 1 ? "search" : "searches"}</small></span>
            {recentSearches.length ? <button type="button" className="browser-library-clear" onClick={() => saveRecentSearches([])}>Clear</button> : null}
          </header>
          <label className="browser-library-filter">
            <SearchGlyph />
            <span className="sr-only">Filter recent searches</span>
            <input type="search" value={historyFilter} onChange={(event) => setHistoryFilter(event.currentTarget.value)} placeholder="Filter recent searches" />
            {historyFilter ? <button type="button" aria-label="Clear recent search filter" onClick={() => setHistoryFilter("")}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg></button> : null}
          </label>
          <div className="browser-library-list">
            {visibleHistory.length ? visibleHistory.map((entry) => {
              return (
                <div key={entry} className="browser-library-row">
                  <button type="button" className="browser-library-link" onClick={() => navigate(entry)} title={entry}>
                    <span className="browser-library-icon"><SearchGlyph /></span>
                    <span><strong>{entry}</strong><small>Search with Google</small></span>
                  </button>
                  <button type="button" className="browser-library-remove" onClick={() => removeHistoryEntry(entry)} aria-label={`Remove ${entry} from recent searches`} title="Remove from recent searches"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg></button>
                </div>
              );
            }) : <div className="browser-library-empty"><span aria-hidden="true">↺</span><strong>{historyFilter ? "No matching searches" : "No recent searches"}</strong><small>{historyFilter ? "Try another term." : "Things you search for will appear here."}</small></div>}
          </div>
        </section>
        <section className="browser-tool-panel browser-library-panel" data-active={activePanel === "starred"} aria-hidden={activePanel !== "starred"} inert={activePanel !== "starred" ? true : undefined} aria-label="Starred pages">
          <header className="browser-library-panel-header">
            <span className="browser-library-panel-mark browser-library-panel-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3.6 2.5 5.05 5.57.81-4.03 3.93.95 5.55L12 16.32l-4.99 2.62.95-5.55L3.93 9.46l5.57-.81L12 3.6Z" {...STROKE} /></svg></span>
            <span><strong>Starred</strong><small>{bookmarks.length} saved {bookmarks.length === 1 ? "page" : "pages"}</small></span>
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
      {connectionsOpen ? (
        <SettingsDialog initialTab="connections" onClose={() => setConnectionsOpen(false)} />
      ) : null}
    </>
  );
}
