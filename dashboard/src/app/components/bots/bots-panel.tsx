"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, MessageCircle, Plus, Settings2, Trash2 } from "lucide-react";
import type { BotDefinition, BotInput } from "@/lib/bots/types";
import { duplicateBotName } from "@/vendor/hermes-bots/identity";
import { requestChatNotificationOpen, chatNotificationHref } from "@/lib/chat-notification-inbox";
import { notifyHermesSessionsChanged } from "@/lib/hermes/session-client";
import BotAvatar from "./bot-avatar";
import BotEditor from "./bot-editor";
import LoadingRows from "../hermes/loading-rows";
import { BOTS_CHANGED_EVENT, BOTS_AUTH_CHANGED_EVENT, loadCachedBots, peekCachedBots } from "@/lib/bots/client-cache";

export { BOTS_CHANGED_EVENT } from "@/lib/bots/client-cache";
const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40";

export default function BotsPanel({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [bots, setBots] = useState<BotDefinition[]>(() => peekCachedBots() ?? []);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => peekCachedBots() === null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ id?: string; initial?: BotInput } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++loadVersion.current;
    const current = () => !signal?.aborted && version === loadVersion.current;
    setLoading(peekCachedBots() === null);
    try {
      const roster = await loadCachedBots();
      if (current()) { setBots(roster); setError(null); }
    } catch (cause) {
      if (current()) {
        const status = (cause as { status?: number } | null)?.status;
        if (status === 401 || status === 403) setBots([]);
        setError(cause instanceof Error ? cause.message : "Bots could not be loaded.");
      }
    }
    finally { if (current()) setLoading(false); }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => { void load(abort.signal); };
    const reset = () => { setBots([]); setEditor(null); setRemoving(null); refresh(); };
    refresh();
    window.addEventListener(BOTS_CHANGED_EVENT, refresh);
    window.addEventListener(BOTS_AUTH_CHANGED_EVENT, reset);
    return () => {
      abort.abort();
      loadVersion.current += 1;
      window.removeEventListener(BOTS_CHANGED_EVENT, refresh);
      window.removeEventListener(BOTS_AUTH_CHANGED_EVENT, reset);
    };
  }, [load]);
  function closeEditor() { setEditor(null); setError(null); requestAnimationFrame(() => newButton.current?.focus()); }
  async function mutate(method: string, data: unknown) {
    const response = await fetch("/api/bots", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The bot could not be updated.");
    return body;
  }
  async function save(input: BotInput) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await mutate(editor?.id ? "PATCH" : "POST", { ...input, ...(editor?.id ? { id: editor.id } : {}) }); window.dispatchEvent(new Event(BOTS_CHANGED_EVENT)); closeEditor(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The bot could not be saved."); }
    finally { setBusy(false); }
  }
  async function chat(bot: BotDefinition) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const { conversationId } = await mutate("POST", { action: "chat", id: bot.id });
      const target = { surface: "dashboard_terminal" as const, chatId: conversationId };
      notifyHermesSessionsChanged("dashboard_terminal");
      if (pathname === "/dashboard") requestChatNotificationOpen(target);
      else router.push(chatNotificationHref(target));
      onNavigate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The chat could not be opened."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError(null);
    try { await mutate("DELETE", { id }); setRemoving(null); window.dispatchEvent(new Event(BOTS_CHANGED_EVENT)); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The bot could not be removed."); }
    finally { setBusy(false); }
  }
  if (editor) return <BotEditor initial={editor.initial} editing={Boolean(editor.id)} busy={busy} error={error} onSave={input => void save(input)} onCancel={closeEditor} />;
  const visible = bots.filter(bot => `${bot.name} ${bot.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="Bots" className="space-y-4 p-1">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium text-[var(--ink-heading)]">A familiar face for every conversation</h3><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Pick a personality or make your own. Each bot keeps a dedicated chat you can return to.</p></div>
      <button ref={newButton} type="button" disabled={busy} onClick={() => { setEditor({}); setError(null); }} className="flex shrink-0 items-center gap-1 rounded-xl bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white"><Plus size={14} />New bot</button>
    </div>
    <input aria-label="Search bots" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search bots" className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]" />
    {error ? <div role="alert" className="text-sm text-[var(--danger)]">{error} <button type="button" onClick={() => void load()} className="underline">Retry</button></div> : null}
    {loading && !bots.length ? <LoadingRows label="Loading bots" /> : null}
    {([true, false] as const).map(prebuilt => {
      const group = visible.filter(bot => bot.prebuilt === prebuilt);
      if (!group.length) return null;
      return <div key={String(prebuilt)}><h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{prebuilt ? "Ready to meet you" : "Your bots"}</h4>
        <ul className="space-y-2">{group.map(bot => <li key={bot.id} className="rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-2">
          <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={() => void chat(bot)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--botanical)]" aria-label={`Chat with ${bot.name}`}>
            <BotAvatar avatar={bot.avatar} name={bot.name} size={52} />
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--ink-heading)]">{bot.name}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--ink-muted)]">{bot.description}</span></span>
          </button><button type="button" disabled={busy} aria-label={`Edit ${bot.name}`} title="Edit personality and avatar" className={iconButton} onClick={() => { setEditor({ id: bot.id, initial: bot }); setError(null); }}><Settings2 size={15} /></button></div>
          <div className="flex items-center justify-end gap-1"><button type="button" disabled={busy} aria-label={`Duplicate ${bot.name}`} title="Make your own copy" className={iconButton} onClick={() => { setEditor({ initial: { ...bot, name: duplicateBotName(bot.name, bots.map(item => item.name)) } }); setError(null); }}><Copy size={13} /></button>
            <button type="button" disabled={busy} aria-label={`Remove ${bot.name}`} title="Remove from Bots" className={iconButton} onClick={() => setRemoving(bot.id)}><Trash2 size={13} /></button>
            <button type="button" disabled={busy} onClick={() => void chat(bot)} className="ml-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] hover:bg-[var(--paper-strong)]"><MessageCircle size={13} />Open chat</button>
          </div>
          {removing === bot.id ? <div className="mt-2 rounded-xl bg-[var(--paper-raised)] p-3 text-xs"><p>Remove {bot.name} from Bots? Their saved chat stays in Recents.</p><div className="mt-2 flex justify-end gap-3"><button type="button" onClick={() => setRemoving(null)}>Cancel</button><button type="button" disabled={busy} onClick={() => void remove(bot.id)} className="text-[var(--danger)]">Remove bot</button></div></div> : null}
        </li>)}</ul>
      </div>;
    })}
    {!loading && !visible.length && !error ? <p className="py-6 text-center text-sm text-[var(--ink-muted)]">{query ? "No bots match your search." : "Create a bot to start a conversation."}</p> : null}
  </section>;
}
