'use client';

import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import ViewportPopover from './viewport-popover';

export default function SuggestionInfo({ reason, editorRef }: {
  reason: string;
  editorRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const editor: HTMLElement | null = editorRef.current;
    if (!editor) return;
    // Tab accepts the suggestion, so its explanation is also reachable from the editor.
    const toggle = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== 'i') return;
      event.preventDefault();
      if (!event.repeat) setOpen(current => !current);
    };
    const close = () => setOpen(false);
    editor.addEventListener('keydown', toggle);
    editor.addEventListener('input', close);
    editor.addEventListener('blur', close);
    return () => {
      editor.removeEventListener('keydown', toggle);
      editor.removeEventListener('input', close);
      editor.removeEventListener('blur', close);
    };
  }, [editorRef]);

  return <>
    <button ref={anchor} type="button" tabIndex={-1} aria-label="Why this suggestion?" aria-keyshortcuts="Alt+I"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      className="pointer-events-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-[var(--ink-muted)] hover:bg-[var(--line)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
      onPointerDown={event => event.preventDefault()}
      onClick={event => { event.stopPropagation(); setOpen(current => !current); }}
      onBlur={() => setOpen(false)}>
      <Info aria-hidden size={14} strokeWidth={1.65} />
    </button>
    <span className="sr-only" role="status">{open ? reason : ''}</span>
    {open && <ViewportPopover anchorRef={anchor} id={panelId} ariaLabel="Why this suggestion?" role="dialog"
      topLayer restoreFocusOnEscape={false} onClose={() => setOpen(false)}
      className="pointer-events-auto fixed w-64 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] text-left font-sans text-xs leading-5 whitespace-normal text-[var(--ink)] shadow-lg">
      <div className="px-3 py-2.5" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}>
        <strong className="block font-semibold">Why this suggestion?</strong>
        <span className="break-words">{reason}</span>
      </div>
    </ViewportPopover>}
  </>;
}
