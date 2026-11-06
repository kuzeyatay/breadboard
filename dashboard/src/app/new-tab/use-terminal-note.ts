"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_NOTE_ID, EMPTY_TERMINAL_NOTE, validTerminalNote, type TerminalNote } from "@/lib/terminal-note";

type Status = "loading" | "saving" | "saved" | "error" | "conflict" | "deleted";
interface View { id: string | null; note: TerminalNote; status: Status; conflict: TerminalNote | null; backedUp: boolean }
interface Controls {
  edit: (field: "title" | "body", value: string) => void;
  flush: () => void;
  retry: () => void;
  resolve: (keepDraft: boolean) => void;
}

/** A quick note is stored in the account database, not just the current origin.
 * A local draft also survives a failed request or reload before autosave. */
export function useTerminalNote(ownerKey: string, noteId: string | null = DEFAULT_NOTE_ID) {
  const [view, setView] = useState<View>({id: null, note: EMPTY_TERMINAL_NOTE, status: "loading", conflict: null, backedUp: false});
  const controls = useRef<Controls | null>(null);
  const generations = useRef(new Map<string, symbol>());
  useEffect(() => {
    if (!noteId) return;
    const collectionKey = `breadboard:terminal-notes:v1:${ownerKey.trim().toLowerCase()}`;
    const key = `breadboard:terminal-note:v1:${ownerKey.trim().toLowerCase()}` + (noteId === DEFAULT_NOTE_ID ? "" : ":" + noteId);
    const generation = Symbol(noteId);
    const owners = generations.current;
    owners.set(key, generation);
    let draftKey: string | null = null;
    try {
      let tab = sessionStorage.getItem("breadboard:terminal-note-tab");
      if (!tab) { tab = crypto.randomUUID(); sessionStorage.setItem("breadboard:terminal-note-tab", tab); }
      draftKey = key + ":draft:" + tab;
    } catch { /* An unavailable draft store must not prevent server saves. */ }
    const endpoint = `/api/profile/terminal-note?${new URLSearchParams({ownerKey, id: noteId})}`;
    let note = {...EMPTY_TERMINAL_NOTE}, dirty = false, hydrated = false, busy = false, live = true;
    let status: Status = "loading", conflict: TerminalNote | null = null, backedUp = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading: Promise<void> | null = null;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(key);
    try {
      const cached = JSON.parse((draftKey && localStorage.getItem(draftKey)) || localStorage.getItem(key) || "null");
      if (validTerminalNote(cached?.note)) { note = cached.note; dirty = cached.dirty === true; backedUp = true; }
    } catch { /* Server hydration remains available if local storage is blocked. */ }
    const announce = () => {
      window.dispatchEvent(new CustomEvent(collectionKey, {detail: noteId}));
      try { const updates = new BroadcastChannel(collectionKey); updates.postMessage(noteId); updates.close(); } catch { /* Optional cross-tab updates. */ }
    };
    const show = () => { if (live) setView({id: noteId, note, status, conflict, backedUp}); };
    const backup = () => {
      // A save from an earlier visit must not replace or remove a newer local draft.
      if (owners.get(key) !== generation) return;
      try {
        if (dirty) {
          if (!draftKey) throw new Error("No draft store");
          localStorage.setItem(draftKey, JSON.stringify({note, dirty}));
        } else {
          const cached = JSON.parse(localStorage.getItem(key) ?? "null");
          if (!validTerminalNote(cached?.note) || cached.note.revision <= note.revision) {
            localStorage.setItem(key, JSON.stringify({note, dirty}));
          }
          if (draftKey) localStorage.removeItem(draftKey);
        }
        backedUp = true;
      }
      catch { backedUp = false; }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (live && dirty && hydrated && !conflict) timer = setTimeout(() => { void persist(); }, 400);
    };
    async function persist() {
      clearTimeout(timer);
      if (!dirty || !hydrated || busy || conflict || status === "deleted" || owners.get(key) !== generation) return;
      busy = true;
      status = "saving";
      const submitted = note;
      show();
      try {
        const body = JSON.stringify(submitted);
        const response = await fetch(endpoint, {method: "PATCH", headers: {"Content-Type": "application/json"}, body,
          keepalive: new TextEncoder().encode(body).length < 60_000, signal: AbortSignal.timeout(10_000)});
        const payload = await response.json();
        if (response.status === 404) {
          status = "deleted";
        } else if (response.status === 409 && validTerminalNote(payload.note)) {
          conflict = payload.note;
          status = "conflict";
        } else {
          if (!response.ok || !validTerminalNote(payload.note)) throw new Error("Save failed");
          dirty = note.title !== submitted.title || note.body !== submitted.body;
          note = {...(dirty ? note : payload.note), revision: payload.note.revision, updatedAt: payload.note.updatedAt};
          status = dirty ? "saving" : "saved";
          announce();
          try { channel?.postMessage(payload.note); } catch { /* Page may have closed. */ }
        }
      } catch { status = "error"; }
      finally {
        busy = false;
        backup();
        show();
        if (dirty && status === "saving") { if (live) schedule(); else void persist(); }
      }
    }
    async function refresh() {
      if (busy || reading) return reading;
      reading = (async () => {
        try {
          const response = await fetch(endpoint, {cache: "no-store", signal: AbortSignal.timeout(10_000)});
          const payload = await response.json();
          if (response.status === 404) { status = "deleted"; return; }
          if (!response.ok || !validTerminalNote(payload.note)) throw new Error("Read failed");
          if (!live) return;
          const saved: TerminalNote = payload.note;
          if (saved.revision < note.revision) return;
          hydrated = true;
          if (dirty && (note.title !== saved.title || note.body !== saved.body)) {
            if (saved.revision !== note.revision) { conflict = saved; status = "conflict"; }
            else { status = "saving"; conflict = null; schedule(); }
          } else { note = saved; dirty = false; conflict = null; status = "saved"; }
          backup();
        } catch { if (live) status = "error"; }
        finally { reading = null; show(); }
      })();
      return reading;
    }
    const sync = () => { if (document.visibilityState !== "hidden") void refresh(); };
    if (channel) channel.onmessage = event => {
      if (validTerminalNote(event.data) && event.data.revision > note.revision) sync();
    };
    const collection = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(collectionKey);
    const changed = (id: unknown) => { if (id === noteId || id === "changed") sync(); };
    if (collection) collection.onmessage = event => changed(event.data);
    const localChange = (event: Event) => changed((event as CustomEvent).detail);
    window.addEventListener(collectionKey, localChange);
    const flush = () => { backup(); void persist(); };
    controls.current = {
      edit(field, value) {
        note = {...note, [field]: value};
        dirty = true;
        status = conflict ? "conflict" : hydrated ? "saving" : status === "error" ? "error" : "loading";
        backup();
        show();
        schedule();
      },
      flush,
      retry: () => { if (!hydrated || !dirty) void refresh(); else void persist(); },
      resolve(keepDraft) {
        if (!conflict) return;
        note = keepDraft ? {...note, revision: conflict.revision} : conflict;
        conflict = null;
        dirty = keepDraft;
        status = dirty ? "saving" : "saved";
        backup(); show();
        if (dirty) void persist();
      },
    };
    show();
    void refresh();
    window.addEventListener("focus", sync);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", sync);
    return () => {
      flush();
      live = false;
      clearTimeout(timer);
      controls.current = null;
      channel?.close();
      collection?.close();
      window.removeEventListener(collectionKey, localChange);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ownerKey, noteId]);
  const current = view.id === noteId ? view : {id: noteId, note: EMPTY_TERMINAL_NOTE, status: "loading" as const, conflict: null, backedUp: false};
  return {...current, edit: (field: "title" | "body", value: string) => controls.current?.edit(field, value),
    flush: () => controls.current?.flush(), retry: () => controls.current?.retry(), resolve: (keepDraft: boolean) => controls.current?.resolve(keepDraft)};
}
