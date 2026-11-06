'use client';

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  // A portal keeps the viewer outside transformed, clipped transcript rows;
  // the native modal supplies focus trapping and makes the page underneath inert.
  return createPortal(
    <dialog
      ref={dialogRef}
      className="chat-image-viewer"
      aria-label={alt || 'Image viewer'}
      data-selection-exclude
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="chat-image-viewer-toolbar">
        <button type="button" onClick={() => setZoomed(value => !value)} aria-pressed={zoomed}>
          {zoomed ? 'Fit to screen' : 'Zoom in'}
        </button>
        <button type="button" onClick={onClose} aria-label="Close image viewer" autoFocus>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div
        className="chat-image-viewer-stage"
        data-zoomed={zoomed}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          decoding="async"
          style={{ '--chat-image-aspect-ratio': aspectRatio } as CSSProperties}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalHeight) setAspectRatio(image.naturalWidth / image.naturalHeight);
          }}
        />
      </div>
    </dialog>,
    document.body,
  );
}

export default function ChatMarkdownImage({ alt, src }: ComponentProps<'img'>) {
  const [open, setOpen] = useState(false);
  const imageSrc = typeof src === 'string' ? src : undefined;
  const label = alt?.trim() ? `Enlarge image: ${alt}` : 'Enlarge image';

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt ?? ''}
        src={imageSrc}
        className="chat-markdown-image max-w-full rounded-xl border border-gray-800/80 shadow-lg my-3"
        // Mounted messages may initially be hidden in a restored tab.
        loading="eager"
        decoding="async"
        role={imageSrc ? 'button' : undefined}
        tabIndex={imageSrc ? 0 : undefined}
        aria-label={imageSrc ? label : undefined}
        aria-haspopup={imageSrc ? 'dialog' : undefined}
        title={imageSrc ? 'Click to enlarge' : undefined}
        onClick={(event) => {
          if (!imageSrc) return;
          // Linked Markdown images should preview without following the link.
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.click();
        }}
      />
      {open && imageSrc ? <ImageViewer key={imageSrc} src={imageSrc} alt={alt ?? ''} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
