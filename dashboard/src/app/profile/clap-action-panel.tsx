'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_CLAP_ACTION, DEFAULT_SNAP_ACTION, MAX_CLAP_PROMPT, actionForGesturePrompt, describeClapAction, type ClapActionSettings } from '@/lib/profile/clap-action';
import { publishClapAction } from '@/lib/profile/clap-action-client';
import { type GestureControl } from '@/lib/speech/clap/preferences';
import SettingsClapControls from '@/app/components/settings-clap-controls';
import { clapSnapshot, clapServerSnapshot, gestureSettings, subscribeClapControls, saveClapAction } from '@/lib/speech/clap/client';

export default function ClapActionPanel({ initial, userId, control = 'clap' }: { initial: ClapActionSettings; userId: string; control?: GestureControl }) {
  const snap = control === 'snap';
  const gestureWord = snap ? 'snap' : 'clap';
  const [saved, setSaved] = useState(initial);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [busy, setBusy] = useState<'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const controls = useSyncExternalStore(subscribeClapControls, clapSnapshot, clapServerSnapshot);
  const binding = gestureSettings(controls, control);
  useEffect(() => () => requestRef.current?.abort(), []);

  function edit(value: string) {
    requestRef.current?.abort();
    setBusy(null); setPrompt(value); setError(null); setNotice(null);
  }

  async function save(settings: ClapActionSettings) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy('save'); setError(null); setNotice(null);
    try {
      await saveClapAction(settings, control);
      const next = gestureSettings(clapSnapshot(), control).action;
      if (controller.signal.aborted) return;
      setSaved(next); setPrompt(next.prompt);
      if (!snap) publishClapAction(userId, next);
      setNotice(gestureSettings(clapSnapshot(), control).active
        ? `Saved. Your next ${gestureWord} gesture will use this instruction.`
        : `Saved. Turn on ${snap ? 'Finger-snap' : 'Clap'} controls to use this action.`);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The clap action could not be saved.');
    } finally { if (requestRef.current === controller) setBusy(null); }
  }

  return (
    <div className="space-y-4"><SettingsClapControls control={control} /><section id={`${control}-action`} className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Describe your {gestureWord} action</h2>
          <p className="mt-0.5 text-xs text-gray-500">Save what should happen. Each gesture opens the action in a new tab.</p>
        </div>
      </header>
      <p className="text-xs text-gray-500">Current action</p>
      <p className="mt-1 text-sm text-gray-200" data-clap-current={!snap ? '' : undefined} data-snap-current={snap ? '' : undefined}>{describeClapAction(controls.loaded ? binding.action.action : saved.action)}</p>
      <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (prompt.trim() && !busy) void save({ prompt: prompt.trim(), action: actionForGesturePrompt(prompt) }); }}>
        <label className="block text-xs text-gray-400" htmlFor={`${control}-prompt`}>When I {gestureWord}…</label>
        <textarea id={`${control}-prompt`} rows={3} value={prompt} maxLength={MAX_CLAP_PROMPT} disabled={busy === 'save'} onChange={event => edit(event.target.value)} placeholder="Play a random song, open my calendar, or ask the assistant to help with a task…" className="w-full resize-y rounded-lg border border-gray-800 bg-transparent px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-gray-600 focus:outline-none" />
        <div className="flex flex-wrap gap-2">
          {[snap ? 'Play Snap by manifest' : 'Open the voice assistant', 'Play a random song', 'Open my calendar'].map(example => (
            <button key={example} type="button" disabled={busy === 'save'} onClick={() => edit(example)} className="rounded-full border border-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-50">{example}</button>
          ))}
        </div>
        <button type="submit" disabled={!prompt.trim() || Boolean(busy)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-white/15 disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save action'}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-green-500">{notice}</p>}
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-gray-800 pt-3">
        <p className="text-xs text-gray-500">For other requests, the agent chooses the tools and opens a chat where you can follow its progress.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void save(snap ? DEFAULT_SNAP_ACTION : DEFAULT_CLAP_ACTION)} className="shrink-0 text-xs text-gray-400 underline underline-offset-2 disabled:opacity-50">{snap ? 'Restore Snap by manifest' : 'Restore dictation default'}</button>
      </div>
    </section></div>
  );
}
