import { parseClapSettings, type ClapActionSettings } from './clap-action';

export const CLAP_ACTION_CHANGED_EVENT = 'breadboard:clap-action-changed';
export const CLAP_ACTION_STORAGE_KEY = 'breadboard:clap-action-updated';
let snapshot: { userId: string; settings: ClapActionSettings } | null = null;
let revision = 0;

export function currentClapAction(userId: string): ClapActionSettings | null {
  return snapshot?.userId === userId ? snapshot.settings : null;
}

export function publishClapAction(userId: string, settings: ClapActionSettings, broadcast = true): void {
  snapshot = { userId, settings };
  revision += 1;
  window.dispatchEvent(new Event(CLAP_ACTION_CHANGED_EVENT));
  if (broadcast) {
    try { localStorage.setItem(CLAP_ACTION_STORAGE_KEY, JSON.stringify({ userId, at: Date.now(), revision })); } catch {}
  }
}

export async function loadClapAction(userId: string, signal?: AbortSignal): Promise<ClapActionSettings> {
  const startedAt = revision;
  const response = await fetch('/api/profile/clap-action', { cache: 'no-store', signal });
  const body = await response.json();
  const settings = parseClapSettings(body.settings);
  if (!response.ok || !settings) throw new Error(body.error || 'Your clap action could not be loaded.');
  // A save that finished during this read is newer than the read's response.
  if (startedAt === revision) publishClapAction(userId, settings, false);
  return currentClapAction(userId) ?? settings;
}
