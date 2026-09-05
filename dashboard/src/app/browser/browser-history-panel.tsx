"use client";

import { useMemo, useState, type ReactNode } from "react";
import { browserHistoryRows, filterBrowserHistory, type BrowserHistoryRow } from "./browser-history";
import { recentSearchFromInput } from "./browser-recent-searches";
import { useBrowserHistory } from "./use-browser-history";
import styles from "./browser-history-panel.module.css";

interface Searches {
  items: string[];
  ready: boolean;
  error: string | null;
  remove(search: string): Promise<boolean>;
  clear(): Promise<boolean>;
  retry(): Promise<boolean>;
}

export function BrowserHistoryPanel({ active, searches, navigate, closeButton }: {
  active: boolean;
  searches: Searches;
  navigate(input: string): Promise<void>;
  closeButton: ReactNode;
}) {
  const history = useBrowserHistory();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const rows = useMemo(() => browserHistoryRows(history.items, searches.items), [history.items, searches.items]);
  const filtered = useMemo(() => filterBrowserHistory(rows, query), [rows, query]);
  const error = history.error || searches.error;
  const ready = history.ready && searches.ready;
  async function remove(row: BrowserHistoryRow) {
    if (row.kind === "search") { await searches.remove(row.search!); return; }
    if (await history.command({ type: "remove", url: row.url })) {
      const search = recentSearchFromInput(row.url);
      if (search) await searches.remove(search);
    }
  }
  async function clear() {
    if (await history.command({ type: "clear" })) await searches.clear();
  }
  return (
    <section className={`browser-tool-panel browser-library-panel ${styles.panel}`} data-active={active} data-error={Boolean(error)} aria-hidden={!active} inert={!active ? true : undefined} aria-label="Browsing history">
      <header className="browser-library-panel-header">
        <span className="browser-library-panel-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="7.2" /><path d="M12 8v4.4l3 1.7M5.2 6.8 3.8 9.5" /></svg></span>
        <span><strong>History</strong><small>{rows.length} saved {rows.length === 1 ? "entry" : "entries"}</small></span>
        <div className="browser-library-panel-actions">
          {rows.length ? <button type="button" className="browser-library-clear" onClick={() => { void clear(); }}>Clear</button> : null}
          {closeButton}
        </div>
      </header>
      {error ? <div role="alert" className="browser-library-empty"><span>{error}</span><button type="button" onClick={() => { history.retry(); void searches.retry(); }}>Try again</button></div> : null}
      <label className="browser-library-filter">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
        <span className="sr-only">Search history by title or URL</span>
        <input type="search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setLimit(100); }} placeholder="Search history by title or URL" />
        {query ? <button type="button" aria-label="Clear history filter" onClick={() => { setQuery(""); setLimit(100); }}>×</button> : null}
      </label>
      <div className="browser-library-list">
        {filtered.slice(0, limit).map((row) => (
          <div key={row.id} className="browser-library-row">
            <a href={row.url} className={`browser-library-link ${styles.pageLink}`} onClick={(event) => { event.preventDefault(); void navigate(row.search ?? row.url); }} title={row.url}>
              <span className="browser-library-icon"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c-5 4-5 12 0 16 5-4 5-12 0-16" /></svg></span>
              <span><strong>{row.title}</strong><small>{row.url}</small>{row.visitedAt ? <time dateTime={new Date(row.visitedAt).toISOString()}>{new Date(row.visitedAt).toLocaleString()}</time> : null}</span>
            </a>
            <button type="button" className="browser-library-remove" onClick={() => { void remove(row); }} aria-label={`Remove ${row.title} from history`} title="Remove from history">×</button>
          </div>
        ))}
        {filtered.length > limit ? <button type="button" className="browser-library-clear" onClick={() => setLimit((value) => value + 100)}>Show more history</button> : null}
        {!filtered.length && !error ? <div className="browser-library-empty"><span aria-hidden="true">↺</span><strong>{!ready ? "Loading history…" : query ? "No matching history" : "No browsing history yet"}</strong><small>{!ready ? "" : query ? "Try another title or URL." : "Websites you visit and searches you make will appear here."}</small></div> : null}
      </div>
    </section>
  );
}
