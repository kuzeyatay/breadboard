"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, ImagePlus, Pin, Trash2, X } from "lucide-react";
import { CHAT_HIGHLIGHT_COLORS, type ChatHighlightColor } from "@/lib/chat-highlights";
import { extractChatAttachments, imageFilesFromClipboard } from "@/lib/chat-attachments";
import { NOTE_BODY_LIMIT, NOTE_TITLE_LIMIT } from "@/lib/terminal-note";
import type { PdfHighlight, PdfPinNote as PinNote } from "@/lib/pdf-assistant";
import styles from "@/app/new-tab/new-tab-notepad.module.css";

const EMPTY_NOTE: PinNote = { title: "", body: "", images: [] };
const imageUrl = (id: string) => `/api/pdf-pin-images?id=${encodeURIComponent(id)}`;

/**
 * A pin's one quick note, styled like the Terminal notepad: a title, free text
 * and images. It sits beside its pin and follows it while the PDF scrolls.
 */
export default function PdfPinNote({ pin, containerRef, saveError, onSave, onColor, onDelete, onClose }: {
  pin: PdfHighlight;
  containerRef: RefObject<HTMLElement | null>;
  saveError?: string | null;
  onSave: (note: PinNote) => void;
  onColor: (color: ChatHighlightColor) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const id = pin.selection.id;
  const cardRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PinNote>(() => pin.pinNote ?? EMPTY_NOTE);
  const [dirty, setDirty] = useState(false);
  const [attaching, setAttaching] = useState(0);
  const [attachError, setAttachError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const scheduleRef = useRef<() => void>(() => {});
  const latest = useRef({ draft, dirty, onSave });
  latest.current = { draft, dirty, onSave };

  // Autosave like the notepad: a short pause after typing, and on close.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => { latest.current.onSave(draft); setDirty(false); }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);
  useEffect(() => () => { if (latest.current.dirty) latest.current.onSave(latest.current.draft); }, []);
  // A new pin opens ready to type, once the card is on screen beside its pin.
  const focusOnShow = useRef(!pin.pinNote?.title && !pin.pinNote?.body);

  const edit = (next: Partial<PinNote>) => { setDraft(current => ({ ...current, ...next })); setDirty(true); };

  // Follow the pin: below its needle, clamped to the window, hidden while the pin is scrolled away.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const pinElement = document.querySelector<HTMLElement>(`[data-pdf-pin="${CSS.escape(id)}"]`);
      const view = containerRef.current?.getBoundingClientRect();
      const rect = pinElement?.getBoundingClientRect();
      const visible = Boolean(rect && view && rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right);
      card.style.visibility = visible ? "visible" : "hidden";
      if (!rect || !visible) return;
      if (focusOnShow.current) { focusOnShow.current = false; titleRef.current?.focus(); }
      const width = card.offsetWidth, height = card.offsetHeight;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left - 12 + offsetRef.current.x));
      const below = rect.bottom + 6, above = rect.top - height - 6;
      const top = (below + height <= window.innerHeight - 12 || above < 12 ? below : above) + offsetRef.current.y;
      card.style.left = `${left}px`;
      card.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, top))}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    scheduleRef.current = schedule;
    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(card);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    // The pin re-renders when PDF.js redraws its page or the pin is dragged.
    const mutations = new MutationObserver(schedule);
    if (containerRef.current) mutations.observe(containerRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [id, containerRef]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (cardRef.current?.contains(target) || target?.closest?.(`[data-pdf-pin="${CSS.escape(id)}"]`)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [id, onClose]);

  async function attach(files: File[]) {
    const images = files.filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    setAttaching(count => count + images.length);
    setAttachError("");
    try {
      // Same downscaling as chat images, so a phone photo stays a few hundred KB.
      const result = await extractChatAttachments(images);
      const ids: string[] = [];
      for (const attachment of result.attachments) {
        if (attachment.type !== "image") continue;
        const response = await fetch("/api/pdf-pin-images", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: attachment.dataUrl }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload.id !== "string") throw new Error(payload?.error?.message ?? "The image could not be attached.");
        ids.push(payload.id);
      }
      if (ids.length) edit({ images: [...latest.current.draft.images, ...ids] });
      if (result.errors.length) setAttachError(result.errors.join(" "));
    } catch (failure) {
      setAttachError(failure instanceof Error ? failure.message : "The image could not be attached.");
    } finally {
      setAttaching(count => Math.max(0, count - images.length));
    }
  }

  function removeImage(imageId: string) {
    edit({ images: draft.images.filter(item => item !== imageId) });
    void fetch(`/api/pdf-pin-images?id=${encodeURIComponent(imageId)}`, { method: "DELETE" }).catch(() => {});
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const files = imageFilesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void attach(files);
  }

  const color = pin.color;
  const status = saveError ? saveError : attaching ? "Adding image…" : dirty ? "Saving…" : "All changes saved";
  if (typeof document === "undefined") return null;
  return createPortal(
    <aside
      ref={cardRef}
      data-pdf-pin-note={id}
      aria-label="Pin note"
      className={styles.notepad}
      title="Click the border to change the pin color"
      style={{
        position: "fixed", inset: "auto", left: 0, top: 0, zIndex: 45, visibility: "hidden",
        width: "min(320px, calc(100vw - 24px))", height: "auto", maxHeight: "min(440px, calc(100vh - 24px))",
        border: `2px solid var(--selection-highlight-${color}-line)`,
        outline: `3px solid color-mix(in srgb, var(--selection-highlight-${color}) 65%, transparent)`,
      }}
      onClick={event => {
        // As on garden cards: a click on the colored edge opens its color choice.
        if ((event.target as Element).closest("button, a, textarea, input, [data-pin-color-picker]")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top, edge = 12;
        if (x <= edge || y <= edge || rect.width - x <= edge || rect.height - y <= edge) setPickerOpen(open => !open);
      }}
    >
      <header className={styles.header}>
        <button type="button" className={styles.handle} aria-label="Move note" title="Drag to move the note"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            offsetRef.current = { x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y };
            scheduleRef.current();
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}>
          <GripHorizontal size={16} aria-hidden="true" />
          <Pin size={16} aria-hidden="true" style={{ color: `var(--selection-highlight-${color}-line)` }} />
          <span>Pin</span>
        </button>
        <button type="button" className={styles.iconButton} aria-label="Attach images" title="Attach images"
          onClick={() => fileRef.current?.click()}>
          <ImagePlus size={16} aria-hidden="true" />
        </button>
        <button type="button" className={styles.iconButton} aria-label="Delete pin" title="Delete pin"
          onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
        <button type="button" className={styles.iconButton} aria-label="Close note" title="Close" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
      <div className={styles.body} onPaste={paste} style={{ overflowY: "auto" }}>
        {confirmDelete ? <div className={styles.error} role="alert">
          <p>Delete this pin and its note? This cannot be undone.</p>
          <button type="button" onClick={onDelete}>Delete pin</button>
          <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div> : null}
        <input ref={titleRef} className={styles.title} aria-label="Note title" placeholder="Title" value={draft.title}
          maxLength={NOTE_TITLE_LIMIT} onChange={event => edit({ title: event.target.value })} />
        <textarea className={styles.editor} aria-label="Note text" placeholder="Start writing…" value={draft.body}
          maxLength={NOTE_BODY_LIMIT} spellCheck rows={5} style={{ minHeight: 96 }}
          onChange={event => edit({ body: event.target.value })} />
        {draft.images.length > 0 && <div aria-label="Attached images" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, marginBottom: 10 }}>
          {draft.images.map(imageId => (
            <figure key={imageId} style={{ position: "relative", margin: 0 }}>
              <a href={imageUrl(imageId)} target="_blank" rel="noreferrer" title="Open image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(imageId)} alt="" style={{ display: "block", width: "100%", height: 84, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)" }} />
              </a>
              <button type="button" aria-label="Remove image" title="Remove image" onClick={() => removeImage(imageId)}
                style={{ position: "absolute", top: 4, right: 4, display: "grid", placeItems: "center", width: 22, height: 22, border: 0, borderRadius: 999,
                  background: "color-mix(in srgb, var(--paper-raised) 88%, transparent)", color: "var(--ink-heading)", cursor: "pointer" }}>
                <X size={13} aria-hidden="true" />
              </button>
            </figure>
          ))}
        </div>}
        {attachError ? <div className={styles.error} role="alert"><span>{attachError}</span></div> : null}
        <footer className={styles.footer}><span role="status">{status}</span></footer>
      </div>
      {pickerOpen && <div data-pin-color-picker role="group" aria-label="Pin color"
        style={{ position: "absolute", left: 12, top: 12, zIndex: 3, width: 144, padding: 8, borderRadius: 10,
          border: "1px solid var(--line)", background: "var(--paper-raised)", boxShadow: "0 10px 24px rgb(12 24 18 / 16%)" }}>
        <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 500, color: "var(--ink-muted)" }}>Border color</div>
        <div role="radiogroup" style={{ display: "flex", gap: 6 }}>
          {CHAT_HIGHLIGHT_COLORS.map(option => (
            <button key={option.id} type="button" role="radio" aria-checked={color === option.id}
              aria-label={`${option.label} pin`} title={option.label} data-highlight-color={option.id}
              className="bb-chat-highlight-swatch h-5 w-5 rounded transition-transform hover:scale-110"
              style={{ border: `1px solid ${color === option.id ? "var(--ink-heading)" : "transparent"}` }}
              onClick={() => { onColor(option.id); setPickerOpen(false); }} />
          ))}
        </div>
        <button type="button" onClick={() => setPickerOpen(false)}
          style={{ marginTop: 8, width: "100%", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)",
            background: "transparent", color: "var(--ink-muted)", fontSize: 11, cursor: "pointer" }}>
          Close
        </button>
      </div>}
    </aside>,
    document.body,
  );
}
