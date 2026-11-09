"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { browserBookmarksControl, sendDesktopTabsCommand as sendTabsCommand, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { BrowserSiteIcon, GoogleGlyph } from "./browser-site-icon";
import { looksLikeBrowserAddress, searchSuggestions, type SearchSuggestion } from "./browser-recent-searches";
import { browserAddressDisplayValue } from "./browser-address-display";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { useBrowserRecentSearches } from "./use-browser-recent-searches";
import { useBrowserAddressSuggestions } from "./use-browser-address-suggestions";
import { BrowserSuggestionList } from "./browser-suggestion-list";
import BrowserDownloadsButton from "./browser-downloads-button";
import BrowserExtensionsButton from "./browser-extensions-button";
import BrowserMenuControls from "./browser-menu-controls";
import BrowserTranslationControls from "./browser-translation-controls";
import { BrowserBookmarksBar } from "./browser-bookmarks-bar";
import { MAX_BOOKMARKS, bookmarksKey, safeBookmarkIcon, bookmarkFromUnknown, normalizeBookmarks, type BrowserBookmark } from "./browser-bookmarks";
import { useBrowserContextBookmark } from "./use-browser-context-bookmark";
import privateStyles from "./browser-private.module.css";
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
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
      const desktop = (window as Window & { breadboardDesktop?: { getBrowserSuggestions?: (query: string) => Promise<{ suggestions?: unknown }> } }).breadboardDesktop;
      const request = desktop?.getBrowserSuggestions ? desktop.getBrowserSuggestions(value) :
        fetch(`/api/browser/suggestions?q=${encodeURIComponent(value)}`, { cache: "default", signal: controller.signal }).then(response => {
          if (!response.ok) throw new Error("Suggestions unavailable");
          return response.json() as Promise<{ suggestions?: unknown }>;
        });
      void request.then(payload => {
          return Array.isArray(payload.suggestions)
            ? payload.suggestions.filter((entry): entry is string => typeof entry === "string")
            : [];
        })
        .then((next) => {
          if (controller.signal.aborted) return;
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


/** Shared by web pages and the independent, locally bundled desktop shell. */
export default function BrowserNavigation({ showFlowers, restoreOwnerKey, onPanel }: {
  showFlowers: boolean; restoreOwnerKey: string;
  onPanel: (panel: "history" | "visited-pages" | "starred" | "downloads") => void;
}) {
  const tabs = useDesktopTabs();
  const pageTab = tabs?.tabs.find(tab => tab.id === (tabs.selfId === undefined ? tabs.activeId : tabs.selfId));
  const browser = pageTab?.browser;
  const privateBrowsing = browser?.private === true;
  const isActive = pageTab?.id === tabs?.activeId;
  function sendDesktopTabsCommand(command: DesktopTabsCommand) {
    return sendTabsCommand({ targetTabId: pageTab?.id, generation: pageTab?.generation, presentationRevision: tabs?.presentationRevision, ...command });
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const addressBlurTimer = useRef<number | null>(null);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [submittedAddress, setSubmittedAddress] = useState<string | null>(null);
  const [addressFocused, setAddressFocused] = useState(false);
  const [highlightedAddressSuggestion, setHighlightedAddressSuggestion] = useState(-1);
  const submissionRef = useRef({ sequence: 0, active: true });
  const recentSearchStore = useBrowserRecentSearches(restoreOwnerKey, browser?.address, privateBrowsing);
  const bookmarkStore = useBrowserSavedItems(restoreOwnerKey, bookmarksKey(restoreOwnerKey), browserBookmarksControl, normalizeBookmarks);
  const bookmarks = bookmarkStore.items;
  useBrowserContextBookmark(bookmarkStore, bookmarkFromUnknown, MAX_BOOKMARKS);
  const address = draftAddress ?? submittedAddress ?? browser?.address ?? "";
  const addressDisplay = draftAddress ?? submittedAddress ?? browserAddressDisplayValue(browser?.address ?? "");
  const query = addressFocused && address === browser?.address ? "" : address;
  const googleSuggestions = useGoogleSuggestions(!privateBrowsing && addressFocused ? query : "");
  const addressSuggestions = useMemo(() => searchSuggestions(query, recentSearchStore.items, googleSuggestions), [query, recentSearchStore.items, googleSuggestions]);
  const addressSuggestionsRef = useBrowserAddressSuggestions(Boolean(browser && addressFocused && addressSuggestions.length));
  useEffect(() => {
    const submissionState = submissionRef.current;
    submissionState.active = true;
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    window.addEventListener("breadboard:focus-browser-address", focus);
    return () => {
      window.removeEventListener("breadboard:focus-browser-address", focus);
      if (addressBlurTimer.current !== null) clearTimeout(addressBlurTimer.current);
      submissionState.active = false;
    };
  }, []);
  async function navigate(input: string) {
    const value = input.trim();
    if (!value) return;
    const submission = ++submissionRef.current.sequence;
    setSubmittedAddress(value); setDraftAddress(null); setAddressFocused(false); setHighlightedAddressSuggestion(-1);
    inputRef.current?.blur();
    try {
      // History is durable background work, never a prerequisite for loading a URL.
      void recentSearchStore.remember(value);
      if (submissionRef.current.active && submission === submissionRef.current.sequence) await sendDesktopTabsCommand({ type: "browser-navigate", input: value });
    } finally { if (submissionRef.current.active && submission === submissionRef.current.sequence) setSubmittedAddress(null); }
  }
  function navigateFromAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const suggestion = highlightedAddressSuggestion >= 0
      ? addressSuggestions[highlightedAddressSuggestion]
      : null;
    navigate(suggestion?.value ?? address);
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

  const normalizedAddress = browser?.address ?? "";
  const currentBookmarked = bookmarks.some(bookmark => bookmark.url === normalizedAddress);
  return <>
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
            disabled={!pageTab}
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
              // Native autocomplete can briefly blur and refocus the toolbar.
              // A pending blur must not erase or reselect the in-progress draft.
              const resumingDraft = addressBlurTimer.current !== null;
              if (addressBlurTimer.current !== null) window.clearTimeout(addressBlurTimer.current);
              addressBlurTimer.current = null;
              setAddressFocused(true);
              if (!resumingDraft) {
                setDraftAddress(browser?.address ?? "");
                event.currentTarget.select();
              }
              setHighlightedAddressSuggestion(-1);
            }}
            onPointerDown={() => setAddressFocused(true)}
            onBlur={() => {
              if (addressBlurTimer.current !== null) window.clearTimeout(addressBlurTimer.current);
              addressBlurTimer.current = window.setTimeout(() => {
                addressBlurTimer.current = null;
                setAddressFocused(false);
                setDraftAddress(null);
                setHighlightedAddressSuggestion(-1);
                void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
              }, 120);
            }}
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
        <BrowserMenuControls profileLabel={restoreOwnerKey} onPanel={onPanel} />
      </div>

      <BrowserBookmarksBar ownerKey={restoreOwnerKey} bookmarkStore={bookmarkStore} navigate={navigate} normalizedAddress={normalizedAddress} />

  </>;
}
