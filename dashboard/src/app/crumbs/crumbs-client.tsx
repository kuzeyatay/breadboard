"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type MouseEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ExternalLink, Flag, Globe2, Lock, LogOut, MessageSquare, Plus, ShieldCheck, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import CrumbsIcon from "@/app/components/crumbs-icon";
import { shortHandle } from "@/lib/crumbs/handle";
import { usePageLoading } from "@/app/components/use-page-loading";
import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import { annotationTargetKey, type AnnotationResponse, type BrowserAnnotationTarget } from "@/lib/browser-annotations";
import CrumbNotes from "./crumb-notes";
import styles from "./crumbs.module.css";

type Tab = "feed" | "organizations";
interface Person { did: string; handle: string | null; displayName: string | null; avatar: string | null }
export interface CrumbsStatus { signedIn: boolean; needsSignIn: boolean; did: string | null; handle: string | null; displayName: string | null; avatar: string | null; defaultVisibility: string; servers: { indexer: string; orgStore: string }; publicMode: "records" | "posts" }
type Status = CrumbsStatus;
interface FeedItem { id: string; author: Person; url: string; title: string; target: BrowserAnnotationTarget; comment: string; source: string | null; createdAt: string; threadCount: number; own: boolean; audience: string; state?: string; reason?: string | null; note?: { uri: string; body: string; source: string | null }; noteCount?: number }
interface Org { id: string; name: string; role: "admin" | "member"; ready: boolean }
interface OrgDetail extends Org { members: Array<Person & { role: "admin" | "member"; waitingForKey: boolean }>; reports: Array<{ id: string; messageId: string; reporter: Person; reason: string; createdAt: string }> }

/** Where the Crumbs account lives: a section of Breadboard's own settings. */
const ACCOUNT_HREF = "/settings#crumbs";

async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? "Something went wrong. Try again.");
  return data as T;
}
const view = <T,>(query: string, signal?: AbortSignal) => fetch(`/api/crumbs?${query}`, { cache: "no-store", signal }).then(read<T>);
const act = <T,>(body: Record<string, unknown>) => fetch("/api/crumbs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(read<T>);
const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";
const nameOf = (person: Person) => person.displayName || shortHandle(person.handle) || "Someone";
async function openSite(url: string) { if (!await openBrowserInDesktop({ url })) window.open(url, "_blank", "noopener"); }
function ago(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
/** A Breadboard organization that is not on Crumbs yet. */
type LocalOrg = { id: number; name: string };
async function loadAccount() {
  const status = await view<Status>("view=status");
  const lists = status.signedIn ? await view<{ orgs: Org[]; local: LocalOrg[] }>("view=orgs").catch(() => ({ orgs: [], local: [] })) : { orgs: [], local: [] };
  return { status, orgs: lists.orgs, local: lists.local };
}

function Avatar({ person, size = 36 }: { person: Person; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  // eslint-disable-next-line @next/next/no-img-element
  return person.avatar && failed !== person.avatar ? <img className={styles.avatar} style={{ width: size, height: size }} src={person.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(person.avatar)} />
    : <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{nameOf(person).charAt(0).toUpperCase()}</span>;
}
function Problem({ text, retry }: { text: string; retry?: () => void }) {
  return <p className={styles.error} role="alert">{text}{retry && <> <button type="button" onClick={retry}>Try again</button></>}</p>;
}

/** A handle field that suggests accounts, with their photos, as you type. */
function HandleField({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().replace(/^@/, "");
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void view<{ people: Person[] }>(`view=typeahead&q=${encodeURIComponent(query)}`, controller.signal).then(data => { setPeople(data.people); setActive(-1); }).catch(() => {}), 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const shown = open && query.length >= 2 && people.length > 0 && !people.some(person => person.handle === value.trim());
  const pick = (person: Person) => { onChange(person.handle ?? ""); setOpen(false); };
  return <div className={styles.handleField}>
    <span aria-hidden="true">@</span>
    <input aria-label={label} role="combobox" aria-expanded={shown} aria-controls="crumbs-handle-options" aria-autocomplete="list" autoComplete="off" autoCapitalize="none" spellCheck={false}
      placeholder={placeholder} value={value} onChange={event => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
      onKeyDown={event => {
        if (!shown) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => (index + 1) % people.length); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index - 1 + people.length) % people.length); }
        else if (event.key === "Enter" && active >= 0) { event.preventDefault(); pick(people[active]!); }
        else if (event.key === "Escape") setOpen(false);
      }} />
    {shown && <ul id="crumbs-handle-options" role="listbox" className={styles.options}>{people.map((person, index) =>
      <li key={person.did} role="option" aria-selected={index === active} onMouseDown={event => { event.preventDefault(); pick(person); }} onMouseEnter={() => setActive(index)}>
        <Avatar person={person} size={28} /><span><strong>{nameOf(person)}</strong><small>@{shortHandle(person.handle)}</small></span>
      </li>)}</ul>}
  </div>;
}

export default function CrumbsClient({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<Status | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [localOrgs, setLocalOrgs] = useState<LocalOrg[]>([]);
  const [error, setError] = useState("");
  usePageLoading(!status && !error);
  const apply = useCallback((data: Awaited<ReturnType<typeof loadAccount>>) => { setStatus(data.status); setOrgs(data.orgs); setLocalOrgs(data.local); setError(""); return data.status; }, []);
  const refresh = useCallback(() => loadAccount().then(apply), [apply]);
  useEffect(() => {
    let alive = true;
    loadAccount().then(data => { if (alive) apply(data); }).catch(error => { if (alive) setError(message(error)); });
    const onFocus = () => { if (!document.hidden) loadAccount().then(data => { if (alive) apply(data); }).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
  }, [apply]);
  function choose(next: Tab) { setTab(next); window.history.replaceState(null, "", next === "feed" ? "/crumbs" : `/crumbs?tab=${next}`); }

  return <main className={styles.page}>
    <div className={styles.column}>
      <header className={styles.header}>
        <h1><CrumbsIcon size={30} strokeWidth={1.6} />Crumbs</h1>
        <div className={styles.bar}>
          <nav className={styles.tabs} role="tablist" aria-label="Crumbs sections">
            {(["feed", "organizations"] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => choose(value)}>{value === "feed" ? "Feed" : "Organizations"}</button>)}
          </nav>
          {status && <a className={styles.accountLink} href={ACCOUNT_HREF}>
            {status.signedIn ? <><Avatar person={{ did: status.did!, handle: status.handle, displayName: status.displayName, avatar: status.avatar }} size={24} />{status.displayName || shortHandle(status.handle)}</> : "Sign in"}
          </a>}
        </div>
      </header>
      {error && <Problem text={error} retry={() => void refresh().catch(error => setError(message(error)))} />}
      {status && tab === "feed" && <Feed status={status} orgs={orgs} />}
      {status && tab === "organizations" && <Organizations status={status} orgs={orgs} localOrgs={localOrgs} refresh={refresh} />}
    </div>
  </main>;
}

/** One crumb in the timeline: who, the passage, what they said, and what you can do with it. */
function Crumb({ item, scope, signedIn, onRemoved, detail, onOpen }: { item: FeedItem; scope: string; signedIn: boolean; onRemoved: () => void; detail?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(Boolean(detail));
  const [thread, setThread] = useState<AnnotationResponse | null>(null);
  const [text, setText] = useState("");
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  usePageLoading(busy);
  // Replies are crumbs on the same passage, in the same place this one lives.
  const audience = scope.startsWith("org:") ? scope : "public";
  const isPublic = audience === "public" && item.audience === "Public";
  async function loadThread() {
    const query = new URLSearchParams({ scope: audience, url: item.target.url });
    const page = await fetch(`/api/browser/annotations?${query}`, { cache: "no-store" }).then(read<AnnotationResponse>);
    const match = page.threads.find(candidate => annotationTargetKey(candidate.target) === annotationTargetKey(item.target));
    if (!match) return page;
    query.set("thread", match.id);
    return fetch(`/api/browser/annotations?${query}`, { cache: "no-store" }).then(read<AnnotationResponse>);
  }
  async function run(work: () => Promise<AnnotationResponse | void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { const result = await work(); if (result) { setThread(result); setNotice(result.notice ?? ""); } }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  const write = (action: string, body: string, messageId?: string) => fetch("/api/browser/annotations", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: audience, target: item.target, action, body, messageId, operationId: crypto.randomUUID() }) }).then(read<AnnotationResponse>);
  function toggle() {
    setOpen(value => !value); setReporting(false);
    if (!open && !thread) void run(loadThread);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (reporting) void run(async () => { const result = await write("flag", text, item.id); setText(""); setReporting(false); return result; });
    else void run(async () => { const result = await write("comment", text); setText(""); return result; });
  }
  // The post view shows the replies straight away.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the post opens
  useEffect(() => { if (detail) void run(loadThread); }, []);
  const replies = (thread?.messages ?? []).filter(reply => reply.id !== item.id);
  const count = thread ? thread.messages.length : item.threadCount;
  const host = new URL(item.target.url).hostname;

  // Anywhere on the card that is not itself a control opens the post, as on any timeline.
  const openable = !detail && onOpen ? {
    tabIndex: 0, "data-openable": true, "aria-label": `Crumb by ${nameOf(item.author)}`,
    onClick: (event: MouseEvent<HTMLElement>) => { if (!(event.target as HTMLElement).closest("button, a, textarea, input, form") && !window.getSelection()?.toString()) onOpen(); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" && event.target === event.currentTarget) onOpen(); },
  } : {};

  return <article className={styles.crumb} data-crumb={item.id} data-detail={detail || undefined} {...openable}>
    <Avatar person={item.author} size={40} />
    <div className={styles.crumbBody}>
      <div className={styles.byline}><strong>{nameOf(item.author)}</strong>{item.author.handle && <span>@{shortHandle(item.author.handle)}</span>}<time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{ago(item.createdAt)}</time></div>
      {item.state && item.state !== "visible" && <p className={styles.state} data-state={item.state}>{item.state === "rejected" ? `Not shown${item.reason ? `: ${item.reason}` : ""}` : STATES[item.state] ?? "Hidden"}</p>}
      <p className={styles.comment}>{item.comment}</p>
      <button type="button" className={styles.source} onClick={() => void openSite(item.url)} title="Open the page at this passage">
        {item.target.kind === "text" && <q>{item.target.quote}</q>}
        <span><Globe2 size={13} /><strong>{item.title || host}</strong><small>{host}</small><ExternalLink size={12} /></span>
      </button>
      {isPublic && <CrumbNotes crumbId={item.id} note={item.note} count={item.noteCount} own={item.own} signedIn={signedIn} />}
      <footer>
        <button type="button" aria-expanded={open && !reporting} aria-label={`Reply, ${count} ${count === 1 ? "crumb" : "crumbs"} on this passage`} onClick={toggle}><MessageSquare size={14} />{count > 1 ? count - 1 : ""}</button>
        <button type="button" aria-label="Open the page" onClick={() => void openSite(item.url)}><ExternalLink size={14} /></button>
        {item.source && <a href={item.source} target="_blank" rel="noopener noreferrer">Source</a>}
        <span className={styles.audience}>{item.audience === "Public" || item.audience === "Bluesky" ? <Globe2 size={12} /> : <Lock size={12} />}{item.audience}</span>
        {signedIn && !item.own && <button type="button" aria-label="Report this crumb" aria-pressed={reporting} onClick={() => { setOpen(true); setReporting(value => !value); if (!thread) void run(loadThread); }}><Flag size={14} /></button>}
        {item.own && <button type="button" aria-label="Delete this crumb" disabled={busy} onClick={() => void run(async () => { await act({ action: "delete", id: item.id }).catch(() => write("delete-comment", "", item.id)); onRemoved(); })}><Trash2 size={14} /></button>}
      </footer>
      {error && <Problem text={error} />}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {open && <div className={styles.replies}>
        {detail && thread && replies.length === 0 && <p className={styles.noReplies}>No replies yet</p>}
        {replies.map(reply => <div key={reply.id} className={styles.reply}>
          <Avatar person={{ did: reply.did ?? reply.id, handle: reply.handle ?? null, displayName: reply.author, avatar: reply.avatar ?? null }} size={26} />
          <div><div className={styles.byline}><strong>{shortHandle(reply.author)}</strong>{reply.handle && <span>@{shortHandle(reply.handle)}</span>}<time dateTime={reply.createdAt}>{ago(reply.createdAt)}</time></div><p>{reply.body}</p></div>
        </div>)}
        {signedIn ? <form className={styles.replyForm} onSubmit={submit}>
          <textarea aria-label={reporting ? "Reason for reporting" : "Reply"} placeholder={reporting ? "What is wrong with it?" : "Reply with a crumb"} rows={1} maxLength={reporting ? 1000 : 4000} value={text} disabled={busy}
            onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && text.trim()) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" className={styles.primary} disabled={busy || !text.trim()}>{reporting ? "Report" : "Reply"}</button>
        </form> : <a className={styles.link} href={ACCOUNT_HREF}>Sign in to reply</a>}
      </div>}
    </div>
  </article>;
}

const STATES: Record<string, string> = { pending: "Waiting for review", reported: "Hidden after reports", hidden: "Hidden by a moderator" };

function Feed({ status, orgs }: { status: Status; orgs: Org[] }) {
  const [scope, setScope] = useState(status.signedIn ? "following" : "everyone");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [empty, setEmpty] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  usePageLoading(loading);
  const load = useCallback(async (more?: string | null) => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const page = await view<{ items: FeedItem[]; before: string | null; empty?: string }>(`view=feed&scope=${encodeURIComponent(scope)}${more ? `&before=${encodeURIComponent(more)}` : ""}`);
      if (id !== request.current) return;
      setItems(previous => more ? [...previous, ...page.items] : page.items); setBefore(page.before); setEmpty(page.empty ?? "");
    } catch (error) { if (id === request.current) setError(message(error)); }
    finally { if (id === request.current) setLoading(false); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  function back() {
    const id = selected?.id;
    setSelected(null);
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-crumb]")].find(card => card.dataset.crumb === id)?.scrollIntoView({ block: "center" }));
  }
  const scopes: Array<[string, string]> = [...(status.signedIn ? [["following", "Following"]] as Array<[string, string]> : []), ["everyone", "Everyone"], ...(status.signedIn ? [["mine", "Mine"]] as Array<[string, string]> : []), ...orgs.map(org => [`org:${org.id}`, org.name] as [string, string])];

  return <section aria-label="Feed" className={styles.timeline}>
    {selected && <div className={styles.post}>
      <button type="button" className={styles.back} onClick={back}><ArrowLeft size={15} />Back</button>
      <Crumb key={selected.id} detail item={selected} scope={scope} signedIn={status.signedIn} onRemoved={() => { setItems(previous => previous.filter(other => other.id !== selected.id)); setSelected(null); }} />
    </div>}
    <div hidden={Boolean(selected)}>
    <div className={styles.scopes} role="tablist" aria-label="Whose crumbs">
      {scopes.map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={scope === value} onClick={() => { setItems([]); setScope(value); }}>{value.startsWith("org:") && <Lock size={11} />}{name}</button>)}
    </div>
    {error && <Problem text={error} retry={() => void load()} />}
    <div className={styles.feed} aria-live="polite">
      {items.map(item => <Crumb key={item.id} item={item} scope={scope} signedIn={status.signedIn} onOpen={() => { setSelected(item); requestAnimationFrame(() => document.querySelector("[data-detail]")?.closest("section")?.scrollIntoView({ block: "start" })); }} onRemoved={() => setItems(previous => previous.filter(other => other.id !== item.id))} />)}
    </div>
    {!loading && !error && items.length === 0 && <div className={styles.emptyState}>
      <CrumbsIcon size={34} strokeWidth={1.2} />
      <h2>{empty || "No crumbs yet"}</h2>
      {!status.signedIn && scope !== "everyone" && <a className={styles.primary} href={ACCOUNT_HREF}>Sign in</a>}
    </div>}
    {before && !loading && <button type="button" className={styles.more} onClick={() => void load(before)}>Show older</button>}
    </div>
  </section>;
}

function SignIn({ status, refresh }: { status: Status; refresh: () => Promise<Status> }) {
  const [handle, setHandle] = useState(status.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  usePageLoading(busy);
  // Signing in finishes in a browser tab; watch for the account to appear here.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 2500);
    const stop = setTimeout(() => setWaiting(false), 10 * 60_000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [waiting, refresh]);
  async function start(event: FormEvent | null, signup = false) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { url } = await act<{ url: string }>({ action: "sign-in", handle, signup });
      await openSite(url);
      setWaiting(true);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <section className={styles.signIn} aria-labelledby="crumbs-sign-in-title">
    <CrumbsIcon size={36} strokeWidth={1.2} />
    <h2 id="crumbs-sign-in-title">Sign in to Crumbs</h2>
    <p>Use your Bluesky account.</p>
    <form onSubmit={event => void start(event)}>
      <HandleField value={handle} onChange={setHandle} label="Your handle" placeholder="name.bsky.social" />
      <button type="submit" className={styles.primary} disabled={busy || handle.trim().length < 3}>Continue</button>
    </form>
    {error && <Problem text={error} />}
    {waiting && <p className={styles.waiting} role="status">Finish on the page that opened.</p>}
    <p className={styles.fine}><Lock size={12} /> Your password is typed on your account’s own site.</p>
    <p className={styles.fine}><button type="button" className={styles.link} disabled={busy} onClick={() => void start(null, true)}>Create an account</button></p>
  </section>;
}

function Account({ status, orgs, refresh }: { status: Status; orgs: Org[]; refresh: () => Promise<Status> }) {
  const [follows, setFollows] = useState<{ crumbs: Array<Person & { uri: string }>; bluesky: number } | null>(null);
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  const [handleResult, setHandleResult] = useState<{ handle: string; applied: boolean; instructions?: string } | null>(null);
  const [servers, setServers] = useState(status.servers);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  usePageLoading(Boolean(busy));
  useEffect(() => { if (status.signedIn) void view<typeof follows>("view=follows").then(setFollows).catch(error => setError(message(error))); }, [status.signedIn, status.did]);
  if (!status.signedIn) return <SignIn status={status} refresh={refresh} />;
  async function run(label: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError("");
    try { await work(); } catch (error) { setError(message(error)); } finally { setBusy(""); }
  }
  const me: Person = { did: status.did!, handle: status.handle, displayName: status.displayName, avatar: status.avatar };
  return <section className={styles.stack} aria-label="Crumbs account">
    {error && <Problem text={error} />}
    <div className={styles.card}>
      <div className={styles.profile}>
        <Avatar person={me} size={48} />
        <div><h2>{nameOf(me)}</h2><p>@{shortHandle(status.handle)}</p></div>
        <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void run("out", async () => { await act({ action: "sign-out" }); await refresh(); })}><LogOut size={14} />Sign out</button>
      </div>
    </div>

    <div className={styles.card}>
      <h3>Default audience</h3>
      <div className={styles.choices} role="radiogroup" aria-label="Default audience">
        {[["private", "Only me", Lock] as const, ["public", "Public", Globe2] as const, ...orgs.map(org => [`org:${org.id}`, org.name, UsersRound] as const)].map(([value, title, Icon]) =>
          <button key={value} type="button" role="radio" aria-checked={status.defaultVisibility === value} disabled={Boolean(busy)} onClick={() => void run("visibility", async () => { await act({ action: "visibility", value }); await refresh(); })}>
            <Icon size={15} /><span><strong>{title}</strong></span></button>)}
      </div>
    </div>

    <div className={styles.card}>
      <h3>Following</h3>
      {follows && follows.bluesky > 0 && <p>Includes the {follows.bluesky} {follows.bluesky === 1 ? "person" : "people"} you follow on Bluesky.</p>}
      <form className={styles.row} onSubmit={event => { event.preventDefault(); void run("follow", async () => { setFollows(await act({ action: "follow", who })); setWho(""); }); }}>
        <HandleField value={who} onChange={setWho} label="Handle to follow" placeholder="Add by handle" />
        <button type="submit" className={styles.secondary} disabled={Boolean(busy) || who.trim().length < 3}><UserPlus size={14} />Follow</button>
      </form>
      {follows && follows.crumbs.length > 0 && <ul className={styles.people}>{follows.crumbs.map(person => <li key={person.did}>
        <Avatar person={person} size={30} /><span><strong>{nameOf(person)}</strong><small>@{shortHandle(person.handle) || person.did}</small></span>
        <button type="button" className={styles.quiet} aria-label={`Unfollow ${nameOf(person)}`} disabled={Boolean(busy)} onClick={() => void run("follow", async () => setFollows(await act({ action: "follow", who: person.did, on: false })))}><X size={15} /></button>
      </li>)}</ul>}
    </div>

    <div className={styles.card}>
      <h3>Breadboard handle</h3>
      <form className={styles.row} onSubmit={event => { event.preventDefault(); void run("handle", async () => { setHandleResult(await act({ action: "handle", name })); await refresh(); }); }}>
        <label className={styles.field}><input aria-label="Handle name" placeholder="yourname" value={name} onChange={event => setName(event.target.value.toLowerCase())} maxLength={20} autoCapitalize="none" spellCheck={false} /></label>
        <button type="submit" className={styles.secondary} disabled={Boolean(busy) || name.trim().length < 3}>Claim</button>
      </form>
      {handleResult && <p className={styles.notice} role="status">{handleResult.applied ? `Your handle is now @${shortHandle(handleResult.handle)}` : handleResult.instructions}</p>}
    </div>

    <details className={styles.card}>
      <summary><h3>Servers</h3></summary>
      <form className={styles.servers} onSubmit={event => { event.preventDefault(); void run("servers", async () => { await act({ action: "servers", indexer: servers.indexer, orgStore: servers.orgStore }); await refresh(); }); }}>
        <label>Highlight index<input value={servers.indexer} onChange={event => setServers({ ...servers, indexer: event.target.value })} spellCheck={false} /></label>
        <label>Organization store<input value={servers.orgStore} onChange={event => setServers({ ...servers, orgStore: event.target.value })} spellCheck={false} /></label>
        <button type="submit" className={styles.secondary} disabled={Boolean(busy)}>Save</button>
      </form>
      <h3 className={styles.sub}>Public crumbs</h3>
      <div className={styles.choices} role="radiogroup" aria-label="How public crumbs are stored">
        {([["records", "Crumbs records", "Only in Crumbs"], ["posts", "Bluesky posts", "Also on your Bluesky profile"]] as const).map(([value, title, detail]) =>
          <button key={value} type="button" role="radio" aria-checked={status.publicMode === value} disabled={Boolean(busy)} onClick={() => void run("mode", async () => { await act({ action: "servers", publicMode: value }); await refresh(); })}>
            <span><strong>{title}</strong><small>{detail}</small></span></button>)}
      </div>
    </details>
  </section>;
}

/**
 * The Crumbs account as a section of Breadboard's settings. Signing in here
 * links the account whose photo and name Breadboard then uses as its own.
 */
export function CrumbsAccountSection({ onStatus }: { onStatus?: (status: CrumbsStatus) => void }) {
  const [state, setState] = useState<{ status: Status; orgs: Org[] } | null>(null);
  const [error, setError] = useState("");
  const report = useRef(onStatus);
  useEffect(() => { report.current = onStatus; }, [onStatus]);
  const apply = useCallback((data: Awaited<ReturnType<typeof loadAccount>>) => { setState(data); setError(""); report.current?.(data.status); return data.status; }, []);
  const refresh = useCallback(() => loadAccount().then(apply), [apply]);
  useEffect(() => {
    let alive = true;
    loadAccount().then(data => { if (alive) apply(data); }).catch(error => { if (alive) setError(message(error)); });
    const onFocus = () => { if (!document.hidden) loadAccount().then(data => { if (alive) apply(data); }).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
  }, [apply]);
  return <div className={styles.embedded}>
    {error && <Problem text={error} retry={() => void refresh().catch(error => setError(message(error)))} />}
    {state && <Account status={state.status} orgs={state.orgs} refresh={refresh} />}
  </div>;
}

function Organizations({ status, orgs, localOrgs, refresh }: { status: Status; orgs: Org[]; localOrgs: LocalOrg[]; refresh: () => Promise<Status> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [name, setName] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const current = selected && orgs.some(org => org.id === selected) ? selected : orgs[0]?.id ?? null;
  usePageLoading(Boolean(busy) || Boolean(current && detail?.id !== current && !error));
  useEffect(() => {
    if (!current) return;
    let alive = true;
    const load = () => view<OrgDetail>(`view=org&id=${encodeURIComponent(current)}`).then(data => { if (alive) { setDetail(data); setError(""); } }).catch(error => { if (alive) setError(message(error)); });
    void load();
    // Opening an organization also hands its key to members who are waiting for it.
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [current]);
  async function run(label: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError("");
    try { await work(); } catch (error) { setError(message(error)); } finally { setBusy(""); }
  }
  if (!status.signedIn) return <div className={styles.emptyState}>
    <ShieldCheck size={34} strokeWidth={1.2} /><h2>Private groups</h2>
    <p>Encrypted so only members can read them.</p>
    <a className={styles.primary} href={ACCOUNT_HREF}>Sign in</a>
  </div>;
  let body: ReactNode = null;
  if (detail && detail.id === current) {
    const admin = detail.role === "admin";
    body = <>
      <div className={styles.card}>
        <div className={styles.orgTitle}><h2><Lock size={15} />{detail.name}</h2><span>{detail.members.length} {detail.members.length === 1 ? "member" : "members"}</span>
          <a className={styles.secondary} href="/buzz" target="_blank" rel="noopener noreferrer"><MessageSquare size={14} />Messages</a></div>
        {!detail.ready && <p className={styles.notice} role="status">Waiting for a member to share the key with this device</p>}
        <ul className={styles.people}>{detail.members.map(member => <li key={member.did}>
          <Avatar person={member} size={30} /><span><strong>{nameOf(member)}{member.role === "admin" && <em>Admin</em>}{member.waitingForKey && <em data-tone="waiting">Waiting</em>}</strong><small>@{member.handle ?? member.did}</small></span>
          {admin && member.did !== status.did && <button type="button" className={styles.quiet} aria-label={`Remove ${nameOf(member)}`} title="Remove" disabled={Boolean(busy)}
            onClick={() => void run("remove", async () => setDetail(await act({ action: "org-remove", org: detail.id, did: member.did })))}><X size={15} /></button>}
        </li>)}</ul>
        {admin && <form className={styles.row} onSubmit={event => { event.preventDefault(); void run("add", async () => { setDetail(await act({ action: "org-add", org: detail.id, who })); setWho(""); }); }}>
          <HandleField value={who} onChange={setWho} label="Handle to invite" placeholder="Invite by handle" />
          <button type="submit" className={styles.secondary} disabled={Boolean(busy) || who.trim().length < 3}><UserPlus size={14} />Add</button>
        </form>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void run("leave", async () => { await act({ action: "org-leave", org: detail.id }); setSelected(null); await refresh(); })}>Leave</button>
          {admin && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Delete ${detail.name} for everyone?`)) void run("delete", async () => { await act({ action: "org-delete", org: detail.id }); setSelected(null); await refresh(); }); }}>Delete</button>}
        </div>
      </div>
      {admin && detail.reports.length > 0 && <div className={styles.card}>
        <h3>Reports</h3>
        <ul className={styles.reports}>{detail.reports.map(report => <li key={report.id}>
          <span><strong>{nameOf(report.reporter)}</strong> {ago(report.createdAt)}</span><p>{report.reason || "No reason given"}</p>
          <button type="button" className={styles.link} disabled={Boolean(busy)} onClick={() => void run("dismiss", async () => setDetail(await act({ action: "org-dismiss-report", org: detail.id, report: report.id })))}>Dismiss</button>
        </li>)}</ul>
      </div>}
    </>;
  }
  return <section className={styles.stack} aria-label="Organizations">
    {error && <Problem text={error} />}
    {orgs.length > 0 && <div className={styles.scopes} role="radiogroup" aria-label="Your organizations">
      {orgs.map(org => <button key={org.id} type="button" role="radio" aria-checked={org.id === current} onClick={() => setSelected(org.id)}><Lock size={11} />{org.name}</button>)}
    </div>}
    {orgs.length === 0 && localOrgs.length === 0 && <div className={styles.emptyState}><ShieldCheck size={34} strokeWidth={1.2} /><h2>No organizations yet</h2></div>}
    {body}
    {localOrgs.length > 0 && <div className={styles.card}>
      <h3>Your Breadboard organizations</h3>
      <p className={styles.notice}>They stay on this machine until you connect one. Connecting makes an encrypted Crumbs twin and relays its rooms.</p>
      <ul className={styles.people}>{localOrgs.map(org => <li key={org.id}>
        <span><strong>{org.name}</strong></span>
        <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void run("connect", async () => { await act({ action: "org-connect", organization: org.id }); await refresh(); })}><Plus size={14} />Connect</button>
      </li>)}</ul>
    </div>}
    <form className={`${styles.card} ${styles.row}`} onSubmit={event => { event.preventDefault(); void run("create", async () => { const org = await act<Org>({ action: "org-create", name }); setName(""); await refresh(); setSelected(org.id); }); }}>
      <label className={styles.field}><input aria-label="Organization name" placeholder="New organization" value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label>
      <button type="submit" className={styles.primary} disabled={Boolean(busy) || !name.trim()}><Plus size={14} />Create</button>
    </form>
  </section>;
}
