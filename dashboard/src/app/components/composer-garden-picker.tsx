'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, MessageSquare, Search, Sprout, X } from 'lucide-react';

interface GardenChat { id: string; title: string; gardenId: string; updatedAt: string }
interface Garden { slug: string; name: string }

export default function ComposerGardenPicker({ currentChatId, onClose, onSelect }: {
  currentChatId: string; onClose: () => void; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<GardenChat[]>([]);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function read(url: string) {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load garden chats.');
      return response.json();
    }
    void Promise.all([read('/api/hermes/sessions?surface=dashboard_terminal'), read('/api/clusters')])
      .then(([history, catalog]) => {
        if (!Array.isArray(history.sessions) || !Array.isArray(catalog.clusters)) throw new Error('Could not load garden chats.');
        if (controller.signal.aborted) return;
        setChats(history.sessions.filter((chat: GardenChat) => chat && typeof chat.id === 'string' && typeof chat.gardenId === 'string' && chat.gardenId));
        setGardens(catalog.clusters.filter((garden: Garden) => garden && typeof garden.slug === 'string' && typeof garden.name === 'string'));
      }).catch(() => { if (!controller.signal.aborted) setError('Could not load garden chats.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const groups = useMemo(() => {
    const names = new Map(gardens.map((garden) => [garden.slug, garden.name]));
    const grouped = new Map<string, GardenChat[]>();
    const search = query.trim().toLocaleLowerCase();
    for (const chat of chats) {
      const name = names.get(chat.gardenId) ?? chat.gardenId;
      if (search && !`${name} ${chat.title}`.toLocaleLowerCase().includes(search)) continue;
      grouped.set(chat.gardenId, [...(grouped.get(chat.gardenId) ?? []), chat]);
    }
    return [...grouped].map(([id, rows]) => ({ id, name: names.get(id) ?? id,
      chats: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [chats, gardens, query]);

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[170] bg-black/45 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[171] flex max-h-[min(42rem,calc(100dvh-32px))] w-[min(36rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-[var(--line)] bg-[var(--paper-raised)] p-5 text-[var(--ink)] shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <Dialog.Title className="flex items-center gap-2 text-lg font-medium"><Sprout size={20} />Work in a garden</Dialog.Title>
          <Dialog.Close aria-label="Close garden picker" className="rounded-full p-2 hover:bg-[var(--paper-strong)]"><X size={18} /></Dialog.Close>
        </div>
        <Dialog.Description className="mb-4 mt-1 text-sm text-[var(--ink-muted)]">Choose a conversation to open in this chat.</Dialog.Description>
        <label className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5">
          <Search size={18} className="shrink-0 text-[var(--ink-muted)]" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search gardens and chats"
            placeholder="Search gardens and chats" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div className="min-h-32 overflow-y-auto" aria-busy={loading}>
          {loading ? <p className="p-4 text-sm text-[var(--ink-muted)]" role="status">Loading garden chats…</p>
            : error ? <div className="p-4 text-sm" role="alert">{error} <button className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
            : groups.length === 0 ? <p className="p-4 text-sm text-[var(--ink-muted)]">{query ? 'No gardens or chats match your search.' : 'No garden chats yet. Start a conversation in a garden to see it here.'}</p>
            : groups.map((group) => <section key={group.id} aria-label={group.name} className="mb-3">
              <h3 className="px-3 py-2 text-xs font-medium text-[var(--ink-muted)]">{group.name}</h3>
              {group.chats.map((chat) => <button key={chat.id} type="button" onClick={() => onSelect(chat.id)}
                aria-current={currentChatId === chat.id ? 'true' : undefined}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm outline-none hover:bg-[var(--paper-strong)] focus-visible:bg-[var(--paper-strong)]">
                <MessageSquare size={17} className="shrink-0 text-[var(--ink-muted)]" /><span className="min-w-0 flex-1 truncate">{chat.title || 'Untitled chat'}</span>
                {currentChatId === chat.id && <Check size={16} aria-label="Current chat" />}
              </button>)}
            </section>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
