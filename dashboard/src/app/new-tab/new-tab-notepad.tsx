"use client";

import { Check, List, Trash2, GripHorizontal, Maximize2, Minimize2, Minus, Plus, StickyNote } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type RefObject } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTerminalNotes } from "./use-terminal-notes";
import { BrowserSketchOutline } from "@/app/browser/browser-home-widgets";
import { NOTE_BODY_LIMIT, NOTE_TITLE_LIMIT } from "@/lib/terminal-note";
import { useNotepadPosition } from "./use-notepad-position";
import { useTerminalNote } from "./use-terminal-note";
import styles from "./new-tab-notepad.module.css";

const NOTE_IMAGE_RE = /!\[[^\]]*\]\((\/api\/profile\/terminal-note\/image\?id=[a-f0-9]{32})\)/g;

export default function NewTabNotepad({ ownerKey, topAnchorRef }: { ownerKey: string; topAnchorRef?: RefObject<HTMLElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const { panelRef, ready, dragging, collapsed, enlarged, handleProps, open, toggleCollapsed, toggleEnlarged } = useNotepadPosition(ownerKey);
  const notes = useTerminalNotes(ownerKey);
  const note = useTerminalNote(ownerKey, notes.selectedId);
  const [menuOpen, setMenuOpen] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null), focusEditor = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null), zoomRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState<string | null>(null), [pasteError, setPasteError] = useState("");
  useEffect(() => { if (zoom) zoomRef.current?.showModal(); }, [zoom]);
  const images = [...note.note.body.matchAll(NOTE_IMAGE_RE)].map(match => match[1]);
  // Ctrl+V of an image uploads it and drops a ![image](url) marker at the cursor.
  const pasteImage = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...event.clipboardData.files].find(item => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault(); setPasteError("");
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    try {
      const response = await fetch("/api/profile/terminal-note/image", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.url !== "string") throw new Error(data.error || "Couldn’t paste that image.");
      const body = editorRef.current?.value ?? note.note.body, marker = `![image](${data.url})`;
      const next = body.slice(0, start) + marker + body.slice(end);
      if (next.length > NOTE_BODY_LIMIT) throw new Error("This note is full.");
      note.edit("body", next);
    } catch (error) { setPasteError(error instanceof Error ? error.message : "Couldn’t paste that image."); }
  };
  useEffect(() => {
    if (focusEditor.current && !menuOpen && !collapsed && note.status !== "loading") {
      focusEditor.current = false;
      titleRef.current?.focus();
    }
  }, [menuOpen, collapsed, note.status, notes.selectedId]);
  // Enlarging always lands on the most recently edited note (the list is sorted
  // newest-first). Unsaved typing in the open note makes it the newest already.
  const { refresh, select } = notes, noteStatus = useRef(note.status);
  noteStatus.current = note.status;
  useEffect(() => {
    if (!enlarged) return;
    void refresh().then(list => {
      const latest = list?.[0]?.id;
      if (latest && noteStatus.current === "saved") select(latest);
    });
  }, [enlarged, refresh, select]);
  const showNote = (id: string) => {
    note.flush(); notes.select(id); open(); setMenuOpen(false); focusEditor.current = true;
  };
  const createNote = async (copy = false) => {
    note.flush();
    if (await notes.create(copy ? note.note : undefined)) { open(); setMenuOpen(false); focusEditor.current = true; }
  };
  const headingId = useId(), contentId = useId();

  useLayoutEffect(() => {
    const layer = viewport.current, anchor = topAnchorRef?.current;
    if (!layer || !anchor) return;
    const align = () => {
      // Fixed-position coordinates also work inside a transformed split pane.
      const origin = layer.getBoundingClientRect().top - (parseFloat(getComputedStyle(layer).top) || 0);
      layer.style.top = `${Math.max(0, anchor.getBoundingClientRect().bottom - origin) + 8}px`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(anchor);
    window.addEventListener("resize", align);
    return () => { observer.disconnect(); window.removeEventListener("resize", align); };
  }, [topAnchorRef]);

  const status = note.status === "loading" ? "Opening your note…" : note.status === "saving" ? "Saving…" : "All changes saved";
  return <div ref={viewport} className={styles.viewport} data-terminal-notepad-layer>
    <aside ref={panelRef} aria-labelledby={headingId} className={styles.notepad}
      data-terminal-notepad data-ready={ready} data-dragging={dragging} data-collapsed={collapsed} data-enlarged={enlarged}>
      <BrowserSketchOutline targetRef={panelRef} index={4} />
      <header className={styles.header}>
        <button type="button" className={styles.handle} {...handleProps} aria-label="Move notepad" title="Drag to move · Arrow keys to reposition">
          <GripHorizontal size={16} aria-hidden="true" />
          <StickyNote className={styles.noteIcon} size={17} aria-hidden="true" />
          <span id={headingId}>Notes</span>
        </button>
        <Menu.Root open={menuOpen} onOpenChange={value => { setMenuOpen(value); setConfirmDelete(false); if (value) { notes.clearError(); void notes.refresh(); } }} modal={false}>
          <Menu.Trigger asChild><button type="button" className={styles.iconButton} aria-label="Notes menu" title="Your notes"><List size={17} aria-hidden="true" /></button></Menu.Trigger>
          <Menu.Portal container={viewport.current}>
            <Menu.Content className={styles.menu} align="start" sideOffset={8} collisionPadding={16}
              onCloseAutoFocus={event => { if (focusEditor.current) event.preventDefault(); }}>
              <Menu.Label className={styles.menuLabel}>Your notes</Menu.Label>
              <Menu.Item className={styles.menuAction} disabled={notes.busy} onSelect={event => { event.preventDefault(); void createNote(); }}>
                <Plus size={16} aria-hidden="true" />{notes.busy ? "Please wait…" : "New note"}
              </Menu.Item>
              <Menu.Separator className={styles.menuSeparator} />
              <div className={styles.noteList}>
                {notes.notes.map(item => <Menu.Item key={item.id} className={styles.noteItem} disabled={notes.busy} onSelect={() => showNote(item.id)}>
                  <StickyNote size={15} aria-hidden="true" />
                  <span><strong>{item.id === notes.selectedId ? note.note.title || "Untitled note" : item.title || "Untitled note"}</strong>
                    <small>{(item.id === notes.selectedId ? note.note.body : item.preview).trim().replace(/\s+/g, " ") || "No text yet"}</small></span>
                  {item.id === notes.selectedId && <Check size={15} aria-label="Selected" />}
                </Menu.Item>)}
              </div>
              {notes.loaded && !notes.notes.length && <p className={styles.menuHint}>No notes yet. Start a new one.</p>}
              {!notes.loaded && !notes.error && <p className={styles.menuHint}>Loading notes…</p>}
              {notes.selectedId && <>
                <Menu.Separator className={styles.menuSeparator} />
                {confirmDelete ? <>
                  <Menu.Label className={styles.menuHint}>Delete this note? This cannot be undone.</Menu.Label>
                  <Menu.Item className={styles.menuAction} disabled={notes.busy || note.status !== "saved"} onSelect={event => {
                    event.preventDefault(); void notes.remove(note.note.revision).then(ok => { if (ok) { setConfirmDelete(false); setMenuOpen(false); } else note.retry(); });
                  }}><Trash2 size={15} aria-hidden="true" />Confirm delete</Menu.Item>
                  <Menu.Item className={styles.menuAction} onSelect={event => { event.preventDefault(); setConfirmDelete(false); }}>Cancel</Menu.Item>
                </> : <Menu.Item className={styles.menuAction} disabled={notes.busy || note.status !== "saved"}
                  onSelect={event => { event.preventDefault(); setConfirmDelete(true); }}><Trash2 size={15} aria-hidden="true" />Delete current note</Menu.Item>}
              </>}
              {notes.error && <div className={styles.menuError} role="alert">{notes.error}
                <button type="button" onClick={() => { notes.clearError(); void notes.refresh(); }}>Refresh notes</button></div>}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        {!collapsed && <button type="button" className={styles.iconButton} aria-label={enlarged ? "Make notepad compact" : "Enlarge notepad"}
          title={enlarged ? "Compact view" : "Enlarge"} onClick={toggleEnlarged}>
          {enlarged ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>}
        <button type="button" className={styles.iconButton} aria-label={collapsed ? "Open notepad" : "Minimize notepad"}
          aria-expanded={!collapsed} aria-controls={contentId} onClick={toggleCollapsed}>
          {collapsed ? <Plus size={17} aria-hidden="true" /> : <Minus size={17} aria-hidden="true" />}
        </button>
      </header>
      <div id={contentId} className={styles.body} hidden={collapsed}>
        {notes.selectedId ? <>
        <input ref={titleRef} disabled={note.status === "loading" || note.status === "deleted"} className={styles.title} aria-label="Note title" placeholder="Title" value={note.note.title} maxLength={NOTE_TITLE_LIMIT}
          onChange={event => note.edit("title", event.target.value)} onBlur={note.flush} />
        <textarea ref={editorRef} onPaste={event => { void pasteImage(event); }} disabled={note.status === "loading" || note.status === "deleted"} className={styles.editor} aria-label="Note text" placeholder="Start writing…" value={note.note.body} maxLength={NOTE_BODY_LIMIT}
          spellCheck onChange={event => note.edit("body", event.target.value)} onBlur={note.flush}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); note.flush(); } }} />
        {images.length > 0 && <div className={styles.images}>
          {images.map((src, index) => <button key={`${src}-${index}`} type="button" className={styles.thumb} aria-label="Enlarge image" onClick={() => setZoom(src)}>
            <img src={src} alt="" loading="lazy" />
          </button>)}
        </div>}
        {pasteError && <p className={styles.menuHint} role="alert">{pasteError}</p>}
        <dialog ref={zoomRef} className={styles.zoom} onClose={() => setZoom(null)} onClick={() => zoomRef.current?.close()}>
          {zoom && <img src={zoom} alt="Pasted image" />}
        </dialog>
        {note.status === "deleted" ? <div className={styles.error} role="alert">
          <span>This note was deleted in another tab. You can keep this copy as a new note.</span>
          <button type="button" disabled={notes.busy} onClick={() => { void createNote(true); }}>Save as new note</button>
        </div> : note.status === "conflict" && note.conflict ? <div className={styles.error} role="alert">
          <p>This note changed in another tab. Your writing is kept here.</p>
          <details><summary>View saved version</summary><strong>{note.conflict.title || "Untitled note"}</strong><pre>{note.conflict.body}</pre></details>
          <div><button type="button" onClick={() => note.resolve(true)}>Keep my version</button><button type="button" onClick={() => note.resolve(false)}>Use saved version</button></div>
        </div> : note.status === "error" ? <div className={styles.error} role="alert">
          <span>{note.backedUp ? "Couldn’t sync. Your draft is kept on this device." : "Couldn’t save. Keep this tab open."}</span>
          <button type="button" onClick={note.retry}>Retry</button>
        </div> : <footer className={styles.footer}><span role="status">{status}</span></footer>}
        </> : <div className={styles.empty}><p>A little space for your thoughts.</p><button type="button" disabled={notes.busy} onClick={() => { void createNote(); }}>New note</button>
          {notes.error && <p role="alert">{notes.error}</p>}</div>}
      </div>
    </aside>
  </div>;
}
