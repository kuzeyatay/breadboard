"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type MouseEvent, type KeyboardEvent } from "react";
import { ArrowLeft, BookOpen, ExternalLink, Flag, Globe2, Link2, Lock, LogOut, MessageCircle, MessageSquare, Plus, ShieldCheck, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import CrumbsIcon from "@/app/components/crumbs-icon";
import { shortHandle } from "@/lib/crumbs/handle";
import { usePageLoading } from "@/app/components/use-page-loading";
import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import { annotationTargetKey, type AnnotationResponse, type BrowserAnnotationTarget } from "@/lib/browser-annotations";
import CrumbNotes from "./crumb-notes";
import { PostAction, PostCard, PostLabel, PostMenu, PostMenuItem } from "./post-card";
import styles from "./crumbs.module.css";

interface Person { did: string; handle: string | null; displayName: string | null; avatar: string | null }
export interface CrumbsStatus { signedIn: boolean; needsSignIn: boolean; did: string | null; handle: string | null; displayName: string | null; avatar: string | null; defaultVisibility: string; servers: { indexer: string; orgStore: string }; publicMode: "records" | "posts" }
type Status = CrumbsStatus;
interface FeedItem { id: string; author: Person; url: string; title: string; target: BrowserAnnotationTarget; comment: string; source: string | null; createdAt: string; threadCount: number; own: boolean; audience: string; /** Where replies to it go, when that is not the tab it is shown in. */ scope?: string; state?: string; reason?: string | null; note?: { uri: string; body: string; source: string | null }; noteCount?: number; /** The crumb that started the thread, when this one is a reply. */ parent?: FeedItem }
interface Org { id: string; name: string; role: "admin" | "member"; ready: boolean; /** Set when it is connected to a Breadboard organization: its crumbs are that organization's crumbs room. */ crumbsRoom?: string | null }
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

/**
 * The Crumbs page, laid out like a familiar timeline: one column, a sticky
 * header with the feed tabs, posts as flat rows. Your own crumbs live on your
 * profile (the photo at the top right), not in a tab. Organizations are run
 * from Settings and the Organization page; here they are only feeds.
 */
/** An organization whose crumbs can be read here, by the feed scope that reads them. */
interface OrgFeed { name: string; scope: string }

export default function CrumbsClient({ initialTab, initialOrg }: { initialTab?: "organizations"; initialOrg?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [organizations, setOrganizations] = useState<OrgFeed[]>([]);
  const [profile, setProfile] = useState(false);
  useEffect(() => { void view<{ organizations: OrgFeed[] }>("view=organizations").then(data => setOrganizations(data.organizations)).catch(() => {}); }, [status?.signedIn]);
  const [error, setError] = useState("");
  usePageLoading(!status && !error);
  const apply = useCallback((data: Awaited<ReturnType<typeof loadAccount>>) => { setStatus(data.status); setOrgs(data.orgs); setError(""); return data.status; }, []);
  const refresh = useCallback(() => loadAccount().then(apply), [apply]);
  useEffect(() => {
    let alive = true;
    loadAccount().then(data => { if (alive) apply(data); }).catch(error => { if (alive) setError(message(error)); });
    const onFocus = () => { if (!document.hidden) loadAccount().then(data => { if (alive) apply(data); }).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
  }, [apply]);
  const me: Person | null = status?.signedIn ? { did: status.did!, handle: status.handle, displayName: status.displayName, avatar: status.avatar } : null;
  const accountButton = me && <button type="button" className={styles.me} aria-label="Your profile" title="Your profile" onClick={() => setProfile(true)}><Avatar person={me} size={32} /></button>;

  return <main className={styles.page}>
    <div className={styles.column}>
      {error && <><Bar title={<><CrumbsIcon size={22} strokeWidth={1.7} />Crumbs</>} /><Problem text={error} retry={() => void refresh().catch(error => setError(message(error)))} /></>}
      {status && me && profile && <Feed key="mine" status={status} orgs={orgs} fixedScope="mine" title={nameOf(me)} onBack={() => setProfile(false)}
        intro={<div className={styles.profile}>
          <Avatar person={me} size={76} />
          <a className={styles.secondary} href={ACCOUNT_HREF}>Edit profile</a>
          <h2>{nameOf(me)}</h2>
          <p>@{shortHandle(me.handle)}</p>
        </div>} />}
      {status && !(me && profile) && <Feed key="home" status={status} orgs={orgs} organizations={organizations} initialTab={initialTab} initialOrg={initialOrg} title={<><CrumbsIcon size={22} strokeWidth={1.7} />Crumbs</>} right={accountButton}
        intro={!status.signedIn && <div className={styles.welcome}>
          <p><strong>Crumbs are notes people leave on the web,</strong> anchored to the passage they are about. Sign in with your Bluesky account to post, reply and follow.</p>
          <a className={styles.primary} href={ACCOUNT_HREF}>Sign in</a>
        </div>} />}
    </div>
  </main>;
}

/** The sticky top of the column: back arrow or title on the left, one control on the right. */
function Bar({ title, onBack, right, children }: { title: ReactNode; onBack?: () => void; right?: ReactNode; children?: ReactNode }) {
  return <header className={styles.top}>
    <div className={styles.bar}>
      {onBack && <button type="button" className={styles.back} aria-label="Back" title="Back" onClick={onBack}><ArrowLeft size={20} /></button>}
      <h1>{title}</h1>
      {right}
    </div>
    {children}
  </header>;
}

/** One crumb in the timeline: who, what they said, the passage it is about, and what you can do with it. */
function Crumb({ item, scope, signedIn, onRemoved, detail, onOpen, thread: line }: { item: FeedItem; scope: string; signedIn: boolean; onRemoved: () => void; detail?: boolean; onOpen?: () => void; /** Where it sits in a reply shown under the crumb it answers. */ thread?: "parent" | "child" }) {
  const [thread, setThread] = useState<AnnotationResponse | null>(null);
  const [text, setText] = useState("");
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  usePageLoading(busy);
  // Replies are crumbs on the same passage, in the same place this one lives.
  const audience = item.scope ?? (scope.startsWith("org:") || scope.startsWith("room:") ? scope : "public");
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
  const host = new URL(item.target.url).hostname.replace(/^www\./, "");

  // Anywhere on the row that is not itself a control opens the post, as on any timeline.
  const openable = !detail && onOpen ? {
    tabIndex: 0, "data-openable": true, "aria-label": `Crumb by ${nameOf(item.author)}`,
    onClick: (event: MouseEvent<HTMLElement>) => { if (!(event.target as HTMLElement).closest("button, a, textarea, input, form, details") && !window.getSelection()?.toString()) onOpen(); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" && event.target === event.currentTarget) onOpen(); },
  } : {};

  const [notesOpen, setNotesOpen] = useState(false);
  const [noteCount, setNoteCount] = useState(item.noteCount ?? 0);
  const name = nameOf(item.author);
  const report = () => { setReporting(true); if (detail) requestAnimationFrame(() => field.current?.focus()); };
  // Crumbs on the network are records; the ones kept on this machine are comments in their thread.
  const remove = () => void run(async () => { if (item.id.startsWith("at://")) await act({ action: "delete", id: item.id }); else await write("delete-comment", "", item.id); onRemoved(); });
  // Where a crumb lives is only worth saying when the tab does not say it already.
  const where = line !== "child" && item.audience !== "Public" && item.audience !== "Bluesky" && !scope.startsWith("org:") && !scope.startsWith("room:") ? item.audience : null;
  // A reply is about the crumb above it; only the crumb that started the thread carries the page.
  const reply = Boolean(item.parent);

  const form = signedIn ? <form className={styles.replyForm} onSubmit={submit}>
    <textarea ref={field} aria-label={reporting ? "Reason for reporting" : "Reply"} placeholder={reporting ? "What is wrong with it?" : "Write your reply"} rows={detail ? 2 : 1} maxLength={reporting ? 1000 : 4000} value={text} disabled={busy}
      onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && text.trim()) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
    {reporting && <button type="button" className={styles.secondary} onClick={() => { setReporting(false); setText(""); }}>Cancel</button>}
    <button type="submit" className={styles.primary} disabled={busy || !text.trim()}>{reporting ? "Report" : "Reply"}</button>
  </form> : <a className={styles.link} href={ACCOUNT_HREF}>Sign in to reply</a>;

  const post = <PostCard className={styles.crumb} data-crumb={item.id} data-detail={detail || undefined} data-thread={line} {...openable}
    context={where ? <><Lock size={12} strokeWidth={2.4} />{item.audience}</> : undefined}
    avatar={<Avatar person={item.author} size={42} />} name={name} handle={shortHandle(item.author.handle) || null}
    time={detail ? undefined : <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{ago(item.createdAt)}</time>}
    menu={<PostMenu label={`More for ${name}’s crumb`}>
      <PostMenuItem icon={<Link2 size={18} />} onClick={() => void navigator.clipboard?.writeText(item.url)}>Copy link to passage</PostMenuItem>
      {item.source && <PostMenuItem icon={<BookOpen size={18} />} onClick={() => void openSite(item.source!)}>Open the source</PostMenuItem>}
      {signedIn && !item.own && <PostMenuItem icon={<Flag size={18} />} onClick={report}>Report this crumb</PostMenuItem>}
      {item.own && <PostMenuItem icon={<Trash2 size={18} />} danger disabled={busy} onClick={remove}>Delete</PostMenuItem>}
    </PostMenu>}
    actions={<>
      <PostAction icon={<MessageCircle size={detail ? 20 : 18} />} count={!reply && count > 1 ? count - 1 : undefined} label={`Reply, ${count} ${count === 1 ? "crumb" : "crumbs"} on this passage`}
        onClick={() => { setReporting(false); if (detail) field.current?.focus(); else onOpen?.(); }} />
      {isPublic && <PostAction icon={<UsersRound size={detail ? 20 : 18} />} count={noteCount || undefined} aria-expanded={notesOpen} label={noteCount > 0 ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}` : "Add note"} onClick={() => setNotesOpen(value => !value)} />}
    </>}
    endActions={<PostAction icon={<ExternalLink size={detail ? 20 : 18} />} label="Open the page" onClick={() => void openSite(item.url)} />}
    after={<>
      {error && <Problem text={error} />}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!detail && reporting && form}
    </>}>
    {item.state && item.state !== "visible" && <p className={styles.state} data-state={item.state}>{item.state === "rejected" ? `Not shown${item.reason ? `: ${item.reason}` : ""}` : STATES[item.state] ?? "Hidden"}</p>}
    {item.comment && <p className={styles.comment}>{item.comment}</p>}
    {!reply && <button type="button" className={styles.source} onClick={() => void openSite(item.url)} title="Open the page at this passage">
      <strong>{item.title || host}</strong>
      {item.target.kind === "text" && item.target.quote && <q>{item.target.quote}</q>}
      <small><Globe2 size={12} />{host}</small>
    </button>}
    {isPublic && <CrumbNotes crumbId={item.id} note={item.note} count={item.noteCount} own={item.own} signedIn={signedIn} open={notesOpen} onCount={setNoteCount} />}
    {detail && <p className={styles.when}>{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</p>}
  </PostCard>;

  if (!detail) return post;
  return <>
    {post}
    <div className={styles.composer}>{form}</div>
    {replies.map(reply => <PostCard key={reply.id} className={styles.crumb}
      avatar={<Avatar person={{ did: reply.did ?? reply.id, handle: reply.handle ?? null, displayName: reply.author, avatar: reply.avatar ?? null }} size={42} />}
      name={shortHandle(reply.author) || "Someone"} handle={reply.handle ? shortHandle(reply.handle) : null}
      time={<time dateTime={reply.createdAt} title={new Date(reply.createdAt).toLocaleString()}>{ago(reply.createdAt)}</time>}>
      <p className={styles.comment}>{reply.body}</p>
    </PostCard>)}
    {thread && replies.length === 0 && <p className={styles.noReplies}>No replies yet</p>}
  </>;
}

/**
 * The feed as threads, newest first: a reply is shown under the crumb it
 * answers, and each thread appears once, by its newest crumb on the page.
 */
function threads(items: FeedItem[]): Array<[FeedItem, FeedItem?]> {
  const seen = new Set<string>();
  const out: Array<[FeedItem, FeedItem?]> = [];
  for (const item of items) {
    const root = item.parent;
    const key = root?.id ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root ? [root, item] : [item]);
  }
  return out;
}

const STATES: Record<string, string> = { pending: "Waiting for review", reported: "Hidden after reports", hidden: "Hidden by a moderator" };

function Feed({ status, fixedScope, title, onBack, right, intro, organizations = [], initialTab, initialOrg }: { status: Status; orgs: Org[]; fixedScope?: string; title?: ReactNode; onBack?: () => void; right?: ReactNode; intro?: ReactNode; organizations?: OrgFeed[]; initialTab?: "organizations"; initialOrg?: string }) {
  const [tab, setTab] = useState(fixedScope ?? initialTab ?? (status.signedIn ? "following" : "everyone"));
  const [org, setOrg] = useState(initialOrg ?? "");
  // The organization picked, else the first one there is; nothing to read until there is one.
  const chosenOrg = organizations.some(item => item.scope === org) ? org : organizations[0]?.scope ?? "";
  const scope = tab === "organizations" ? chosenOrg : tab;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [empty, setEmpty] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  usePageLoading(loading);
  const load = useCallback(async (more?: string | null) => {
    const id = ++request.current;
    if (!scope) { setItems([]); setBefore(null); setEmpty(tab === "organizations" ? "You are not in any organization yet" : ""); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const page = await view<{ items: FeedItem[]; before: string | null; empty?: string }>(`view=feed&scope=${encodeURIComponent(scope)}${more ? `&before=${encodeURIComponent(more)}` : ""}`);
      if (id !== request.current) return;
      setItems(previous => more ? [...previous, ...page.items] : page.items); setBefore(page.before); setEmpty(page.empty ?? "");
    } catch (error) { if (id === request.current) setError(message(error)); }
    finally { if (id === request.current) setLoading(false); }
  }, [scope, tab]);
  useEffect(() => { void load(); }, [load]);
  function choose(nextTab: string, nextOrg = org) {
    if (nextTab === tab && nextOrg === org) return;
    const nextScope = nextTab === "organizations" ? (organizations.some(item => item.scope === nextOrg) ? nextOrg : organizations[0]?.scope ?? "") : nextTab;
    if (nextScope !== scope) setItems([]);
    setTab(nextTab); setOrg(nextOrg);
    const query = nextTab === "organizations" ? `?tab=organizations${nextOrg ? `&org=${encodeURIComponent(nextOrg)}` : ""}` : "";
    window.history.replaceState(null, "", `/crumbs${query}`);
  }
  // A crumb left from another tab shows up when the reader comes back.
  useEffect(() => {
    if (!fixedScope) return;
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [fixedScope, load]);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const list = useRef<HTMLElement>(null);
  function open(item: FeedItem) { setSelected(item); requestAnimationFrame(() => list.current?.scrollIntoView({ block: "start" })); }
  function back() {
    const id = selected?.id;
    setSelected(null);
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-crumb]")].find(card => card.dataset.crumb === id)?.scrollIntoView({ block: "center" }));
  }
  const tabs: Array<[string, string]> = [...(status.signedIn ? [["following", "Following"]] as Array<[string, string]> : []), ["everyone", "Everyone"], ["organizations", "Organizations"]];
  // Inside an Organization room the room is the header.
  const header = title === undefined ? null : selected
    ? <Bar title="Crumb" onBack={back} />
    : <Bar title={title} onBack={onBack} right={right}>
      {!fixedScope && <nav className={styles.tabs} role="tablist" aria-label="Feeds">
        {tabs.map(([value, name]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => choose(value)}><span>{name}</span></button>)}
      </nav>}
      {!fixedScope && tab === "organizations" && organizations.length > 0 && <div className={styles.orgPicker} role="radiogroup" aria-label="Organization">
        {organizations.map(item => <button key={item.scope} type="button" role="radio" aria-checked={item.scope === chosenOrg} onClick={() => choose("organizations", item.scope)}>{item.name}</button>)}
      </div>}
    </Bar>;

  return <section aria-label="Feed" className={styles.timeline} ref={list}>
    {header}
    {selected && <Crumb key={selected.id} detail item={selected} scope={scope} signedIn={status.signedIn} onRemoved={() => { setItems(previous => previous.filter(other => other.id !== selected.id)); setSelected(null); }} />}
    <div hidden={Boolean(selected)}>
      {intro}
      {error && <Problem text={error} retry={() => void load()} />}
      <div className={styles.feed} aria-live="polite">
        {threads(items).map(([first, latest]) => {
          const remove = (id: string) => () => setItems(previous => previous.filter(other => other.id !== id));
          // Either row opens the whole thread: the crumb that started it, with its replies below.
          return latest
            ? <div key={latest.id} className={styles.slice}>
              <Crumb item={first} thread="parent" scope={scope} signedIn={status.signedIn} onOpen={() => open(first)} onRemoved={remove(first.id)} />
              <Crumb item={latest} thread="child" scope={scope} signedIn={status.signedIn} onOpen={() => open(first)} onRemoved={remove(latest.id)} />
            </div>
            : <Crumb key={first.id} item={first} scope={scope} signedIn={status.signedIn} onOpen={() => open(first)} onRemoved={remove(first.id)} />;
        })}
      </div>
      {!loading && !error && items.length === 0 && <div className={styles.emptyState}>
        <CrumbsIcon size={34} strokeWidth={1.2} />
        <h2>{empty || "No crumbs yet"}</h2>
        <p>{tab === "organizations" ? (scope ? "Select a passage on any page in the browser, choose Leave a crumb, then pick this organization." : "Create or join one on the Organization page.")
          : "Select a passage on any page in the browser and choose Leave a crumb."}</p>
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
      <div className={styles.accountRow}>
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
  const [state, setState] = useState<Awaited<ReturnType<typeof loadAccount>> | null>(null);
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
    {state?.status.signedIn && <div className={styles.orgSection}>
      <h3>Organizations</h3>
      <p className={styles.hint}>Encrypted groups whose crumbs only members can read. Each one shows up as a feed on the Crumbs page.</p>
      <Organizations status={state.status} orgs={state.orgs} localOrgs={state.local} refresh={refresh} />
    </div>}
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
          <Avatar person={member} size={30} /><span><strong>{nameOf(member)}{member.role === "admin" && <em>Admin</em>}{member.waitingForKey && <em data-tone="waiting">Waiting</em>}</strong><small>@{shortHandle(member.handle) || member.did}</small></span>
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
