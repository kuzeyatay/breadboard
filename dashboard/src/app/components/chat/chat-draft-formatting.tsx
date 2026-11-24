"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Bold, Check, ChevronDown, Italic, Link2 } from "lucide-react";
import {
  DRAFT_TEXT_STYLES,
  draftHasEmphasis,
  draftTextStyle,
  editDraftEmphasis,
  editDraftLink,
  editDraftTextStyle,
  type DraftEdit,
  type DraftRange,
} from "@/lib/chat-draft-formatting";
import { linkHref } from "@/lib/composer-links";

type DraftSelection = DraftRange & { value: string };
type SelectionAnchor = { x: number; top: number; bottom: number };
type Overlay = { selection: DraftSelection; anchor: SelectionAnchor; portalTarget: HTMLElement };
type Panel = "style" | "link";

const VIEWPORT_MARGIN = 8;
const GAP = 6;
const control = "flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm text-[var(--ink-heading)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] aria-expanded:bg-[var(--paper-strong)] aria-pressed:bg-[var(--paper-strong)] aria-pressed:text-[var(--botanical)]";
const surface = "border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink-heading)] shadow-lg";

function readSelection(input: HTMLTextAreaElement): DraftSelection | null {
  const { value, selectionStart: start, selectionEnd: end } = input;
  return input.disabled || input.readOnly || !value.slice(start, end).trim()
    ? null
    : { value, start, end };
}

function sameSelection(a: DraftSelection | null, b: DraftSelection | null) {
  return a?.value === b?.value && a?.start === b?.start && a?.end === b?.end;
}

// Textarea selections have offsets but no DOM range. Measure those offsets
// in a hidden copy with the same wrapping, padding and font as the draft.
function measureSelection(input: HTMLTextAreaElement, { value, start, end }: DraftSelection): SelectionAnchor | null {
  const rect = input.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const view = input.ownerDocument.defaultView!;
  const computed = view.getComputedStyle(input);
  const mirror = input.ownerDocument.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    boxSizing: "border-box",
    width: `${input.clientWidth}px`,
    left: `${rect.left + input.clientLeft - input.scrollLeft}px`,
    top: `${rect.top + input.clientTop - input.scrollTop}px`,
    padding: computed.padding,
    font: computed.font,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    wordSpacing: computed.wordSpacing,
    tabSize: computed.tabSize,
    textAlign: computed.textAlign,
    textIndent: computed.textIndent,
    textTransform: computed.textTransform,
    direction: computed.direction,
    whiteSpace: computed.whiteSpace,
    overflowWrap: computed.overflowWrap,
    wordBreak: computed.wordBreak,
  });
  const text = input.ownerDocument.createTextNode(value);
  mirror.append(text);
  input.ownerDocument.body.append(mirror);
  const range = input.ownerDocument.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const visible = Array.from(range.getClientRects()).find(line =>
    line.width > 0 &&
    line.right > Math.max(0, rect.left) &&
    line.left < Math.min(view.innerWidth, rect.right) &&
    line.bottom > Math.max(0, rect.top) &&
    line.top < Math.min(view.innerHeight, rect.bottom));
  mirror.remove();
  if (!visible) return null;
  const left = Math.max(0, rect.left, visible.left);
  const right = Math.min(view.innerWidth, rect.right, visible.right);
  return { x: (left + right) / 2, top: Math.max(rect.top, visible.top), bottom: Math.min(rect.bottom, visible.bottom) };
}

function applyEdit(input: HTMLTextAreaElement, edit: DraftEdit) {
  const nextLength = input.value.length - (edit.end - edit.start) + edit.replacement.length;
  if (input.maxLength >= 0 && nextLength > input.maxLength && nextLength > input.value.length) return false;
  const direction = input.selectionDirection;
  input.focus({ preventScroll: true });
  if (input.value.slice(edit.start, edit.end) !== edit.replacement) {
    input.setSelectionRange(edit.start, edit.end);
    // A native editing command keeps formatting in the textarea's undo stack.
    if (!input.ownerDocument.execCommand("insertText", false, edit.replacement)) {
      input.setRangeText(edit.replacement, edit.start, edit.end);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  input.setSelectionRange(edit.selection.start, edit.selection.end, direction);
  return true;
}

function selectedLink({ value, start, end }: DraftSelection) {
  const link = /^\[((?:\\.|[^\\\]\n])*)\]\(<([^<>\n]+)>\)$/.exec(value.slice(start, end));
  return link ? { label: link[1], href: link[2] } : null;
}

export default function ChatDraftFormatting({
  inputRef,
  value,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const styleButton = useRef<HTMLButtonElement>(null);
  const dismissedSelection = useRef<DraftSelection | null>(null);
  const panelId = useId();
  const selection = overlay?.selection.value === value ? overlay.selection : null;

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const input = field;
    const doc = input.ownerDocument;
    const view = doc.defaultView!;
    let frame = 0;
    let mouseSelecting = false;
    let composing = false;

    function close() {
      setOverlay(null);
      setPanel(null);
    }
    function update() {
      frame = 0;
      if (mouseSelecting || composing) return;
      const current = readSelection(input);
      if (!current || (doc.activeElement !== input && !overlayRef.current?.contains(doc.activeElement))) {
        dismissedSelection.current = null;
        close();
        return;
      }
      if (sameSelection(current, dismissedSelection.current)) return;
      dismissedSelection.current = null;
      const anchor = measureSelection(input, current);
      if (!anchor) {
        close();
        return;
      }
      setOverlay(previous =>
        previous && sameSelection(previous.selection, current) &&
        previous.anchor.x === anchor.x && previous.anchor.top === anchor.top && previous.anchor.bottom === anchor.bottom
          ? previous
          : { selection: current, anchor, portalTarget: doc.body });
    }
    function schedule() {
      if (!frame) frame = view.requestAnimationFrame(update);
    }
    function pointerDown(event: PointerEvent) {
      if (event.target === input) {
        dismissedSelection.current = null;
        mouseSelecting = event.pointerType === "mouse" && event.button === 0;
      } else if (overlayRef.current?.contains(event.target as Node)) {
        return;
      }
      close();
    }
    function pointerEnd() {
      if (!mouseSelecting) return;
      mouseSelecting = false;
      schedule();
    }
    function keyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing || composing) return;
      const current = readSelection(input);
      if (!current) return;
      if (event.key === "Escape" && overlayRef.current) {
        dismissedSelection.current = current;
        close();
      } else if (event.key === "Tab" && !event.shiftKey && linkButton.current) {
        linkButton.current.focus();
      } else {
        const key = event.key.toLowerCase();
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !["b", "i", "k"].includes(key)) return;
        if (key === "k") {
          const anchor = measureSelection(input, current);
          if (!anchor) return;
          setUrl(selectedLink(current)?.href ?? "");
          setError("");
          dismissedSelection.current = null;
          setOverlay({ selection: current, anchor, portalTarget: doc.body });
          setPanel("link");
        } else {
          applyEdit(input, editDraftEmphasis(current.value, current, key === "b" ? "**" : "*"));
          schedule();
        }
      }
      event.preventDefault();
      event.stopPropagation();
    }
    function compositionStart() {
      composing = true;
      close();
    }
    function compositionEnd() {
      composing = false;
      schedule();
    }

    const observer = new ResizeObserver(schedule);
    observer.observe(input);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const capture = { ...options, capture: true };
    input.addEventListener("select", schedule, options);
    input.addEventListener("input", schedule, options);
    input.addEventListener("keydown", keyDown, options);
    input.addEventListener("keyup", schedule, options);
    input.addEventListener("compositionstart", compositionStart, options);
    input.addEventListener("compositionend", compositionEnd, options);
    doc.addEventListener("focusin", schedule, options);
    doc.addEventListener("pointerdown", pointerDown, capture);
    doc.addEventListener("pointerup", pointerEnd, capture);
    doc.addEventListener("pointercancel", pointerEnd, capture);
    view.addEventListener("scroll", schedule, capture);
    return () => {
      view.cancelAnimationFrame(frame);
      observer.disconnect();
      listeners.abort();
      view.removeEventListener("resize", schedule);
    };
  }, [inputRef]);

  useLayoutEffect(() => {
    const bar = overlayRef.current;
    if (!bar || !overlay) return;
    const view = bar.ownerDocument.defaultView!;
    function place() {
      if (!bar || !overlay) return;
      const { x, top, bottom } = overlay.anchor;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(x - bar.offsetWidth / 2, view.innerWidth - VIEWPORT_MARGIN - bar.offsetWidth));
      const above = top - bar.offsetHeight - GAP;
      const barTop = above >= VIEWPORT_MARGIN ? above : Math.min(bottom + GAP, view.innerHeight - bar.offsetHeight - VIEWPORT_MARGIN);
      bar.style.left = `${left}px`;
      bar.style.top = `${barTop}px`;
      const popup = panelRef.current;
      if (!popup) return;
      const roomAbove = barTop - GAP - VIEWPORT_MARGIN;
      const roomBelow = view.innerHeight - barTop - bar.offsetHeight - GAP - VIEWPORT_MARGIN;
      const placeAbove = popup.scrollHeight <= roomAbove || roomAbove >= roomBelow;
      popup.style.left = `${Math.max(VIEWPORT_MARGIN - left, bar.offsetWidth - popup.offsetWidth)}px`;
      popup.style.top = placeAbove ? "auto" : `calc(100% + ${GAP}px)`;
      popup.style.bottom = placeAbove ? `calc(100% + ${GAP}px)` : "auto";
      popup.style.maxHeight = `${Math.max(0, placeAbove ? roomAbove : roomBelow)}px`;
    }
    place();
    view.addEventListener("resize", place);
    return () => view.removeEventListener("resize", place);
  }, [overlay, selection, panel, error]);

  useLayoutEffect(() => {
    if (panel === "link") panelRef.current?.querySelector("input")?.focus({ preventScroll: true });
    if (panel === "style") {
      const checked = panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
      (checked ?? panelRef.current?.querySelector("button"))?.focus({ preventScroll: true });
    }
  }, [panel]);

  if (!selection || !overlay) return null;
  const style = draftTextStyle(value, selection);
  const existingLink = selectedLink(selection);
  const label = DRAFT_TEXT_STYLES.find(option => option.id === style)?.label ?? "Text";

  function commit(edit: DraftEdit) {
    const field = inputRef.current;
    if (!field || !sameSelection(readSelection(field), selection)) return;
    if (applyEdit(field, edit)) setPanel(null);
    else if (panel === "link") setError("This link would make the message too long.");
  }
  function saveLink() {
    if (!selection) return;
    const href = linkHref(url.trim());
    if (!href) {
      setError("Enter a valid web URL.");
      return;
    }
    if (existingLink) {
      const replacement = `[${existingLink.label}](<${href}>)`;
      commit({ ...selection, replacement, selection: { start: selection.start, end: selection.start + replacement.length } });
    } else {
      commit(editDraftLink(value, selection, href));
    }
  }
  function toolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && event.shiftKey && event.target === linkButton.current) {
      event.preventDefault();
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (panel) {
      setPanel(null);
      (panel === "link" ? linkButton : styleButton).current?.focus({ preventScroll: true });
    } else {
      dismissedSelection.current = selection;
      setOverlay(null);
      inputRef.current?.focus({ preventScroll: true });
    }
  }
  function styleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll("button"));
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return createPortal(
    <div ref={overlayRef} data-chat-draft-formatting="" className="fixed z-[10010] [-webkit-app-region:no-drag]"
      onKeyDown={toolbarKeyDown}>
      <div role="toolbar" aria-label="Format selected text" className={`flex items-center gap-0.5 rounded-xl p-1 ${surface}`}
        onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}>
        <button ref={linkButton} type="button" className={control} title="Link" aria-label="Link"
          aria-expanded={panel === "link"} aria-controls={panel === "link" ? panelId : undefined}
          onClick={() => {
            if (panel === "link") {
              setPanel(null);
              linkButton.current?.focus({ preventScroll: true });
              return;
            }
            setUrl(existingLink?.href ?? "");
            setError("");
            setPanel("link");
          }}>
          <Link2 size={16} aria-hidden />
        </button>
        {([["**", "Bold", Bold], ["*", "Italic", Italic]] as const).map(([mark, name, Icon]) =>
          <button key={name} type="button" className={control} title={name} aria-label={name}
            aria-pressed={draftHasEmphasis(value, selection, mark)}
            onClick={() => commit(editDraftEmphasis(value, selection, mark))}>
            <Icon size={16} aria-hidden />
          </button>)}
        <button ref={styleButton} type="button" className={`${control} ml-0.5 whitespace-nowrap`}
          aria-label={`Text style: ${label}`} aria-haspopup="menu" aria-expanded={panel === "style"}
          aria-controls={panel === "style" ? panelId : undefined} onClick={() => {
            if (panel === "style") styleButton.current?.focus({ preventScroll: true });
            setPanel(panel === "style" ? null : "style");
          }}>
          {label} <ChevronDown size={14} aria-hidden />
        </button>
      </div>
      {panel === "style" && (
        <div ref={panelRef} id={panelId} role="menu" aria-label="Text style" onKeyDown={styleKeyDown}
          className={`absolute w-48 max-w-[calc(100vw-16px)] overflow-auto rounded-xl p-1 ${surface}`}>
          {DRAFT_TEXT_STYLES.map(option => (
            <button key={option.id} type="button" role="menuitemradio" aria-checked={style === option.id}
              className="flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1 text-left text-sm hover:bg-[var(--paper-strong)] focus-visible:bg-[var(--paper-strong)] focus-visible:outline-none"
              onClick={() => commit(editDraftTextStyle(value, selection, option.id))}>
              {option.label}{style === option.id && <Check size={15} className="shrink-0 text-[var(--botanical)]" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      {panel === "link" && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Link address"
          className={`absolute w-72 max-w-[calc(100vw-16px)] overflow-auto rounded-xl p-2 ${surface}`}>
          <div className="flex gap-1">
            <input aria-label="Link URL" type="text" inputMode="url" placeholder="https://example.com"
              aria-invalid={Boolean(error)} aria-describedby={error ? `${panelId}-error` : undefined}
              value={url} onChange={event => { setUrl(event.target.value); setError(""); }}
              onKeyDown={event => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.stopPropagation();
                saveLink();
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 text-sm outline-none focus:border-[var(--botanical)]" />
            <button type="button" className={`${control} bg-[var(--paper-strong)] font-medium`} onClick={saveLink}>Apply</button>
          </div>
          {error && <p id={`${panelId}-error`} role="alert" className="mt-1 px-1 text-xs text-[var(--ink-muted)]">{error}</p>}
        </div>
      )}
    </div>,
    overlay.portalTarget,
  );
}
