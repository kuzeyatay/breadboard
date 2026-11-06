"use client";

import { useState } from "react";
import { BOT_SHAPES, DEFAULT_BOT_AVATAR, type BotInput } from "@/lib/bots/types";
import BotAvatar from "./bot-avatar";

const control = "mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]";

export default function BotEditor({ initial, editing, busy, error, onSave, onCancel }: {
  initial?: BotInput; editing: boolean; busy: boolean; error: string | null;
  onSave: (input: BotInput) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BotInput>(initial ?? { name: "", description: "", personality: "", avatar: { ...DEFAULT_BOT_AVATAR } });
  const [preview, setPreview] = useState<"default" | "working" | "sleeping">("working");
  return <form className="space-y-4 p-1" aria-label={editing ? "Edit bot" : "Create bot"} onSubmit={event => { event.preventDefault(); if (!busy) onSave(draft); }}>
    <div className="flex items-center justify-between">
      <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-2 py-1 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]">← Bots</button>
      <h3 className="text-sm font-medium text-[var(--ink-heading)]">{editing ? "Edit bot" : "Create a bot"}</h3>
    </div>
    <div className="flex items-center gap-4 rounded-2xl bg-[var(--paper-surface)] px-4 py-3">
      <BotAvatar avatar={draft.avatar} name={draft.name || "Your bot"} size={76} state={preview} />
      <div className="min-w-0 flex-1"><p className="truncate font-medium text-[var(--ink-heading)]">{draft.name || "Your bot"}</p>
        <label className="mt-1 block text-xs text-[var(--ink-muted)]">Preview activity
          <select aria-label="Preview activity" value={preview} onChange={event => setPreview(event.target.value as typeof preview)} className={control}>
            <option value="default">Ready</option><option value="working">Thinking</option><option value="sleeping">Resting</option>
          </select>
        </label>
      </div>
    </div>
    <label className="block text-xs font-medium text-[var(--ink)]">Name
      <input className={control} autoFocus required maxLength={60} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Luna" />
    </label>
    <label className="block text-xs font-medium text-[var(--ink)]">Short description
      <input className={control} maxLength={180} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What makes this bot yours?" />
    </label>
    <label className="block text-xs font-medium text-[var(--ink)]">Personality
      <textarea aria-label="Personality" className={`${control} min-h-36 resize-y leading-6`} required maxLength={6000} value={draft.personality} onChange={e => setDraft({ ...draft, personality: e.target.value })} placeholder="Describe their voice, interests, manner, and how they should help you." />
    </label>
    <fieldset><legend className="mb-2 text-xs font-medium text-[var(--ink)]">Avatar shape</legend>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
        {BOT_SHAPES.map(shape => <button key={shape} type="button" aria-label={`${shape} avatar`} aria-pressed={draft.avatar.shape === shape}
          onClick={() => setDraft({ ...draft, avatar: { ...draft.avatar, shape } })}
          className={`flex flex-col items-center rounded-xl border px-1 py-2 focus-visible:outline-2 focus-visible:outline-[var(--botanical)] ${draft.avatar.shape === shape ? "border-[var(--botanical)] bg-[var(--paper-strong)]" : "border-transparent hover:bg-[var(--paper-surface)]"}`}>
          <BotAvatar avatar={{ ...draft.avatar, shape }} name={shape} size={38} paused /><span className="mt-1 text-[10px] capitalize text-[var(--ink-muted)]">{shape}</span>
        </button>)}
      </div>
    </fieldset>
    <div className="grid grid-cols-2 gap-4">
      <label className="text-xs font-medium text-[var(--ink)]">Color<input aria-label="Avatar color" type="color" className="mt-1 block h-10 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent" value={draft.avatar.color} onChange={e => setDraft({ ...draft, avatar: { ...draft.avatar, color: e.target.value } })} /></label>
      <label className="text-xs font-medium text-[var(--ink)]">Face<select aria-label="Avatar face" className={control} value={draft.avatar.face} onChange={e => setDraft({ ...draft, avatar: { ...draft.avatar, face: e.target.value as "eyes" | "mouth" } })}><option value="eyes">Eyes</option><option value="mouth">Eyes and mouth</option></select></label>
    </div>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <p className="text-xs leading-5 text-[var(--ink-muted)]">Personality changes apply to the next message. Your bot uses the chat’s selected model and existing tool permissions.</p>
    <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 py-2 text-sm hover:bg-[var(--paper-strong)]">Cancel</button>
      <button type="submit" disabled={busy || !draft.name.trim() || !draft.personality.trim()} className="rounded-xl bg-[var(--botanical)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : editing ? "Save changes" : "Create bot"}</button>
    </div>
  </form>;
}
