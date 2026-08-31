'use client';

import { useState, useEffect } from 'react';

interface Cluster { slug: string; name: string; }

interface Props {
  clusterSlug?: string;
}

export default function NewNoteButton({ clusterSlug: fixedSlug }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
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
    setTags([]);
    setTagDraft('');
    setContent('');
    setSelectedFolder('');
    setError('');
    setOpen(true);
  }

  function parseTagDraft(draft: string): string[] {
    return draft.split(/[#,\s]+/).map((t) => t.trim()).filter(Boolean);
  }

  function commitTagDraft() {
    const pieces = parseTagDraft(tagDraft);
    if (pieces.length > 0) {
      setTags((prev) => [...prev, ...pieces.filter((p) => !prev.includes(p))]);
    }
    setTagDraft('');
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      commitTagDraft();
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
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
          tags: [...tags, ...parseTagDraft(tagDraft).filter((t) => !tags.includes(t))],
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
        className="neu-button flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New note
      </button>

      {open && (
        <div className="markdown-editor-modal">
          <form
            onSubmit={handleSubmit}
            className="markdown-editor-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-note-dialog-title"
          >
            <div className="markdown-editor-header">
              <div>
                <p className="markdown-editor-kicker">Markdown</p>
                <h2 id="new-note-dialog-title">New note</h2>
              </div>
            </div>
            <div className="markdown-editor-fields">
              {needsPicker && clusters.length > 0 && (
                <label className="markdown-editor-field">
                  <span>Garden</span>
                  <select value={selectedSlug} onChange={(e) => setSelectedSlug(e.target.value)}>
                    {clusters.map((c) => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="markdown-editor-field">
                <span>Folder</span>
                <select value={selectedFolder} onChange={(e) => setSelectedFolder(e.target.value)}>
                  <option value="">Garden root</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>{folder}</option>
                  ))}
                </select>
              </label>
              <label className="markdown-editor-field">
                <span>Title</span>
                <input
                  type="text"
                  className="markdown-editor-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Note title"
                  autoFocus
                />
              </label>
              <label className="markdown-editor-field">
                <span>Tags</span>
                <div className="markdown-editor-tags-box">
                  {tags.map((tag) => (
                    <span key={tag} className="markdown-editor-tag">
                      #{tag}
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="markdown-editor-tags"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={commitTagDraft}
                    placeholder={tags.length === 0 ? '#hashtag #separated #tags' : ''}
                  />
                </div>
              </label>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your markdown here…"
              spellCheck={false}
              className="markdown-editor-textarea"
            />
            <div className="markdown-editor-footer">
              <p className="markdown-editor-error">{error}</p>
              <div className="markdown-editor-footer-actions">
                <button type="button" onClick={() => setOpen(false)} className="markdown-editor-cancel">
                  Cancel
                </button>
                <button type="submit" disabled={!canSubmit} className="markdown-editor-save">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
