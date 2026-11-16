"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, ChevronLeft, ExternalLink, Flag, Globe2, Lock, MoreHorizontal, ShieldCheck, Sparkles, Trash2, UsersRound, X } from "lucide-react";
import CrumbsIcon from "@/app/components/crumbs-icon";
import CrumbNotes from "@/app/crumbs/crumb-notes";
import { PostAction, PostCard, PostLabel, PostMenu, PostMenuItem } from "@/app/crumbs/post-card";
import { usePageLoading } from "@/app/components/use-page-loading";
import { annotationPageUrl, annotationTargetKey, looksPrivatePage, type AnnotationMessage, type AnnotationResponse, type BrowserAnnotationTarget } from "@/lib/browser-annotations";
import type { DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { shortHandle } from "@/lib/crumbs/handle";
import styles from "./browser-organization-panel.module.css";

type Send = (command: DesktopTabsCommand) => Promise<boolean>;
type Rooms = { organizations: Array<{ id: number; name: string }>; rooms: Array<{ publicId: string; organizationId: number; slug: string; name: string; archived: boolean }> };
type Account = { signedIn: boolean; needsSignIn: boolean; handle: string | null; displayName: string | null; avatar: string | null; defaultVisibility: string };
type EncryptedOrg = { id: string; name: string; role: "admin" | "member"; ready: boolean; crumbsRoom?: string | null };
type Level = "private" | "org" | "public";
type Mode = { kind: "comment" } | { kind: "flag" } | { kind: "report"; messageId: string; author: string };

const empty: AnnotationResponse = { threads: [], thread: null, messages: [], flags: [] };
const signedOut: Account = { signedIn: false, needsSignIn: false, handle: null, displayName: null, avatar: null, defaultVisibility: "private" };
const levelOf = (scope: string): Level => scope === "private" ? "private" : scope === "public" ? "public" : "org";
function label(target: BrowserAnnotationTarget) {
  if (target.kind === "text") return target.quote ?? "Selected text";
  if (target.kind === "video") return `Video${target.time === undefined ? "" : ` at ${Math.floor(target.time / 60)}:${String(target.time % 60).padStart(2, "0")}`}`;
  return target.kind === "image" ? "Selected image" : "This page";
}
async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? "Couldn’t load this discussion. Try again.");
  return data as T;
}
const crumbsPost = <T,>(body: Record<string, unknown>) => fetch("/api/crumbs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(responseJson<T>);
const day = (value: string) => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const [failed, setFailed] = useState<string | null>(null);
  // Remote avatars are plain images on purpose: they come from the author's own profile.
  // eslint-disable-next-line @next/next/no-img-element
  return src && failed !== src ? <img className={styles.avatar} style={box} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : <span className={styles.avatar} style={box} aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

/** The account, its encrypted organizations, and this Breadboard's rooms. */
async function loadAudiences(signal?: AbortSignal) {
  const [roomData, status] = await Promise.all([
    fetch("/api/buzz/rooms", { signal, cache: "no-store" }).then(responseJson<Rooms>).catch((): Rooms => ({ organizations: [], rooms: [] })),
    fetch("/api/crumbs?view=status", { signal, cache: "no-store" }).then(responseJson<Account>),
  ]);
  const encrypted = status.signedIn ? await fetch("/api/crumbs?view=orgs", { signal, cache: "no-store" }).then(responseJson<{ orgs: EncryptedOrg[] }>).then(data => data.orgs).catch((): EncryptedOrg[] => []) : [];
  return { roomData, status, encrypted };
}

const PANEL_WIDTH = 360;
const PANEL_MIN_WIDTH = 300;
const PANEL_MAX_WIDTH = 720;
const PANEL_WIDTH_KEY = "breadboard:crumbs-panel-width";

export default function BrowserOrganizationPanel({ url, title, target, width: nativeWidth, send, onClose }: {
  url: string; title: string; target?: BrowserAnnotationTarget; width?: number; send: Send; onClose: () => void;
}) {
  const [rooms, setRooms] = useState<Rooms>({ organizations: [], rooms: [] });
  const [account, setAccount] = useState<Account>(signedOut);
  const [orgs, setOrgs] = useState<EncryptedOrg[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  usePageLoading(scope === null && !error);

  const apply = useCallback(({ roomData, status, encrypted }: Awaited<ReturnType<typeof loadAudiences>>) => {
    setRooms(roomData); setAccount(status); setOrgs(encrypted); setError("");
    setScope(previous => {
      if (previous) return previous;
      const preferred = status.defaultVisibility;
      return preferred === "public" || (preferred.startsWith("org:") && encrypted.some(org => `org:${org.id}` === preferred)) ? preferred : "private";
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadAudiences(controller.signal).then(data => { if (!controller.signal.aborted) apply(data); }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    // Signing in happens in another tab; pick the account up when the reader comes back.
    const refresh = () => { if (!document.hidden) loadAudiences().then(data => { if (!controller.signal.aborted) apply(data); }).catch(() => {}); };
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [apply, retry]);

  const pageUrl = annotationPageUrl(url);
  const selected = target && annotationPageUrl(target.url) === pageUrl ? target : { kind: "page" as const, url: pageUrl ?? "", title };
  const groups = [
    ...orgs.filter(org => !org.crumbsRoom).map(org => ({ value: `org:${org.id}`, name: org.name, detail: "Encrypted for members" })),
    // An organization's crumbs are posts in its crumbs room, so the choice is the organization, not a room.
    ...rooms.rooms.filter(room => !room.archived && room.slug === "crumbs").map(room => ({ value: `room:${room.publicId}`, name: rooms.organizations.find(org => org.id === room.organizationId)?.name ?? room.name, detail: "Posted in the crumbs room" })),
  ];
  const level = scope ? levelOf(scope) : null;
  const group = groups.find(item => item.value === scope);
  const audience = scope === "private" ? "Only me" : scope === "public" ? "Public" : group?.name ?? "Organization";
  const needsAccount = Boolean(scope && (scope === "public" || scope.startsWith("org:")) && !account.signedIn);
  function choose(next: Level) {
    setScope(next === "private" ? "private" : next === "public" ? "public" : groups[0]?.value ?? "org:none");
  }

  // The desktop shrinks the page beside the panel, so every width change is sent to it.
  const [width, setWidth] = useState(nativeWidth ?? PANEL_WIDTH);
  const panel = useRef<HTMLElement>(null);
  const resize = useCallback((next: number, keep = true) => {
    const value = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(next)));
    setWidth(value);
    if (keep) try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(value)); } catch { /* the width still applies for this session */ }
    void send({ type: "browser-organization", open: true, width: value });
  }, [send]);
  useEffect(() => {
    let stored = NaN;
    try { stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY)); } catch { /* default width */ }
    if (stored >= PANEL_MIN_WIDTH && stored !== (nativeWidth ?? PANEL_WIDTH)) resize(stored, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per panel: later widths come from dragging
  }, []);

  return <aside ref={panel} className={styles.panel} style={{ "--crumbs-width": `${width}px` } as CSSProperties} aria-label="Crumbs" onKeyDown={event => {
    if (event.key !== "Escape") return;
    const menu = event.currentTarget.querySelector<HTMLDetailsElement>("details[open]");
    if (menu) menu.open = false; else onClose();
    event.stopPropagation();
  }} tabIndex={-1}>
    <div className={styles.resizer} role="separator" aria-label="Resize Crumbs" aria-orientation="vertical" aria-valuemin={PANEL_MIN_WIDTH} aria-valuemax={PANEL_MAX_WIDTH} aria-valuenow={width} tabIndex={0}
      onDoubleClick={() => resize(PANEL_WIDTH)}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); resize(width + (event.key === "ArrowLeft" ? 24 : -24)); } }}
      onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && panel.current) resize(panel.current.getBoundingClientRect().right - event.clientX); }}
      onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    <header className={styles.header}>
      <h2><CrumbsIcon size={19} />Crumbs</h2>
      <a className={styles.account} href="/settings#crumbs" target="_blank" rel="noopener noreferrer" aria-label={account.signedIn ? `Crumbs account, ${shortHandle(account.handle) || "signed in"}` : "Sign in to Crumbs"} title={account.signedIn ? `@${shortHandle(account.handle)}` : "Sign in to Crumbs"}>
        {account.signedIn ? <Avatar src={account.avatar} name={account.displayName ?? account.handle ?? "?"} size={28} /> : "Sign in"}
      </a>
      <button type="button" className={styles.icon} aria-label="Close Crumbs" onClick={onClose}><X size={17} /></button>
    </header>

    <div className={styles.levels} role="radiogroup" aria-label="Who sees this">
      {([["private", "Only me", Lock], ["org", "Organization", UsersRound], ["public", "Public", Globe2]] as const).map(([value, name, Icon]) =>
        <button key={value} type="button" role="radio" aria-checked={level === value} disabled={scope === null} onClick={() => choose(value)}><Icon size={13} />{name}</button>)}
    </div>
    <div className={styles.audience}>
      {level === "org" && groups.length > 1 && <select aria-label="Organization" value={scope ?? ""} onChange={event => setScope(event.target.value)}>
        {groups.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}
      </select>}
      <p>{scope === null ? "" : scope === "private" ? "On this computer only" : scope === "public" ? "Visible to everyone" : group?.detail ?? ""}</p>
    </div>

    {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</button></p>}
    {scope === "org:none" ? <div className={styles.card}>
      <ShieldCheck size={22} strokeWidth={1.4} />
      <p>No organizations yet</p>
      <a className={styles.primary} href={account.signedIn ? "/crumbs?tab=organizations" : "/settings#crumbs"} target="_blank" rel="noopener noreferrer">{account.signedIn ? "Create one" : "Sign in"}</a>
    </div> : pageUrl && scope ? <Discussion key={`${scope}:${pageUrl}:${annotationTargetKey(selected)}:${account.signedIn}`} scope={scope} audience={audience} target={selected} send={send} needsAccount={needsAccount} expired={account.needsSignIn} />
      : <div className={styles.empty}>{scope && "Open a web page to leave a crumb."}</div>}
  </aside>;
}

function Discussion({ scope, audience, target: initialTarget, send, needsAccount, expired }: { scope: string; audience: string; target: BrowserAnnotationTarget; send: Send; needsAccount: boolean; expired: boolean }) {
  // The parent keys this view by page, audience and selection. Keep the anchor
  // stable across native state broadcasts, which include fresh object copies.
  const [target] = useState(initialTarget);
  const [data, setData] = useState<AnnotationResponse>(empty);
  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "comment" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState<{ text?: string; error?: string; busy?: boolean } | null>(null);
  const [checks, setChecks] = useState<Record<string, { text?: string; error?: string; busy?: boolean }>>({});
  const alive = useRef(true);
  const revision = useRef(0);
  const command = useRef(send); command.current = send;
  const operation = useRef({ signature: "", id: "" });
  const input = useRef<HTMLTextAreaElement>(null);
  const network = scope === "public" || scope.startsWith("org:");
  const local = scope.startsWith("room:");
  // An organization cannot be read without the account that holds its keys.
  const locked = needsAccount && scope.startsWith("org:");
  usePageLoading(!loaded && !error && !locked);
  const paint = (result: AnnotationResponse) => void command.current({ type: "browser-organization-markers", items: result.threads.map(thread => ({ id: thread.id, target: thread.target, count: thread.count, ...(thread.preview ? { preview: thread.preview } : {}) })) });

  useEffect(() => {
    alive.current = true;
    if (locked) return;
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      const version = revision.current;
      try {
        const query = new URLSearchParams({ scope, url: target.url });
        let result = await fetch(`/api/browser/annotations?${query}`, { signal: controller.signal, cache: "no-store" }).then(responseJson<AnnotationResponse>);
        const thread = result.threads.find(thread => annotationTargetKey(thread.target) === annotationTargetKey(target));
        if (thread) { query.set("thread", thread.id); result = await fetch(`/api/browser/annotations?${query}`, { signal: controller.signal, cache: "no-store" }).then(responseJson<AnnotationResponse>); }
        if (!controller.signal.aborted && version === revision.current) { setData(previous => ({ ...result, notice: result.notice ?? previous.notice })); setLoaded(true); setError(""); paint(result); }
      } catch (error) {
        if (!controller.signal.aborted && version === revision.current) { setError(error instanceof Error ? error.message : "Couldn’t load comments."); setLoaded(true); setData(empty); void command.current({ type: "browser-organization-markers", items: [] }); }
      } finally { running = false; }
    }
    void command.current({ type: "browser-organization-markers", items: [] });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { alive.current = false; controller.abort(); clearInterval(timer); void command.current({ type: "browser-organization-markers", items: [] }); };
  }, [scope, target, retry, locked]);

  async function write(action: "comment" | "flag" | "withdraw-flag" | "delete-comment", messageId?: string) {
    if (busy) return;
    const payload = { scope, target, action, body, source: showSource ? source : "", messageId };
    const signature = JSON.stringify(payload);
    if (operation.current.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    revision.current++; setBusy(true); setError("");
    try {
      const result = await fetch("/api/browser/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, operationId: operation.current.id }) }).then(responseJson<AnnotationResponse>);
      if (!alive.current) return;
      revision.current++; setData(result); setBody(""); setSource(""); setShowSource(false); setMode({ kind: "comment" }); operation.current = { signature: "", id: "" };
      paint(result);
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Couldn’t save your comment. Try again."); }
    finally { if (alive.current) setBusy(false); }
  }
  function choose(next: BrowserAnnotationTarget) { void send({ type: "browser-organization-target", target: next }); }
  async function summarize() {
    setSummary({ busy: true });
    try { setSummary(await crumbsPost<{ text: string }>({ action: "ai", mode: "summary", url: target.url, scope })); }
    catch (error) { setSummary({ error: error instanceof Error ? error.message : "Couldn’t summarize. Try again." }); }
  }
  async function check(message: AnnotationMessage) {
    setChecks(previous => ({ ...previous, [message.id]: { busy: true } }));
    try {
      const result = await crumbsPost<{ text: string }>({ action: "ai", mode: "check", url: target.url, claim: message.body, quote: target.kind === "text" ? target.quote : "" });
      setChecks(previous => ({ ...previous, [message.id]: result }));
    } catch (error) { setChecks(previous => ({ ...previous, [message.id]: { error: error instanceof Error ? error.message : "Couldn’t check this. Try again." } })); }
  }
  function submit() {
    if (mode.kind === "report") void write("flag", mode.messageId);
    else void write(mode.kind);
  }
  const closeMenu = (element: HTMLElement) => { element.closest("details")!.open = false; };
  // A public crumb publishes the page's address and title; on a page that looks private, ask first.
  const [anyway, setAnyway] = useState(false);
  const confirmPublic = scope === "public" && mode.kind === "comment" && looksPrivatePage(target.url);
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const others = target.kind === "page" ? data.threads.filter(thread => thread.target.kind !== "page") : [];
  const placeholder = mode.kind === "comment" ? "Leave a crumb" : mode.kind === "flag" ? "What should others know?" : "What is wrong with it?";

  if (locked) return <div className={styles.card}>
    <ShieldCheck size={22} strokeWidth={1.4} /><p>{expired ? "Sign in again to open this" : "Sign in to open this"}</p>
    <a className={styles.primary} href="/settings#crumbs" target="_blank" rel="noopener noreferrer">Sign in</a>
  </div>;

  return <div className={styles.discussion} aria-label="This page">
    <div className={styles.scroll}>
      <div className={styles.pageTitle}><span>{target.title || new URL(target.url).hostname}</span><small>{new URL(target.url).hostname}</small></div>
      {target.kind !== "page" && <div className={styles.selection}>
        <button className={styles.textLink} type="button" onClick={() => choose({ kind: "page", url: target.url, title: target.title })}><ChevronLeft size={13} />This page</button>
        <blockquote>{label(target)}</blockquote>
      </div>}

      {network && target.kind === "page" && data.threads.length > 0 && <div className={styles.ai}>
        {!summary && <button type="button" onClick={() => void summarize()}><Sparkles size={13} />Summarize the discussion</button>}
        {summary?.busy && <p className={styles.thinking}><Sparkles size={13} />Summarizing</p>}
        {summary?.text && <div className={styles.answer}><strong><Sparkles size={12} />Summary</strong><p>{summary.text}</p><button type="button" className={styles.textLink} onClick={() => setSummary(null)}>Hide</button></div>}
        {summary?.error && <p className={styles.error} role="alert">{summary.error} <button type="button" onClick={() => void summarize()}>Try again</button></p>}
      </div>}

      {others.length > 0 && <ul className={styles.threads} aria-label="Passages with crumbs">{others.map(thread => <li key={thread.id}>
        <button type="button" className={styles.thread} onClick={() => choose(thread.target)}>
          <span>{label(thread.target)}</span>
          {thread.preview && <em>{thread.preview}</em>}
          <small>{thread.count} {thread.count === 1 ? "crumb" : "crumbs"}</small>
        </button></li>)}</ul>}

      {loaded && !data.messages.length && !data.flags.length && !others.length && <div className={styles.empty}><CrumbsIcon size={24} strokeWidth={1.3} /><p>{target.kind === "page" ? "No crumbs here yet" : "No crumbs on this yet"}</p>{target.kind === "page" && <small>Select text and choose Leave a crumb, or write about the whole page.</small>}</div>}

      <div aria-live="polite" aria-relevant="additions text">{data.messages.map(message => {
        const result = checks[message.id];
        const author = shortHandle(message.author);
        const notable = scope === "public" && message.id.startsWith("at://") && message.id.includes("/com.breadboard.highlight/");
        const noteCount = noteCounts[message.id] ?? message.noteCount ?? 0;
        return <PostCard className={styles.message} key={message.id}
          avatar={<Avatar src={message.avatar} name={author} size={40} />} name={author} handle={message.handle ? shortHandle(message.handle) : null}
          time={<time dateTime={message.createdAt}>{day(message.createdAt)}</time>}
          menu={(network || message.own || message.canDelete) ? <PostMenu label={`Options for ${author}’s crumb`}>
            {network && <PostMenuItem icon={<Sparkles size={18} />} onClick={() => void check(message)}>Check against the page</PostMenuItem>}
            {network && !message.own && <PostMenuItem icon={<Flag size={18} />} onClick={() => { setMode({ kind: "report", messageId: message.id, author: message.author }); setBody(""); input.current?.focus(); }}>{scope === "public" ? "Report" : "Report to admins"}</PostMenuItem>}
            {(message.own || message.canDelete) && <PostMenuItem icon={<Trash2 size={18} />} danger disabled={busy} onClick={() => void write("delete-comment", message.id)}>Delete</PostMenuItem>}
          </PostMenu> : undefined}
          actions={<>
            {notable && <PostAction icon={<UsersRound size={18} />} count={noteCount || undefined} aria-expanded={Boolean(notesOpen[message.id])} label={noteCount > 0 ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}` : "Add note"} onClick={() => setNotesOpen(open => ({ ...open, [message.id]: !open[message.id] }))} />}
            {network && <PostAction icon={<Sparkles size={18} />} label="Check this claim" disabled={result?.busy} onClick={() => void check(message)} />}
            <PostLabel>{scope === "public" ? <Globe2 size={15} /> : <Lock size={15} />}{audience}</PostLabel>
          </>}
          endActions={message.source ? <PostAction icon={<ExternalLink size={18} />} label="Open the source" onClick={() => window.open(message.source!, "_blank", "noopener,noreferrer")} /> : undefined}>
          <p>{message.body}</p>
          {notable && <CrumbNotes crumbId={message.id} note={message.note} count={message.noteCount} own={message.own} signedIn={!needsAccount} open={Boolean(notesOpen[message.id])} onCount={count => setNoteCounts(counts => counts[message.id] === count ? counts : { ...counts, [message.id]: count })} />}
          {message.unverified && <small className={styles.warning}>Sender not verified</small>}
          {result?.busy && <p className={styles.thinking}><Sparkles size={13} />Checking</p>}
          {result?.text && <div className={styles.answer}><strong><Sparkles size={12} />{result.text.split("\n")[0]}</strong><p>{result.text.split("\n").slice(1).join("\n").trim()}</p></div>}
          {result?.error && <p className={styles.error} role="alert">{result.error}</p>}
        </PostCard>;
      })}</div>

      {data.flags.length > 0 && <details className={styles.flags}><summary><Flag size={13} />{data.flags.length} {local ? (data.flags.length === 1 ? "flag" : "flags") : (data.flags.length === 1 ? "report" : "reports")}</summary>{data.flags.map(flag => <div key={flag.id}><strong>{flag.author}</strong><p>{flag.reason}</p>{flag.own && <button type="button" disabled={busy} onClick={() => void write("withdraw-flag")}>Remove my flag</button>}</div>)}</details>}
      {data.thread?.organizationHref && <a className={styles.textLink} href={data.thread.organizationHref} target="_blank" rel="noopener noreferrer">Open thread in Organization <ExternalLink size={12} /></a>}
    </div>

    {data.notice && <p className={styles.notice} role="status">{data.notice}</p>}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry loading</button></p>}
    {needsAccount ? <div className={styles.signin}>
      <p>{expired ? "Sign in again to post" : "Sign in to post publicly"}</p>
      <a className={styles.primary} href="/settings#crumbs" target="_blank" rel="noopener noreferrer">Sign in</a>
    </div> : <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit(); }}>
      {mode.kind !== "comment" && <div className={styles.mode}><span><Flag size={13} />{mode.kind === "flag" ? `Flag this ${target.kind === "page" ? "page" : "selection"}` : `Report ${mode.author}’s crumb`}</span><button type="button" aria-label="Cancel" onClick={() => setMode({ kind: "comment" })}><X size={14} /></button></div>}
      <textarea ref={input} aria-label={mode.kind === "comment" ? "Comment" : mode.kind === "flag" ? "Reason for flagging" : "Reason for reporting"} placeholder={placeholder} value={body} onChange={event => setBody(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && body.trim() && loaded && !busy && !(confirmPublic && !anyway)) { event.preventDefault(); submit(); } }} rows={3} maxLength={mode.kind === "comment" ? 4000 : 1000} disabled={busy} />
      {showSource && mode.kind === "comment" && <input type="url" aria-label="Source link" placeholder="https://source…" value={source} onChange={event => setSource(event.target.value)} disabled={busy} />}
      {confirmPublic && <label className={styles.privatePage}><input type="checkbox" checked={anyway} onChange={event => setAnyway(event.target.checked)} />
        <span>This page looks private. A public crumb shows its address and title to everyone. Post publicly anyway</span></label>}
      <footer><span className={styles.postingTo}>{mode.kind === "comment" ? "Post to " : mode.kind === "flag" ? "Flag visible to " : scope === "public" ? "Report on " : "Report in "}{audience}</span>
        {mode.kind !== "report" && <details className={styles.menu}><summary aria-label="More comment options"><MoreHorizontal size={18} /></summary><div>
          <button type="button" onClick={event => { setShowSource(value => !value); closeMenu(event.currentTarget); }}>{showSource ? "Remove source" : "Add a source"}</button>
          {local && <button type="button" onClick={event => { setMode(mode.kind === "flag" ? { kind: "comment" } : { kind: "flag" }); closeMenu(event.currentTarget); input.current?.focus(); }}>{mode.kind === "flag" ? "Write a comment" : "Flag this content"}</button>}
        </div></details>}
        <button className={styles.submit} type="submit" disabled={busy || !loaded || !body.trim() || (confirmPublic && !anyway)} aria-label={mode.kind === "comment" ? "Post comment" : mode.kind === "flag" ? "Submit flag" : "Send report"}><ArrowUp size={16} /></button></footer>
    </form>}
  </div>;
}
