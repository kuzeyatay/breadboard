"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, UsersRound } from "lucide-react";
import { shortHandle } from "@/lib/crumbs/handle";
import styles from "./crumb-notes.module.css";

interface Note { uri: string; handle: string | null; displayName: string | null; body: string; source: string | null; helpful: number; unhelpful: number; shown: boolean; myRating: boolean | null; own: boolean }
interface ShownNote { uri: string; body: string; source: string | null }

async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
  return data as T;
}
const act = (body: Record<string, unknown>) => fetch("/api/crumbs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(read<{ notes: Note[] }>);

/**
 * Community notes on one public crumb: context that readers add and rate.
 * The note people found helpful is shown on the crumb; the rest wait behind a
 * small control where anyone signed in can rate them or write their own.
 */
export default function CrumbNotes({ crumbId, note, count = 0, own, signedIn, open: openFromCard, onCount }: {
  crumbId: string; note?: ShownNote; count?: number; own: boolean; signedIn: boolean;
  /** Given by a card whose own action row opens the notes; the built-in control is then left out. */
  open?: boolean; onCount?: (count: number) => void;
}) {
  const [openHere, setOpen] = useState(false);
  const open = openFromCard ?? openHere;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = notes ? notes.length : count;
  const shown = notes ? notes.filter(item => item.shown).sort((a, b) => (b.helpful - b.unhelpful) - (a.helpful - a.unhelpful))[0] ?? null : note ?? null;
  async function run(work: () => Promise<{ notes: Note[] }>, after?: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { setNotes((await work()).notes); after?.(); } catch (error) { setError(error instanceof Error ? error.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once, the first time the notes are opened
  useEffect(() => { if (open && !notes) void run(() => fetch(`/api/crumbs?view=notes&id=${encodeURIComponent(crumbId)}`, { cache: "no-store" }).then(read<{ notes: Note[] }>)); }, [open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the card only needs the new number
  useEffect(() => { if (notes) onCount?.(notes.length); }, [notes]);
  const toggle = () => setOpen(value => !value);
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => act({ action: "note-add", id: crumbId, body, source }), () => { setBody(""); setSource(""); });
  }
  const mine = notes?.some(item => item.own) ?? false;

  return <div className={styles.notes}>
    {shown && <aside className={styles.shown} aria-label="Community note">
      <strong><UsersRound size={13} />Readers added context</strong>
      <p>{shown.body}</p>
      {shown.source && <a href={shown.source} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={11} /></a>}
    </aside>}
    {openFromCard === undefined && <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>{total > 0 ? `${total} ${total === 1 ? "note" : "notes"}` : "Add note"}</button>}
    {open && <div className={styles.panel}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notes?.map(item => <article key={item.uri} className={styles.note}>
        <header><strong>{item.displayName || shortHandle(item.handle) || "Someone"}</strong><span>{item.shown ? "Shown" : "Needs more ratings"}</span></header>
        <p>{item.body}</p>
        {item.source && <a href={item.source} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={11} /></a>}
        {item.own ? <div className={styles.rate}><button type="button" disabled={busy} onClick={() => void run(() => act({ action: "note-delete", id: crumbId, note: item.uri }))}>Delete</button></div>
          : signedIn && <div className={styles.rate} role="group" aria-label="Rate this note">
            <button type="button" aria-pressed={item.myRating === true} disabled={busy} onClick={() => void run(() => act({ action: "note-rate", id: crumbId, note: item.uri, helpful: item.myRating === true ? null : true }))}>Helpful</button>
            <button type="button" aria-pressed={item.myRating === false} disabled={busy} onClick={() => void run(() => act({ action: "note-rate", id: crumbId, note: item.uri, helpful: item.myRating === false ? null : false }))}>Not helpful</button>
          </div>}
      </article>)}
      {notes && notes.length === 0 && !signedIn && <p className={styles.hint}>No notes yet</p>}
      {signedIn && !own && !mine && notes && <form className={styles.form} onSubmit={submit}>
        <textarea aria-label="Community note" placeholder="Add context others should know" rows={2} maxLength={2000} value={body} onChange={event => setBody(event.target.value)} disabled={busy} />
        <input type="url" aria-label="Note source" placeholder="Source link" value={source} onChange={event => setSource(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || !body.trim()}>Post note</button>
      </form>}
      {!signedIn && <a className={styles.signIn} href="/settings#crumbs" target="_blank" rel="noopener noreferrer">Sign in to add or rate notes</a>}
    </div>}
  </div>;
}
