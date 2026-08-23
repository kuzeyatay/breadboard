'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// Renders the ```image-results fenced block the `image_search` tool asks the
// model to emit: a grid of thumbnail cards in the transcript, and a portalled
// full-screen lightbox (counter, prev/next, source attribution) on click. The
// portal is mandatory, not cosmetic: transcript rows are positioned with a
// transform inside the virtualized list, which makes any inline `fixed`
// overlay position against the row instead of the viewport.

interface ImageResultItem {
  title: string;
  image: string;
  thumb: string;
  page: string;
  site: string;
  w?: number;
  h?: number;
}

interface ImageResults {
  query: string;
  items: ImageResultItem[];
}

const MAX_ITEMS = 10;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function httpUrl(value: unknown): string {
  const raw = asString(value);
  return /^https?:\/\//i.test(raw) ? raw : '';
}

// Tolerant on purpose: while the answer streams, the fenced block exists with
// a truncated body, and a partial JSON payload must render as nothing rather
// than throw the whole markdown tree.
function parseImageResults(code: string): ImageResults | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as { query?: unknown; items?: unknown };
  if (!Array.isArray(record.items)) return null;
  const items = record.items
    .flatMap((item): ImageResultItem[] => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const image = httpUrl(raw.image);
      const thumb = httpUrl(raw.thumb);
      if (!image && !thumb) return [];
      return [
        {
          title: asString(raw.title),
          image: image || thumb,
          thumb,
          page: httpUrl(raw.page),
          site: asString(raw.site),
          w: typeof raw.w === 'number' ? raw.w : undefined,
          h: typeof raw.h === 'number' ? raw.h : undefined,
        },
      ];
    })
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return null;
  return { query: asString(record.query), items };
}

/** "flugzeuginfo.net" -> "Flugzeuginfo", for the attribution card. */
function siteLabel(site: string): string {
  const first = site.replace(/^www\./i, '').split('.')[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : site;
}

function SourceFavicon({ site }: { site: string }) {
  const [failed, setFailed] = useState(false);
  if (!site || failed) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold uppercase text-white">
        {siteLabel(site).charAt(0) || '?'}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`}
      className="h-5 w-5 shrink-0 rounded-full"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// One thumbnail with a fallback ladder: full image -> Google thumbnail ->
// broken-image glyph. Hotlink-blocked hosts are common in image results, and a
// grid where a third of the cells are broken glyphs reads as a bug.
function GridThumb({ item }: { item: ImageResultItem }) {
  const [source, setSource] = useState<'image' | 'thumb' | 'failed'>('image');
  const src = source === 'image' ? item.image : item.thumb;
  if (source === 'failed' || !src) {
    return (
      <span className="flex h-full w-full items-center justify-center rounded-[18px] bg-[var(--paper-raised)]">
        <svg
          aria-hidden
          className="h-6 w-6 text-[var(--ink-muted)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path strokeLinecap="round" d="m7 15 3-3 2.5 2.5 1.75-1.75L18 16" />
          <path strokeLinecap="round" d="m6 7 12 10" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={item.title}
      src={src}
      className="h-full w-full cursor-zoom-in rounded-[18px] object-cover"
      loading="lazy"
      onError={() => {
        setSource((current) =>
          current === 'image' && item.thumb && item.thumb !== item.image ? 'thumb' : 'failed',
        );
      }}
    />
  );
}

function LightboxImage({ item }: { item: ImageResultItem }) {
  const [useThumb, setUseThumb] = useState(false);
  const src = useThumb && item.thumb ? item.thumb : item.image;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={item.title}
      src={src}
      className="max-h-[86vh] max-w-[82vw] rounded-lg object-contain shadow-2xl"
      onError={() => {
        if (!useThumb && item.thumb && item.thumb !== item.image) setUseThumb(true);
      }}
    />
  );
}

function Lightbox({
  items,
  index,
  onNavigate,
  onClose,
}: {
  items: ImageResultItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
      if (event.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [index, items.length, onClose, onNavigate]);

  if (!item || typeof document === 'undefined') return null;

  const next = hasNext ? items[index + 1] : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title || 'Image viewer'}
      className="bb-viewer-overlay fixed z-[200] flex items-center justify-center bg-black p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
      >
        <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
      <span className="absolute left-1/2 top-5 -translate-x-1/2 text-sm tabular-nums text-white/80">
        {index + 1} / {items.length}
      </span>
      {hasPrevious ? (
        <button
          type="button"
          onClick={() => onNavigate(index - 1)}
          aria-label="Previous image"
          className="absolute left-4 top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
        >
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          onClick={() => onNavigate(index + 1)}
          aria-label="Next image"
          className="absolute right-4 top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
        >
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      ) : null}
      {next ? (
        // A sliver of the next image at the right edge, like the native Google
        // viewer — a preview that is also a second next button.
        <button
          type="button"
          onClick={() => onNavigate(index + 1)}
          aria-label="Next image preview"
          className="absolute right-0 top-1/2 hidden h-2/5 w-16 -translate-y-1/2 overflow-hidden rounded-l-lg opacity-60 transition hover:opacity-90 sm:block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={next.thumb || next.image} className="h-full w-full object-cover" loading="lazy" />
        </button>
      ) : null}
      <figure
        className="flex max-h-full max-w-full items-center justify-center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <LightboxImage key={item.image} item={item} />
      </figure>
      {item.site || item.title ? (
        <a
          href={item.page || undefined}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-4 left-4 flex max-w-[min(28rem,80vw)] flex-col gap-1 rounded-xl bg-black/80 px-4 py-3 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="flex items-center gap-2 text-xs text-white/80">
            <SourceFavicon site={item.site} />
            <span className="truncate">{siteLabel(item.site)}</span>
          </span>
          {item.title ? <span className="truncate text-sm font-semibold">{item.title}</span> : null}
        </a>
      ) : null}
    </div>,
    document.body,
  );
}

function ChatImageResults({ code }: { code: string }) {
  const results = useMemo(() => parseImageResults(code), [code]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (!results) return null;

  return (
    <div className="chat-image-results" data-selection-exclude>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
        {results.items.map((item, index) => (
          <button
            key={`${item.image}-${index}`}
            type="button"
            onClick={() => setOpenIndex(index)}
            title={item.title}
            className="neu-surface-raised aspect-square cursor-zoom-in overflow-hidden rounded-[22px] border border-[var(--line)] p-1 transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
          >
            <GridThumb item={item} />
          </button>
        ))}
      </div>
      {openIndex !== null ? (
        <Lightbox
          items={results.items}
          index={Math.min(openIndex, results.items.length - 1)}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </div>
  );
}

export default memo(ChatImageResults, (prev, next) => prev.code === next.code);
