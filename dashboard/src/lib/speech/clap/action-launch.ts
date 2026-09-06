import { openInDesktopTab } from '../../desktop-browser-tabs';
import { CLAP_PAGES, parseClapAction, type ClapAction } from '../../profile/clap-action';
import type { GestureControl } from './preferences';
import { openVoiceWindow } from '../voice-window';

const PREFIX = 'breadboard:gesture-launch:';
const MAX_AGE = 120_000;
export const GESTURE_LAUNCH_PARAM = 'gestureRun';
export interface GestureLaunch { userId: string; control: GestureControl; eventId: string; action: ClapAction; at: number }

export async function openGestureAction(launch: Omit<GestureLaunch, 'at'>, action: ClapAction): Promise<void> {
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
    href = action.kind === 'music' ? '/new-tab?panel=spotify&' : '/dashboard?';
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

/** The destination's Spotify dock owns and renews the actual playback lease. */
export async function waitForGesturePlayer(signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    signal.throwIfAborted();
    const response = await fetch('/api/browser/spotify', { cache: 'no-store', signal });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || "Breadboard's Spotify player is unavailable.");
    if (!state.connected) throw new Error('Connect Spotify in Settings → Connections, then try your gesture again.');
    if (state.engine?.ready && state.engine.deviceId) return;
    if (attempt === 39) throw new Error(state.engine?.error || "Breadboard's Spotify player could not start. Try again from the player.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
