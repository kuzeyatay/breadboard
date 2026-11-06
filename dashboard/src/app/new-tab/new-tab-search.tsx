"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarDays, File, FileText, Hash, LayoutGrid, ListTodo, MessageSquareText, Search, Sprout, X, type LucideIcon } from "lucide-react";
import NavigationLink from "@/app/components/navigation-link";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import { desktopTabsBridge, navigateBrowserFromHome } from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { useBrowserRecentSearches } from "@/app/browser/use-browser-recent-searches";
import { BrowserSketchOutline } from "@/app/browser/browser-home-widgets";
import { BrowserSuggestionList } from "@/app/browser/browser-suggestion-list";
import { SEARCH_LABELS, SEARCH_TYPES, searchPlaces, searchScore, searchTerms, sortSearchResults,
  type BreadboardSearchResponse, type BreadboardSearchResult, type SearchFilter, type SearchType } from "@/lib/breadboard-search";
import type { NewTabGarden } from "@/lib/new-tab-gardens";
import { newTabSearchSuggestions, webDestinationUrl, type NewTabSuggestion, type SearchHistoryEntry } from "@/lib/new-tab-search-suggestions";
import { useNewTabSearchHistory } from "./use-new-tab-search-history";
import controls from "./new-tab-controls.module.css";
import styles from "./new-tab-search.module.css";

const ICONS: Record<SearchType, LucideIcon> = { garden: Sprout, note: FileText, file: File,
  chat: MessageSquareText, task: ListTodo, event: CalendarDays, room: Hash, place: LayoutGrid };

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const expression = new RegExp(`(${terms.join("|")})`, "giu");
  return text.split(expression).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

export default function NewTabSearch({ gardens, initialHistory, ownerKey, browserOwnerKey = ownerKey, active = true, children, onSearchingChange }: {
  gardens: NewTabGarden[]; initialHistory: SearchHistoryEntry[]; ownerKey: string; browserOwnerKey?: string; active?: boolean; children: ReactNode; onSearchingChange?: (searching: boolean) => void;
}) {
  const router = useRouter();
  const history = useNewTabSearchHistory(ownerKey, initialHistory, active);
  const tabs = useDesktopTabs();
  const browserSearches = useBrowserRecentSearches(browserOwnerKey);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [visible, setVisible] = useState(12);
  const [retry, setRetry] = useState(0);
  const [browserError, setBrowserError] = useState(false);
  const browserTarget = useRef<string | undefined>(undefined);
  const openingBrowser = useRef(false);
  const [state, setState] = useState<{ query: string; data?: BreadboardSearchResponse; error?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const resultList = useRef<HTMLUListElement>(null);
  const needle = query.trim();
  const current = state?.query === needle ? state : null;
  const pending = Boolean(needle && !current && active);

  useEffect(() => {
    if (!active || !needle) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/new-tab/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to search your Breadboard." : "Search couldn’t finish. Try again.");
        const data = await response.json() as BreadboardSearchResponse;
        if (!controller.signal.aborted) setState({ query: needle, data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ query: needle, error: error instanceof Error ? error.message : "Search couldn’t finish. Try again." });
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [needle, retry, active]);

  useEffect(() => {
    if (!active) return;
    const focus = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
        target.closest("input, textarea, select, [contenteditable=true], [role=textbox], [role=dialog]")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [active]);

  const local: BreadboardSearchResult[] = needle ? [
    ...searchPlaces(needle),
    ...gardens.map(garden => ({ id: `garden:${garden.slug}`, type: "garden" as const,
      title: garden.name, href: `/gardens/${encodeURIComponent(garden.slug)}`, context: "Your gardens",
      snippet: garden.noteCount === null ? "" : `${garden.noteCount.toLocaleString()} notes`,
      score: searchScore(garden.name, "", needle),
    })).filter(result => result.score > 0),
  ] : [];
  const results = current?.data?.results ?? sortSearchResults(local);
  const filtered = filter === "all" ? results : results.filter(result => result.type === filter);
  const shown = filtered.slice(0, visible);
  const limited = current?.data?.limited.some(type => filter === "all" || type === filter);
  const unavailable = current?.data?.unavailable ?? [];
  const suggestions = newTabSearchSuggestions(query, history.items, results, browserSearches.items);
  const suggestionsOpen = active && focused && suggestions.length > 0;

  useEffect(() => {
    if (suggestionsOpen && highlighted >= 0) {
      dropdown.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted, suggestionsOpen]);

  function clear() {
    setQuery(""); setState(null); setSubmitted(false); setHighlighted(-1); setFocused(true);
    setBrowserError(false); setFilter("all"); setVisible(12); input.current?.focus();
    onSearchingChange?.(false);
  }

  function submit(value = query) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuery(trimmed); setSubmitted(true); setFocused(false); setHighlighted(-1);
    setFilter("all"); setVisible(12); setBrowserError(false);
    onSearchingChange?.(true);
    void history.remember(trimmed, "breadboard");
  }

  async function openBrowser(url?: string) {
    if (!url) return;
    if (openingBrowser.current) return;
    openingBrowser.current = true;
    browserTarget.current = url;
    setBrowserError(false);
    startNavigationProgress();
    let opened = false;
    try {
      if (url && !desktopTabsBridge()) {
        window.location.assign(url);
        opened = true;
      } else opened = await navigateBrowserFromHome(url, tabs);
    }
    catch { /* Keep search usable when the desktop handoff fails. */ }
    finally {
      // The native browser owns loading after acknowledgement. Leaving the
      // app-page loading signal set can prevent its replacement from appearing.
      if (desktopTabsBridge() || !opened) cancelNavigationProgress();
      if (!opened) setBrowserError(true);
      openingBrowser.current = false;
    }
  }

  async function choose(suggestion: NewTabSuggestion) {
    setFocused(false); setHighlighted(-1);
    if (suggestion.scope === "web") {
      setQuery(suggestion.value);
      void browserSearches.remember(suggestion.value);
      await openBrowser(suggestion.href ?? webDestinationUrl(suggestion.value));
    } else if (suggestion.result) {
      void history.remember(needle, "breadboard");
      startNavigationProgress(); router.push(suggestion.result.href);
    } else submit(suggestion.value);
  }

  function searchWeb() {
    if (!needle) return;
    void choose({ value: needle, label: needle, source: "web", scope: "web" });
  }

  function handleSearchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault(); setFocused(false); setHighlighted(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault(); setFocused(true);
      setHighlighted(index => event.key === "ArrowDown"
        ? (index + 1) % suggestions.length
        : (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (suggestionsOpen && suggestions[highlighted]) void choose(suggestions[highlighted]);
      else searchWeb();
    }
  }

  function navigateResults(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); clear(); return; }
    const links = Array.from(resultList.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []);
    if (!links.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (event.key === "ArrowUp" && index <= 0) input.current?.focus();
      else links[Math.min(links.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))]?.focus();
    }
  }

  return (
    <>
      <div ref={frame} className={controls.search} role="search"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocused(false); setHighlighted(-1); } }}>
        <Search size={19} aria-hidden="true" />
        <input ref={input} type="search" value={query} maxLength={200}
          onFocus={() => setFocused(true)} onPointerDown={() => setFocused(true)}
          onChange={event => {
            setQuery(event.target.value); setState(null); setSubmitted(false); setFocused(true);
            setHighlighted(-1); setVisible(12); setBrowserError(false);
            if (!event.target.value.trim()) onSearchingChange?.(false);
          }}
          onKeyDown={handleSearchKeys} placeholder="Search all of Breadboard…" aria-label="Search all of Breadboard"
          role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen}
          aria-controls="new-tab-search-suggestions" aria-describedby={needle ? "breadboard-search-hint" : undefined}
          aria-activedescendant={suggestionsOpen && suggestions[highlighted] ? `new-tab-search-suggestions-${highlighted}` : undefined}
          autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} />
        {query && <button type="button" onClick={clear} aria-label="Clear search" className={controls.clearSearch}>
          <X size={16} aria-hidden="true" />
        </button>}
        {query && <button type="button" onClick={searchWeb} aria-label="Search the web" className={controls.clearSearch}>
          <ArrowUpRight size={18} aria-hidden="true" />
        </button>}
        <BrowserSketchOutline targetRef={frame} index={0} />
        {suggestionsOpen && <BrowserSuggestionList id="new-tab-search-suggestions" dropdownRef={dropdown}
          suggestions={suggestions} highlighted={highlighted} onHighlight={setHighlighted}
          onChoose={suggestion => void choose(suggestion)}
          onRemoveHistory={(_value, suggestion) => {
            setHighlighted(-1);
            if (suggestion.scope === "web") void browserSearches.remove(suggestion.value);
            void history.remove(suggestion.value, suggestion.scope);
          }} />}
      </div>
      {needle && <p id="breadboard-search-hint" className="sr-only">
        ↑↓ to choose <span>·</span> Enter to search the web <span>·</span> Esc to close
      </p>}
      {browserError && <div role="alert" className={styles.error}>Couldn’t open Browser.
        <button type="button" onClick={() => void openBrowser(browserTarget.current)}>Retry</button>
      </div>}
      {submitted && needle ? <section className={styles.results} aria-label="Breadboard search results">
        <div className={styles.filters} role="group" aria-label="Filter search results">
          {(["all", ...SEARCH_TYPES] as const).map(type => {
            const count = type === "all" ? results.length : results.filter(result => result.type === type).length;
            return <button key={type} type="button" aria-pressed={filter === type}
              onClick={() => { setFilter(type); setVisible(12); }} className={styles.filter}>
              {SEARCH_LABELS[type]}{count > 0 && <span>{count}{current?.data?.limited.includes(type as SearchType) ? "+" : ""}</span>}
            </button>;
          })}
        </div>
        <div className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
          <span>{pending ? "Searching Breadboard…" : `${filtered.length}${limited ? "+" : ""} ${filtered.length === 1 ? "result" : "results"}`}</span>
          <span>Best matches first</span>
        </div>
        {(current?.error || unavailable.length > 0) && <div role="alert" className={styles.error}>
          <span>{current?.error ?? `${unavailable.map(type => SEARCH_LABELS[type]).join(" and ")} couldn’t be fully searched.`}</span>
          <button type="button" onClick={() => { setState(null); setRetry(value => value + 1); }}>Retry</button>
        </div>}
        <ul ref={resultList} id="breadboard-search-results" className={styles.list} onKeyDown={navigateResults}>
          {shown.map(result => {
            const Icon = ICONS[result.type];
            return <li key={result.id}>
              <NavigationLink href={result.href} label={result.title} prefetch={false} data-search-result className={styles.result}
                onClick={event => {
                  if (result.href !== "/browser" || !desktopTabsBridge() || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault(); void openBrowser();
                }}>
                <span className={styles.icon}><Icon size={18} strokeWidth={1.6} aria-hidden="true" /></span>
                <span className={styles.resultContent}>
                  <span className={styles.context}>{SEARCH_LABELS[result.type]} <span aria-hidden="true">/</span> {result.context}</span>
                  <span className={styles.title}><Highlight text={result.title} query={needle} /></span>
                  {result.snippet && <span className={styles.snippet}><Highlight text={result.snippet} query={needle} /></span>}
                </span>
                <ArrowUpRight size={16} className={styles.open} aria-hidden="true" />
              </NavigationLink>
            </li>;
          })}
        </ul>
        {!pending && !current?.error && filtered.length === 0 && <div className={styles.empty}>
          <Search size={24} strokeWidth={1.4} aria-hidden="true" />
          <h2>No {filter === "all" ? "results" : SEARCH_LABELS[filter].toLowerCase()} for “{needle}”</h2>
          <p>Try a different word, a shorter phrase, or another name.</p>
          {filter !== "all" && <button type="button" onClick={() => setFilter("all")}>Search all of Breadboard</button>}
        </div>}
        {filtered.length > visible && <button className={styles.more} type="button" onClick={() => setVisible(value => value + 12)}>
          Show more results <span>{filtered.length - visible} more</span>
        </button>}
        {limited && <p className={styles.limit}>Showing the best matches. Add another word to narrow your search.</p>}
      </section> : children}
    </>
  );
}
