'use client';

import { useEffect, useMemo, useState } from 'react';
import FastReadReader from './fastread-reader';
import { fetchFastReadNote, type FastReadNote } from '@/lib/fastread-source';

interface ActiveNote {
  clusterSlug: string;
  slug: string;
}

interface ActiveNoteDetail {
  cluster?: string;
  slug?: string;
  isMarkdownDocument?: boolean;
}

interface Props {
  clusterSlug: string;
  initialNote?: string;
}

/** Index and tag listing pages have no prose to read. */
function isMarkdownDocument(slug: string | undefined, clusterSlug: string): slug is string {
  const clean = (slug ?? '')
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
  const cleanCluster = clusterSlug.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
  return Boolean(
    clean &&
      clean !== 'index' &&
      clean !== cleanCluster &&
      !clean.endsWith('/index') &&
      !clean.endsWith('/_index') &&
      !clean.startsWith('tags/'),
  );
}

export default function FastReadButton({ clusterSlug, initialNote }: Props) {
  const initialActiveNote = useMemo<ActiveNote | null>(
    () => (isMarkdownDocument(initialNote, clusterSlug) ? { clusterSlug, slug: initialNote } : null),
    [clusterSlug, initialNote],
  );
  const [activeNote, setActiveNote] = useState<ActiveNote | null>(initialActiveNote);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState<FastReadNote | null>(null);

  useEffect(() => {
    setActiveNote(initialActiveNote);
  }, [initialActiveNote]);

  // The garden page is a Quartz iframe; it announces navigation on this event.
  useEffect(() => {
    function handleActiveNote(event: Event) {
      const detail = (event as CustomEvent<ActiveNoteDetail>).detail;
      if (
        detail?.cluster !== clusterSlug ||
        !detail.isMarkdownDocument ||
        !isMarkdownDocument(detail.slug, clusterSlug)
      ) {
        setActiveNote(null);
        return;
      }

      setActiveNote({ clusterSlug, slug: detail.slug });
      setError('');
    }

    window.addEventListener('sb:active-note', handleActiveNote);
    return () => window.removeEventListener('sb:active-note', handleActiveNote);
  }, [clusterSlug]);

  async function openReader() {
    if (!activeNote || loading) return;

    setLoading(true);
    setError('');

    try {
      setNote(await fetchFastReadNote(activeNote.clusterSlug, activeNote.slug));
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open Fast-read');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={openReader}
        disabled={!activeNote || loading}
        title={
          activeNote
            ? 'Speed-read this page one word at a time'
            : 'Open a page to speed-read it'
        }
        className="neu-button flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-700 disabled:hover:text-gray-300"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 4 6 13h5l-1 7 7-9h-5z" />
        </svg>
        {loading ? 'Opening...' : 'Fast-read'}
      </button>

      {error && (
        <span className="neu-popover absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-red-900/70 bg-gray-950 px-3 py-2 text-xs text-red-300">
          {error}
        </span>
      )}

      {note && (
        <FastReadReader
          title={note.title}
          content={note.content}
          onClose={() => setNote(null)}
        />
      )}
    </span>
  );
}
