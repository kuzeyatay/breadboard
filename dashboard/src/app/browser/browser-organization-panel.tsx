"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ExternalLink, Flag, Globe2, MessageSquare, MoreHorizontal, X } from "lucide-react";
import { usePageLoading } from "@/app/components/use-page-loading";
import { annotationPageUrl, annotationTargetKey, type AnnotationResponse, type BrowserAnnotationTarget } from "@/lib/browser-annotations";
import type { DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./browser-organization-panel.module.css";

type Send = (command: DesktopTabsCommand) => Promise<boolean>;
type Rooms = { organizations: Array<{ id: number; name: string }>; rooms: Array<{ publicId: string; organizationId: number; name: string; archived: boolean }> };
const empty: AnnotationResponse = { threads: [], thread: null, messages: [], flags: [] };
function label(target: BrowserAnnotationTarget) {
  if (target.kind === "text") return target.quote ?? "Selected text";
  if (target.kind === "video") return `Video${target.time === undefined ? "" : ` · ${Math.floor(target.time / 60)}:${String(target.time % 60).padStart(2, "0")}`}`;
  return target.kind === "image" ? "Selected image" : "This page";
}
async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? "Couldn’t load this discussion. Try again.");
  return data as T;
}

export default function BrowserOrganizationPanel({ url, title, target, send, onClose }: {
  url: string; title: string; target?: BrowserAnnotationTarget; send: Send; onClose: () => void;
}) {
  const [rooms, setRooms] = useState<Rooms>({ organizations: [], rooms: [] });
  const [scope, setScope] = useState<string | null>(null);
  const [view, setView] = useState<{ tab: "page" | "rooms"; selectionKey: string }>({ tab: "page", selectionKey: "" });
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const selectionKey = target ? annotationTargetKey(target) + target.url : "";
  const tab = view.selectionKey === selectionKey ? view.tab : "page";
  function setTab(tab: "page" | "rooms") { setView({ tab, selectionKey }); }
  usePageLoading(scope === null && !error);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/buzz/rooms", { signal: controller.signal, cache: "no-store" }).then(responseJson<Rooms>).then(data => {
      setRooms(data);
      setScope(previous => previous ?? (data.rooms.find(room => !room.archived) ? `room:${data.rooms.find(room => !room.archived)!.publicId}` : "public"));
      setError("");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [retry]);
  const pageUrl = annotationPageUrl(url);
  const selected = target && annotationPageUrl(target.url) === pageUrl ? target : { kind: "page" as const, url: pageUrl ?? "", title };
  const room = rooms.rooms.find(room => `room:${room.publicId}` === scope);
  const audience = scope === "public" ? "General public" : room?.name ?? "Organization";
  return <aside className={styles.panel} aria-label="Organization" onKeyDown={event => {
    if (event.key !== "Escape") return;
    const menu = event.currentTarget.querySelector<HTMLDetailsElement>("details[open]");
    if (menu) menu.open = false; else onClose();
    event.stopPropagation();
  }} tabIndex={-1}>
    <header className={styles.header}><h2>Organization</h2><button type="button" className={styles.icon} aria-label="Close Organization" onClick={onClose}><X size={17} /></button></header>
    <div className={styles.audience}>
      <select aria-label="Discussion audience" value={scope ?? ""} disabled={scope === null} onChange={event => setScope(event.target.value)}>
        {scope === null && <option value="">Choose an audience</option>}
        <option value="public">General public</option>
        {rooms.organizations.map(org => <optgroup key={org.id} label={org.name}>{rooms.rooms.filter(room => room.organizationId === org.id && !room.archived).map(room => <option key={room.publicId} value={`room:${room.publicId}`}>{room.name}</option>)}</optgroup>)}
      </select>
      <p>{scope === "public" ? "Everyone on this Breadboard server" : room ? rooms.organizations.find(org => org.id === room.organizationId)?.name : "Your shared conversations"}</p>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Organization views">
      <button type="button" role="tab" aria-selected={tab === "page"} onClick={() => setTab("page")}>This page</button>
      <button type="button" role="tab" aria-selected={tab === "rooms"} onClick={() => setTab("rooms")}>Rooms</button>
    </div>
    {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</button></p>}
    {tab === "rooms" ? <div className={styles.scroll} role="tabpanel" aria-label="Rooms">
      <button type="button" className={styles.room} onClick={() => { setScope("public"); setTab("page"); }}><Globe2 size={16} /><span>General public<small>Conversations about this page</small></span></button>
      {rooms.organizations.map(org => <section className={styles.roomGroup} key={org.id}><h3>{org.name}</h3>{rooms.rooms.filter(room => room.organizationId === org.id && !room.archived).map(room => <div className={styles.roomRow} key={room.publicId}>
        <button type="button" className={styles.room} onClick={() => { setScope(`room:${room.publicId}`); setTab("page"); }}><MessageSquare size={15} /><span>{room.name}</span></button>
        <a className={styles.icon} href={`/buzz?room=${encodeURIComponent(room.publicId)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${room.name} in Organization`}><ExternalLink size={14} /></a>
      </div>)}</section>)}
      <a className={styles.textLink} href="/buzz" target="_blank" rel="noopener noreferrer">Open Organization <ExternalLink size={13} /></a>
    </div> : pageUrl && scope ? <Discussion key={`${scope}:${pageUrl}:${annotationTargetKey(selected)}`} scope={scope} audience={audience} target={selected} send={send} /> : <div className={styles.empty}>{scope && "Open a web page to start a conversation."}</div>}
  </aside>;
}

function Discussion({ scope, audience, target: initialTarget, send }: { scope: string; audience: string; target: BrowserAnnotationTarget; send: Send }) {
  // The parent keys this view by page, audience and selection. Keep the anchor
  // stable across native state broadcasts, which include fresh object copies.
  const [target] = useState(initialTarget);
  const [data, setData] = useState<AnnotationResponse>(empty);
  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [mode, setMode] = useState<"comment" | "flag">("comment");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const revision = useRef(0);
  const command = useRef(send); command.current = send;
  const operation = useRef({ signature: "", id: "" });
  const input = useRef<HTMLTextAreaElement>(null);
  usePageLoading(!loaded && !error);
  useEffect(() => {
    alive.current = true;
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
        if (!controller.signal.aborted && version === revision.current) {
          setData(result); setLoaded(true); setError("");
          void command.current({ type: "browser-organization-markers", items: result.threads.map(thread => ({ id: thread.id, target: thread.target })) });
        }
      } catch (error) {
        if (!controller.signal.aborted && version === revision.current) { setError(error instanceof Error ? error.message : "Couldn’t load comments."); setLoaded(true); setData(empty); void command.current({ type: "browser-organization-markers", items: [] }); }
      } finally { running = false; }
    }
    void command.current({ type: "browser-organization-markers", items: [] });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { alive.current = false; controller.abort(); clearInterval(timer); void command.current({ type: "browser-organization-markers", items: [] }); };
  }, [scope, target, retry]);

  async function write(action: "comment" | "flag" | "withdraw-flag" | "delete-comment", messageId?: string) {
    if (busy) return;
    const payload = { scope, target, action, body, source: showSource ? source : "", messageId };
    const signature = JSON.stringify(payload);
    if (operation.current.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    revision.current++; setBusy(true); setError("");
    try {
      const result = await fetch("/api/browser/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, operationId: operation.current.id }) }).then(responseJson<AnnotationResponse>);
      if (!alive.current) return;
      revision.current++; setData(result); setBody(""); setSource(""); setShowSource(false); setMode("comment"); operation.current = { signature: "", id: "" };
      void command.current({ type: "browser-organization-markers", items: result.threads.map(thread => ({ id: thread.id, target: thread.target })) });
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Couldn’t save your comment. Try again."); }
    finally { if (alive.current) setBusy(false); }
  }
  function choose(next: BrowserAnnotationTarget) { void send({ type: "browser-organization-target", target: next }); }
  return <div className={styles.discussion} role="tabpanel" aria-label="This page">
    <div className={styles.scroll}>
      <div className={styles.pageTitle}><span>{target.title || new URL(target.url).hostname}</span><small>{new URL(target.url).hostname}</small></div>
      {target.kind !== "page" && <div className={styles.selection}>
        <button className={styles.textLink} type="button" onClick={() => choose({ kind: "page", url: target.url, title: target.title })}><ChevronLeft size={13} />This page</button>
        <blockquote>{label(target)}</blockquote>
      </div>}
      {target.kind === "page" && data.threads.filter(thread => thread.target.kind !== "page").map(thread => <button type="button" key={thread.id} className={styles.thread} onClick={() => choose(thread.target)}><span>{label(thread.target)}</span><small>{thread.count} {thread.count === 1 ? "comment" : "comments"}</small></button>)}
      {loaded && !data.messages.length && !data.flags.length && <div className={styles.empty}><MessageSquare size={22} strokeWidth={1.4} /><p>Start a conversation</p><small>{target.kind === "page" ? "Comment on this page, or select text and choose Comment. Right-click an image or video to discuss it." : "Add a thought about this selection."}</small></div>}
      <div aria-live="polite" aria-relevant="additions text">{data.messages.map(message => <article className={styles.message} key={message.id}>
        <div className={styles.byline}><strong>{message.author}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt.includes("T") ? message.createdAt : message.createdAt.replace(" ", "T") + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
          {message.own && <details className={styles.menu}><summary aria-label="Comment options"><MoreHorizontal size={15} /></summary><div><button disabled={busy} type="button" onClick={() => void write("delete-comment", message.id)}>Delete comment</button></div></details>}
        </div><p>{message.body}</p>{message.source && <a href={message.source} target="_blank" rel="noopener noreferrer" className={styles.textLink}>Source <ExternalLink size={12} /></a>}
      </article>)}</div>
      {data.flags.length > 0 && <details className={styles.flags}><summary><Flag size={13} />{data.flags.length} {data.flags.length === 1 ? "flag" : "flags"}</summary>{data.flags.map(flag => <div key={flag.id}><strong>{flag.author}</strong><p>{flag.reason}</p>{flag.own && <button type="button" disabled={busy} onClick={() => void write("withdraw-flag")}>Remove my flag</button>}</div>)}</details>}
      {data.thread?.organizationHref && <a className={styles.textLink} href={data.thread.organizationHref} target="_blank" rel="noopener noreferrer">Open thread in Organization <ExternalLink size={12} /></a>}
    </div>
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry loading</button></p>}
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void write(mode); }}>
      {mode === "flag" && <div className={styles.mode}><span><Flag size={13} />Flag this {target.kind === "page" ? "page" : "selection"}</span><button type="button" aria-label="Cancel flag" onClick={() => setMode("comment")}><X size={14} /></button></div>}
      <textarea ref={input} aria-label={mode === "flag" ? "Reason for flagging" : "Comment"} placeholder={mode === "flag" ? "What should others know?" : "Add a comment…"} value={body} onChange={event => setBody(event.target.value)} rows={3} maxLength={4000} disabled={busy} />
      {showSource && <input type="url" aria-label="Source link" placeholder="https://source…" value={source} onChange={event => setSource(event.target.value)} disabled={busy} />}
      <footer><span className={styles.postingTo}>{mode === "flag" ? "Flag visible to " : "Post to "}{audience}</span><details className={styles.menu}><summary aria-label="More comment options"><MoreHorizontal size={18} /></summary><div>
        <button type="button" onClick={event => { setShowSource(value => !value); event.currentTarget.closest("details")!.open = false; }}>{showSource ? "Remove source" : "Add a source"}</button>
        <button type="button" onClick={event => { setMode(mode === "flag" ? "comment" : "flag"); event.currentTarget.closest("details")!.open = false; input.current?.focus(); }}>{mode === "flag" ? "Write a comment" : "Flag this content"}</button>
      </div></details><button className={styles.submit} type="submit" disabled={busy || !loaded || !body.trim()} aria-label={mode === "flag" ? "Submit flag" : "Post comment"}><ArrowUp size={16} /></button></footer>
    </form>
  </div>;
}
