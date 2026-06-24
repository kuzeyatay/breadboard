'use client';

import { useState, useEffect } from 'react';

interface Cluster { slug: string; name: string; }

interface Props {
  clusterSlug?: string;
}

export default function NewNoteButton({ clusterSlug: fixedSlug }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');

  const needsPicker = !fixedSlug;
  const [activeSlug, setActiveSlug] = useState(fixedSlug ?? '');
  const targetSlug = activeSlug || fixedSlug || selectedSlug;

  useEffect(() => {
    if (!needsPicker) return;
    fetch('/api/clusters')
      .then((r) => r.json())
      .then((d) => {
        const list: Cluster[] = d.clusters ?? [];
        setClusters(list);
        if (list.length > 0) setSelectedSlug(list[0].slug);
      })
      .catch(() => {});
  }, [needsPicker]);

  useEffect(() => {
    function handler(e: Event) {
      const cluster = (e as CustomEvent<{ cluster: string }>).detail?.cluster;
      if (cluster) {
        setActiveSlug(cluster);
        setSelectedSlug(cluster);
      }
    }
    window.addEventListener('sb:active-cluster', handler);
    return () => window.removeEventListener('sb:active-cluster', handler);
  }, []);

  function openModal() {
    setTitle('');
    setContent('');
    setSelectedFolder('');
    setError('');
    setOpen(true);
  }

  // Load the target cluster's folders so the note can be created inside one.
  useEffect(() => {
    if (!open || !targetSlug) {
      setFolders([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/documents?clusterSlug=${encodeURIComponent(targetSlug)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setFolders(Array.isArray(d.folders) ? d.folders : []);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetSlug]);

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault();
      const cluster = (e as CustomEvent<{ cluster?: string }>).detail?.cluster;
      if (cluster) {
        setActiveSlug(cluster);
        setSelectedSlug(cluster);
      }
      openModal();
    }

    window.addEventListener('sb:new-note', handler);
    return () => window.removeEventListener('sb:new-note', handler);
  }, []);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const slug = targetSlug;
    if (!title.trim() || !slug || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: slug,
          title: title.trim(),
          content,
          folder: selectedFolder,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return; }
      setOpen(false);
    } catch {
      setError('Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = title.trim() && (activeSlug || fixedSlug || selectedSlug) && !saving;

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New note
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <form
            onSubmit={handleSubmit}
            className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800 shrink-0">
              <h2 className="text-sm font-semibold text-white">New markdown note</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto flex-1">
              {needsPicker && clusters.length > 0 && (
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-600 transition-colors"
                >
                  {clusters.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.name}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <span className="shrink-0">Folder</span>
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-600 transition-colors"
                >
                  <option value="">Garden root</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>{folder}</option>
                  ))}
                </select>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title"
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your markdown here…"
                rows={14}
                className="w-full resize-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors font-mono"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800 shrink-0">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
