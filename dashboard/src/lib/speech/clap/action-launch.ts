import { openInDesktopTab } from '../../desktop-browser-tabs';
import { CLAP_PAGES, parseClapAction, type ClapAction } from '../../profile/clap-action';
import type { GestureControl } from './preferences';
import { openVoiceWindow } from '../voice-window';

const PREFIX = 'breadboard:gesture-launch:';
const MAX_AGE = 120_000;
export const GESTURE_LAUNCH_PARAM = 'gestureRun';
export interface GestureLaunch { userId: string; control: GestureControl; eventId: string; action: ClapAction; at: number }

export async function openGestureAction(launch: Omit<GestureLaunch, 'at'>, action: ClapAction): Promise<void> {
  if (action.kind === 'music') throw new Error('Music gestures must use the background player.');
  if (action.kind === 'voice') { await openVoiceWindow(); return; }
  const token = crypto.randomUUID();
  let href: string;
  if (action.kind === 'page') href = CLAP_PAGES[action.page].href;
  else if (action.kind === 'workflow') href = `/workflows?workflow=${encodeURIComponent(action.workflowId)}&clapReview=1`;
  else {
    // The URL contains only a one-use handoff ID, never a request to execute.
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PREFIX)) continue;
      try { if (Date.now() - JSON.parse(localStorage.getItem(key)!).at <= MAX_AGE) continue; } catch {}
      localStorage.removeItem(key);
    }
    localStorage.setItem(PREFIX + token, JSON.stringify({ ...launch, at: Date.now() }));
    href = '/dashboard?';
    href += `${GESTURE_LAUNCH_PARAM}=${token}`;
  }
  try {
    if (await openInDesktopTab(href)) return;
    const tab = window.open(href, '_blank');
    if (tab) { tab.opener = null; tab.focus(); return; }
    // Ambient audio is not a browser activation gesture. If popups are blocked,
    // still carry out the action on its destination without a manual setup step.
    window.location.assign(href);
  } catch (error) { localStorage.removeItem(PREFIX + token); throw error; }
}

/** Called only by the foreground, authenticated destination after settings load. */
export function takeGestureLaunch(userId: string): GestureLaunch | null {
  const url = new URL(location.href);
  const token = url.searchParams.get(GESTURE_LAUNCH_PARAM);
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null;
  const raw = localStorage.getItem(PREFIX + token);
  localStorage.removeItem(PREFIX + token);
  url.searchParams.delete(GESTURE_LAUNCH_PARAM);
  history.replaceState(history.state, '', url);
  try {
    const row = JSON.parse(raw ?? 'null');
    const action = parseClapAction(row?.action);
    if (!action || row.userId !== userId || !['clap', 'snap'].includes(row.control) ||
      typeof row.at !== 'number' || Date.now() - row.at < 0 || Date.now() - row.at > MAX_AGE ||
      typeof row.eventId !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(row.eventId)) return null;
    return { ...row, action };
  } catch { return null; }
}

/** The listener owns the lease, so music works even on pages without a dock. */
export function gestureMusicPlayer(lifecycle: AbortSignal) {
  const viewId = crypto.randomUUID();
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewing: Promise<unknown> | null = null;
  const renew = (signal: AbortSignal) => {
    renewing ??= fetch('/api/hermes/connections/spotify/engine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewId }), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }).then(async response => {
      const engine = await response.json();
      if (!response.ok) throw new Error(engine.message || engine.error || "Breadboard's Spotify player could not start.");
      return engine;
    }).finally(() => { renewing = null; });
    return renewing;
  };
  lifecycle.addEventListener('abort', () => {
    clearInterval(timer);
    if (timer === undefined) return;
    void fetch('/api/hermes/connections/spotify/engine', { method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewId }), keepalive: true }).catch(() => {});
  }, { once: true });
  return async (signal: AbortSignal) => {
    signal = AbortSignal.any([signal, lifecycle]);
    signal.throwIfAborted();
    // Check the account before acquiring an audio runtime.
    const response = await fetch('/api/hermes/connections/spotify', { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    const state = await response.json();
    if (!response.ok) throw new Error(state.message || state.error || 'Spotify is unavailable.');
    if (!state.connected) throw new Error('Connect Spotify in Settings → Connections, then try your gesture again.');
    if (timer === undefined) timer = setInterval(() => { void renew(lifecycle).catch(() => {}); }, 20_000);
    const engine = await renew(signal) as { ready?: boolean; deviceId?: string };
    signal.throwIfAborted();
    if (!engine.ready || !engine.deviceId) await waitForGesturePlayer(signal);
  };
}

export async function waitForGesturePlayer(signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    signal.throwIfAborted();
    const response = await fetch('/api/hermes/connections/spotify/engine', { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || "Breadboard's Spotify player is unavailable.");
    if (state.ready && state.deviceId) return;
    if (attempt === 39) throw new Error(state.error || "Breadboard's Spotify player could not start. Try again from the player.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
