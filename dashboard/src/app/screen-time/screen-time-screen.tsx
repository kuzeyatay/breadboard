"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, BookOpen, ChartNoAxesColumn, Check, ChevronLeft, ChevronRight,
  Clock3, Copy, Globe2, History, Layers2, Monitor, Pause, Play, Search, Settings2, ShieldCheck,
  Sparkles, Sprout, Timer, X } from "lucide-react";
import NavigationLink from "@/app/components/navigation-link";
import { usePageLoading } from "@/app/components/use-page-loading";
import { AUTH_CHANGED_EVENT } from "@/lib/auth-events";
import { CATEGORIES, formatDuration, localDate, screenTimeRange, usageCategory,
  type ActivityCategory, type ScreenTimePeriod, type ScreenTimeResponse, type ScreenTimeSettings, type UsageItem } from "@/lib/screen-time/model";
import type { ShapedSearch } from "@/lib/recall/policy";
import styles from "./screen-time.module.css";

type View = "apps" | "tabs" | "websites";
type Detail = { name: string; app?: string; title?: string; start: number; end: number; url?: string };
const periods: { value: ScreenTimePeriod; label: string }[] = [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
const colors = Object.fromEntries(CATEGORIES.map(item => [item.id, item.color])) as Record<ActivityCategory, string>;
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function AppMark({ name, category, breadboard = false }: { name: string; category: ActivityCategory; breadboard?: boolean }) {
  return <span className={styles.appMark} style={{ "--item-color": colors[category] } as CSSProperties} aria-hidden="true">
    {breadboard ? <Sprout size={20} /> : name.replace(/^(Microsoft|Google)\s+/, "").slice(0, 2).toUpperCase()}
  </span>;
}

export default function ScreenTimeScreen() {
  const [period, setPeriod] = useState<ScreenTimePeriod>("day");
  const [date, setDate] = useState(() => localDate());
  const [view, setView] = useState<View>("apps");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ key: string; value: ScreenTimeResponse } | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [exclusions, setExclusions] = useState("");
  const [useForSuggestions, setUseForSuggestions] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [bucket, setBucket] = useState<number | null>(null);
  const [timelineCount, setTimelineCount] = useState(8), [copied, setCopied] = useState(false);
  const mutation = useRef(false), requestVersion = useRef(0);
  const reduced = useReducedMotion();
  const range = useMemo(() => screenTimeRange(period, date), [period, date]);
  const key = `${period}:${date}`, current = data?.key === key ? data.value : null;
  const summary = current?.summary;
  const selectedBucket = bucket === null ? undefined : summary?.buckets[bucket];
  const visibleSummary = selectedBucket ?? summary;
  const items = (visibleSummary?.[view] ?? []).filter(item => `${item.name} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()));
  const settings = current?.settings ?? { enabled: true, excluded: [], useForSuggestions: true };
  usePageLoading(busy);

  useEffect(() => {
    let disposed = false, controller: AbortController | null = null;
    let pending = false;
    const params = new URLSearchParams({ boundaries: range.boundaries.join(","), previousStart: String(range.previousStart) });
    async function load(initial = false) {
      if (disposed || pending || mutation.current || (!initial && document.visibilityState === "hidden")) return;
      pending = true;
      const version = ++requestVersion.current;
      controller = new AbortController();
      if (initial) setBusy(true);
      try {
        const response = await fetch(`/api/screen-time?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          if ((response.status === 401 || response.status === 403) && !disposed && version === requestVersion.current) { setData(null); setDetail(null); }
          throw new Error(payload.error || "Couldn’t load Screen Time.");
        }
        if (!disposed && version === requestVersion.current) { setData({ key, value: payload }); setError(""); }
      } catch (failure) {
        if (!disposed && !controller.signal.aborted && version === requestVersion.current) setError(failure instanceof Error ? failure.message : "Couldn’t load Screen Time.");
      } finally { pending = false; if (!disposed) setBusy(false); }
    }
    setBucket(null); setTimelineCount(8); setCopied(false);
    void load(true);
    const timer = setInterval(() => { void load(); }, 15000);
    const visible = () => { void load(); };
    const authChanged = () => {
      controller?.abort(); requestVersion.current++; pending = false;
      setData(null); setDetail(null); setSettingsOpen(false);
      void load(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller?.abort(); clearInterval(timer); window.removeEventListener(AUTH_CHANGED_EVENT, authChanged); document.removeEventListener("visibilitychange", visible); };
  }, [key, range, refresh]);

  async function saveSettings(patch: Partial<ScreenTimeSettings>) {
    if (mutation.current) return;
    mutation.current = true; requestVersion.current++; setSaving(true); setError("");
    try {
      const response = await fetch("/api/screen-time", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Couldn’t save Screen Time settings.");
      setData(previous => previous ? { ...previous, value: { ...previous.value, settings: payload.settings } } : previous);
      setSettingsOpen(false); setRefresh(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t save settings."); }
    finally { mutation.current = false; setSaving(false); }
  }

  function moveDate(direction: number) {
    const next = new Date(range.start);
    if (period === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * (period === "week" ? 7 : 1));
    setDate(localDate(next));
  }
  function inspect(item: UsageItem) {
    setDetail({ name: item.name, app: view === "apps" ? item.subtitle : undefined, title: view === "tabs" ? item.title : undefined,
      start: Math.max(item.start, range.start), end: Math.min(item.end, range.end), url: view === "apps" ? undefined : item.url });
  }
  async function copySummary() {
    if (!summary) return;
    const text = [`Screen Time · ${rangeLabel}`, `Active time: ${formatDuration(summary.total)}. Breadboard: ${formatDuration(summary.breadboardTotal)}.`,
      `Longest session: ${formatDuration(summary.longestSession)}. App and tab switches: ${summary.switches}.`,
      "Apps:", ...summary.apps.slice(0, 8).map(item => `${item.name}: ${formatDuration(item.milliseconds)}`),
      "Breadboard tabs:", ...summary.tabs.slice(0, 8).map(item => `${item.name}: ${formatDuration(item.milliseconds)}`),
      "Only foreground time is counted."].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setError("Couldn’t copy the summary. Check clipboard access and try again."); }
  }

  const total = summary?.total ?? 0;
  const rangeLabel = period === "day" ? date === localDate() ? "Today" : new Date(range.start).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : period === "month" ? new Date(range.start).toLocaleDateString([], { month: "long", year: "numeric" })
    : `${new Date(range.start).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date(range.end - 1).toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const state = !settings.enabled ? current?.status.state === "paused" || !current?.status.available ? "Paused" : "Pausing…" : current?.status.state === "tracking" ? "Tracking on this device" : current?.status.state === "idle" ? "Away · tracking paused"
    : current?.status.state === "excluded" ? "Excluded activity" : current?.status.state === "error" ? "Tracker needs attention" : current?.status.state === "unsupported" ? "Windows desktop required"
    : current?.status.state === "starting" ? "Connecting to desktop" : "Desktop tracker offline";
  const maxBucket = Math.max(3600000 * (period === "day" ? .25 : 1), ...summary?.buckets.map(item => item.total) ?? []);
  const leadingTab = summary?.tabs[0];
  const timeline = (summary?.timeline ?? []).filter(item => !selectedBucket || item.end > selectedBucket.start && item.start < selectedBucket.end);

  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.heading}><span className={styles.pageIcon}><ChartNoAxesColumn size={25} strokeWidth={1.7} /></span><div><h1>Screen Time</h1><p>App and tab usage on this device.</p></div></div>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} onClick={() => { setExclusions(settings.excluded.join("\n")); setUseForSuggestions(settings.useForSuggestions); setSettingsOpen(true); }} aria-label="Screen Time settings" title="Screen Time settings"><Settings2 size={18} /></button>
          <button className={styles.pauseButton} disabled={!current || saving} onClick={() => void saveSettings({ enabled: !settings.enabled })}>
            {settings.enabled ? <Pause size={14} /> : <Play size={14} />}{settings.enabled ? "Pause tracking" : "Resume tracking"}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.segmented} aria-label="Time range">
          {periods.map(item => <button key={item.value} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>
            {period === item.value && <motion.span className={styles.segmentSelection} layoutId="screen-time-period" transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0, duration: .32 }} />}
            <span>{item.label}</span>
          </button>)}
        </div>
        <div className={styles.dateControls}>
          <button className={styles.iconButton} onClick={() => moveDate(-1)} aria-label={`Previous ${period}`}><ChevronLeft size={17} /></button>
          <label className={styles.dateLabel}><span>{rangeLabel}</span><input type="date" value={date} max={localDate()} onChange={event => { if (event.target.value) setDate(event.target.value); }} aria-label="Choose date" /></label>
          <button className={styles.iconButton} onClick={() => moveDate(1)} disabled={range.end > Date.now()} aria-label={`Next ${period}`}><ChevronRight size={17} /></button>
          {date !== localDate() && <button className={styles.today} onClick={() => setDate(localDate())}>Today</button>}
        </div>
      </div>
      {error && <div className={styles.error} role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}

      <section className={styles.overview} aria-label="Usage overview" aria-busy={busy}>
        <div className={styles.overviewTop}>
          <div><div className={styles.eyebrow}>Total active time</div><div className={styles.total}>{current ? formatDuration(total) : "—"}</div>
            {current && <p className={styles.comparison}>Previous {period} <strong>{formatDuration(current.previousTotal)}</strong></p>}
          </div>
          <div className={styles.liveState} data-live={settings.enabled && current?.status.state === "tracking"}><i />{current ? state : "Screen Time"}</div>
        </div>
        <div className={styles.chartHeader}><span>{selectedBucket ? `${new Date(selectedBucket.start).toLocaleDateString([], { month: "short", day: "numeric" })} · ${clock(selectedBucket.start)} · ${formatDuration(selectedBucket.total)}` : period === "day" ? "Hourly usage" : "Daily usage"}</span>
          {selectedBucket ? <button onClick={() => setBucket(null)}>Show all</button> : <span>{formatDuration(maxBucket)}</span>}
        </div>
        <div className={styles.chart} role="group" aria-label="Activity chart. Select a bar to explore that time.">
          <div className={styles.gridLines} aria-hidden="true"><i /><i /><i /><i /></div>
          {(summary?.buckets ?? range.boundaries.slice(0, -1).map((start, i) => ({ start, end: range.boundaries[i + 1], total: 0, categories: {} as Record<ActivityCategory, number> }))).map((item, index) => {
            const label = period === "day" ? clock(item.start) : new Date(item.start).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
            return <button key={item.start} className={styles.chartColumn} aria-label={`${label}: ${formatDuration(item.total)}`} aria-pressed={bucket === index}
              title={`${label} · ${formatDuration(item.total)}`} onClick={() => setBucket(bucket === index ? null : index)}>
              <span className={styles.barTrack}><span className={styles.bar} style={{ height: `${item.total / maxBucket * 100}%` }}>
                {CATEGORIES.map(category => item.categories[category.id] > 0 && <span key={category.id} style={{ background: category.color, flex: item.categories[category.id] }} />)}
              </span></span>
              <span className={styles.axisLabel}>{period === "day" ? index % 6 === 0 ? new Date(item.start).getHours().toString().padStart(2, "0") : ""
                : period === "week" ? new Date(item.start).toLocaleDateString([], { weekday: "short" }) : index % 5 === 0 ? new Date(item.start).getDate() : ""}</span>
            </button>;
          })}
        </div>
        <div className={styles.legend}>{(summary?.categories.length ? summary.categories : CATEGORIES.slice(0, 4).map(item => ({ id: item.id, milliseconds: 0 }))).map(item =>
          <span key={item.id}><i style={{ background: colors[item.id] }} />{CATEGORIES.find(category => category.id === item.id)?.label}{item.milliseconds > 0 && <strong>{formatDuration(item.milliseconds)}</strong>}</span>)}</div>
        <div className={styles.metrics}>
          <div><span><Sprout size={15} /> In Breadboard</span><strong>{current ? formatDuration(summary?.breadboardTotal ?? 0) : "—"}</strong><small>{total ? `${Math.round((summary?.breadboardTotal ?? 0) / total * 100)}% of active time` : "Your tabs and workspaces"}</small></div>
          <div><span><Clock3 size={15} /> Longest session</span><strong>{current ? formatDuration(summary?.longestSession ?? 0) : "—"}</strong><small>Time in one app or tab</small></div>
          <div><span><Layers2 size={15} /> App and tab switches</span><strong>{current ? summary?.switches ?? 0 : "—"}</strong><small>While tracking</small></div>
        </div>
      </section>

      <div className={styles.lowerGrid}>
        <section className={styles.usagePanel} aria-label="Activity breakdown">
          <div className={styles.sectionHeading}><h2>Usage breakdown</h2><span>{summary?.apps.length ?? 0} apps</span></div>
          <div className={styles.breakdownTabs} aria-label="Activity view">{([{ id: "apps", label: "Apps", icon: Monitor }, { id: "tabs", label: "Breadboard tabs", icon: Layers2 }, { id: "websites", label: "Websites", icon: Globe2 }] as const).map(({ id, label, icon: Icon }) =>
            <button key={id} aria-pressed={view === id} onClick={() => { setView(id); setQuery(""); }}><Icon size={14} />{label}</button>)}</div>
          <label className={styles.search}><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Find ${view === "tabs" ? "a tab by name" : view === "apps" ? "an app" : "a website"}…`} aria-label="Filter activity" />{query && <button onClick={() => setQuery("")} aria-label="Clear filter"><X size={14} /></button>}</label>
          <div className={styles.usageList}>
            {items.map(item => <button key={item.id} className={styles.usageRow} onClick={() => inspect(item)}>
              <AppMark name={item.name} category={item.category} breadboard={item.app === "Breadboard" && view !== "websites"} />
              <span className={styles.usageName}><strong>{item.name}</strong><span>{view === "apps" ? CATEGORIES.find(category => category.id === item.category)?.label : item.subtitle} <b>·</b> {item.visits} {item.visits === 1 ? "visit" : "visits"}</span>
                <span className={styles.usageMeter}><i style={{ width: `${item.milliseconds / Math.max(1, visibleSummary?.total ?? 0) * 100}%`, background: colors[item.category] }} /></span>
              </span><span className={styles.duration}>{formatDuration(item.milliseconds)}<small>{Math.round(item.milliseconds / Math.max(1, visibleSummary?.total ?? 0) * 100)}%</small></span><ChevronRight size={15} />
            </button>)}
            {!items.length && <div className={styles.empty}><span><ChartNoAxesColumn size={26} /></span><h3>{query ? "No matching activity" : total ? "No activity in this view" : "No activity recorded"}</h3>
              <p>{query ? "Try another app, tab title or website." : total ? "Try another time or activity view. Website names come from Breadboard’s browser tabs."
                : current?.status.available ? settings.enabled ? "Activity will appear as you use your apps." : "Resume tracking to record usage."
                : "Open Breadboard on Windows to record app and tab time."}</p></div>}
          </div>
          <p className={styles.panelNote}>{view === "tabs" ? "Tab time is part of Breadboard’s app total. Only the foreground tab counts." : view === "websites" ? "Websites visited in Breadboard. Private tabs are excluded." : "Foreground time only. Away time pauses after 5 minutes. Categories are grouped automatically."}</p>
        </section>

        <aside className={styles.aside}>
          <section className={styles.insights}>
            <div className={styles.insightsHeading}><Sparkles size={17} /><h2>Quick actions</h2></div>
            {leadingTab ? <><p className={styles.insightEyebrow}>Most-used tab</p><h3>{leadingTab.name}</h3><p>{formatDuration(leadingTab.milliseconds)} across {leadingTab.visits} {leadingTab.visits === 1 ? "visit" : "visits"}.</p>
              <div className={styles.inlineActions}>{leadingTab.url && <NavigationLink href={leadingTab.url} label={leadingTab.name} newTab className={styles.primaryLink}>Return to tab <ArrowUpRight size={14} /></NavigationLink>}
                <button className={styles.textButton} onClick={() => setDetail({ name: leadingTab.name, title: leadingTab.title, start: leadingTab.start, end: leadingTab.end, url: leadingTab.url })}>Find in Recall <History size={14} /></button></div></>
              : <><h3>No tab activity</h3><p>Used Breadboard tabs will appear here.</p></>}
            <div className={styles.focusNudge}><Timer size={19} /><div><strong>Focus timer</strong><span>Set a timer for your next task.</span></div></div>
            <NavigationLink href="/pomodoro" label="Focus timer" className={styles.textButton}>Open focus timer <ArrowUpRight size={14} /></NavigationLink>
          </section>
          <section className={styles.recallCard}><span className={styles.recallIcon}><History size={21} /></span><h3>Recall</h3><p>Find saved screen content from an app, tab or time.</p>
            <button className={styles.textButton} disabled={!total} onClick={() => setDetail({ name: `${rangeLabel} in Recall`, start: range.start, end: Math.min(range.end, Date.now()) })}>View {period} in Recall <ArrowUpRight size={14} /></button>
          </section>
          <section className={styles.reflect}><BookOpen size={17} /><div><strong>Activity summary</strong><p>Copy app and tab totals to use in Terminal.</p><button className={styles.textButton} disabled={!total} onClick={() => void copySummary()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Summary copied" : "Copy activity summary"}</button>{copied && <NavigationLink href="/new-tab" label="Terminal" className={styles.textButton}>Open Terminal <ArrowUpRight size={13} /></NavigationLink>}</div></section>
        </aside>
      </div>

      <section className={styles.timelinePanel}>
        <div className={styles.sectionHeading}><h2>Activity timeline</h2><History size={18} /></div>
        {timeline.slice(0, timelineCount).map((slice, index) => <button key={`${slice.start}-${index}`} className={styles.timelineRow} onClick={() => setDetail({ name: slice.title, app: slice.kind === "app" ? slice.process : undefined, title: slice.title, start: slice.start, end: slice.end, url: slice.url })}>
          <span className={styles.timelineTime}>{period !== "day" && <small>{new Date(slice.start).toLocaleDateString([], { month: "short", day: "numeric" })}</small>}{clock(slice.start)}</span>
          <span className={styles.timelineDot} style={{ "--item-color": colors[usageCategory(slice)] } as CSSProperties}><i /></span>
          <span className={styles.timelineName}><strong>{slice.title}</strong><span>{slice.app}{slice.domain ? ` · ${slice.domain}` : ""}</span></span>
          <span className={styles.duration}>{formatDuration(slice.end - slice.start)}</span><ChevronRight size={14} />
        </button>)}
        {!timeline.length && <p className={styles.timelineEmpty}>No activity recorded for this period.</p>}
        {timeline.length > timelineCount && <button className={styles.more} onClick={() => setTimelineCount(value => value + 20)}>Show earlier activity <ChevronRight size={14} /></button>}
      </section>
    </div>

    <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}><Dialog.Portal><Dialog.Overlay className={styles.scrim} /><Dialog.Content className={styles.settingsDialog}>
      <Dialog.Close className={styles.close} aria-label="Close settings"><X size={18} /></Dialog.Close><span className={styles.pageIcon}><Settings2 size={23} /></span>
      <Dialog.Title>Screen Time settings</Dialog.Title><Dialog.Description>Track app names, window titles and your active Breadboard tabs while the desktop app is running.</Dialog.Description>
      <div className={styles.settingInfo}><ShieldCheck size={18} /><p>Private Breadboard tabs, automated tabs and idle time are skipped. History stays on this device for up to 180 days, separate for each account.</p></div>
      <label className={styles.exclusionLabel}>Exclude apps or window titles<span>One per line. For a specific window, use App::Title.</span><textarea rows={5} value={exclusions} onChange={event => setExclusions(event.target.value)} placeholder={"Password Manager\nBrowser::Personal"} maxLength={20000} /></label>
      <p className={styles.settingsNote}>Exclusions hide matching history and stop new matching activity within a few seconds. Recall’s own exclusions also apply when viewing this page.</p>
      <label className={styles.suggestionToggle}><span>Use activity in Breadboard suggestions</span><input type="checkbox" checked={useForSuggestions} onChange={event => setUseForSuggestions(event.target.checked)} /></label>
      <p className={styles.settingsNote}>With personalization and Recall agent access enabled, recent app and tab names can inform suggestions through your chosen AI provider. No captured screen text is added by Screen Time.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.primaryButton} disabled={saving} onClick={() => void saveSettings({ excluded: exclusions.split("\n").map(item => item.trim()).filter(Boolean), useForSuggestions })}>{saving ? "Saving…" : "Save preferences"}</button>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <RecallDetail detail={detail} close={() => setDetail(null)} />
  </main>;
}

function RecallDetail({ detail, close }: { detail: Detail | null; close: () => void }) {
  const [result, setResult] = useState<ShapedSearch | null>(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!detail) return;
    const controller = new AbortController();
    setResult(null); setError(""); setPending(true);
    void (async () => {
      try {
        const response = await fetch("/api/screen-time/recall", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(detail) });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.message || "Recall is unavailable. Check its settings, then try again.");
        if (!controller.signal.aborted) setResult(payload.result);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Recall is unavailable."); }
      finally { if (!controller.signal.aborted) setPending(false); }
    })();
    return () => controller.abort();
  }, [detail, attempt]);
  usePageLoading(pending);
  return <Dialog.Root open={Boolean(detail)} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className={styles.scrim} /><Dialog.Content className={styles.recallDialog}>
    <Dialog.Close className={styles.close} aria-label="Close Recall"><X size={18} /></Dialog.Close><span className={styles.recallIcon}><History size={24} /></span>
    <span className={styles.eyebrow}>Recall</span><Dialog.Title>{detail?.name}</Dialog.Title>
    <Dialog.Description>{detail && `${new Date(detail.start).toLocaleDateString([], { month: "short", day: "numeric" })} · ${clock(detail.start)} – ${clock(detail.end)}`}</Dialog.Description>
    {detail?.url && <NavigationLink href={detail.url} label={detail.name} newTab className={styles.primaryLink}>Return to this page <ArrowUpRight size={15} /></NavigationLink>}
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
    <div className={styles.recallResults} aria-busy={pending}>
      {result?.hits.map((hit, index) => <article key={`${hit.frameId}-${index}`} className={styles.recallHit}><div><span>{hit.app || "Captured screen"}</span><time>{hit.timestamp ? clock(Date.parse(hit.timestamp)) : ""}</time></div><h3>{hit.window || "Screen context"}</h3><p>{hit.text}</p></article>)}
      {!pending && !error && result && !result.hits.length && <div className={styles.empty}><History size={27} /><h3>No Recall results</h3><p>Recall needs to be recording at the time to show results.</p></div>}
      {result?.truncated && <p className={styles.settingsNote}>Showing the first matches within your Recall result limit.</p>}
    </div>
    <NavigationLink href="/settings" label="Recall settings" className={styles.textButton}>Manage Recall in Settings <ArrowUpRight size={14} /></NavigationLink>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
