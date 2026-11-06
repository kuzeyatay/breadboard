"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_NOTE_ID, validNoteId, validNoteSummary, validTerminalNote, type TerminalNote, type TerminalNoteSummary } from "@/lib/terminal-note";

export function useTerminalNotes(ownerKey: string) {
  const key = `breadboard:terminal-notes:v1:${ownerKey.trim().toLowerCase()}`;
  const endpoint = `/api/profile/terminal-note?${new URLSearchParams({ownerKey})}`;
  const [notes, setNotes] = useState<TerminalNoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_NOTE_ID);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = useRef<string | null>(DEFAULT_NOTE_ID), live = useRef(false), initialized = useRef(false);
  const request = useRef(0), working = useRef(false), pendingCreate = useRef<string | null>(null);
  const select = useCallback((id: string | null) => {
    active.current = id;
    setSelectedId(id);
    try { if (id) sessionStorage.setItem(key + ":selected", id); else sessionStorage.removeItem(key + ":selected"); } catch { /* Selection still works. */ }
  }, [key]);
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const response = await fetch(endpoint + "&list=1", {cache: "no-store", signal: AbortSignal.timeout(10_000)});
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.notes) || !data.notes.every(validNoteSummary)) throw new Error("Couldn’t load your notes. Try again.");
      if (!live.current || sequence !== request.current) return;
      setNotes(data.notes);
      if (!initialized.current) {
        initialized.current = true;
        if (!data.notes.some((note: TerminalNoteSummary) => note.id === active.current)) select(data.notes[0]?.id ?? null);
      }
      setLoaded(true);
    } catch (failure) { if (live.current && sequence === request.current) setError((failure as Error).message); }
  }, [endpoint, select]);
  const announce = () => {
    void refresh();
    try { const channel = new BroadcastChannel(key); channel.postMessage("changed"); channel.close(); } catch { /* Focus refresh is available too. */ }
  };
  useEffect(() => {
    live.current = true;
    try {
      const id = sessionStorage.getItem(key + ":selected");
      if (validNoteId(id)) select(id);
    } catch { /* Default selection is available. */ }
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 50); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(key);
    if (channel) channel.onmessage = sync;
    window.addEventListener(key, sync);
    window.addEventListener("focus", sync);
    return () => { live.current = false; ++request.current; clearTimeout(timer); channel?.close(); window.removeEventListener(key, sync); window.removeEventListener("focus", sync); };
  }, [key, refresh, select]);

  async function create(text: Pick<TerminalNote, "title" | "body"> = {title: "", body: ""}) {
    if (working.current) return false;
    working.current = true; setBusy(true); setError("");
    const id = pendingCreate.current ?? crypto.randomUUID();
    pendingCreate.current = id;
    try {
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id, ...text}), signal: AbortSignal.timeout(10_000)});
      const data = await response.json();
      if (!response.ok || !validTerminalNote(data.note)) throw new Error("Couldn’t create the note. Try New note again.");
      if (!live.current) return false;
      pendingCreate.current = null;
      initialized.current = true;
      setNotes(current => [{id, title: data.note.title, preview: data.note.body.slice(0, 100), revision: data.note.revision, updatedAt: data.note.updatedAt}, ...current.filter(note => note.id !== id)]);
      select(id); announce();
      return true;
    } catch (failure) { if (live.current) setError((failure as Error).message); return false; }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function remove(revision: number) {
    const id = active.current;
    if (!id || working.current) return false;
    working.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint + "&" + new URLSearchParams({id}), {method: "DELETE", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({revision}), signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw new Error(response.status === 409 ? "This note changed in another tab. Review the latest version before deleting." : "Couldn’t delete the note. Try again.");
      if (!live.current) return false;
      const remaining = notes.filter(note => note.id !== id);
      setNotes(remaining); select(remaining[0]?.id ?? null); announce();
      return true;
    } catch (failure) { if (live.current) setError((failure as Error).message); return false; }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  return {notes, selectedId, loaded, busy, error, select, create, remove, refresh, clearError: () => setError("")};
}
