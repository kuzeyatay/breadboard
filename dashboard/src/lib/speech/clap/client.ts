import { DEFAULT_CLAP_PREFERENCES, DEFAULT_SNAP_PREFERENCES, controlQuery, parseClapPreferences, type ClapPreferences, type GestureControl } from './preferences';
import { DEFAULT_CLAP_ACTION, DEFAULT_SNAP_ACTION, parseClapSettings, type ClapActionSettings } from '@/lib/profile/clap-action';
import type { ClapMeter, CaptureStatus } from './capture';
import type { MicrophoneFix } from '../microphone-access';
export type ClapRuntimeStatus = 'off' | 'paused' | 'error' | CaptureStatus;
export interface ClapSnapshot {
  userId: string; loaded: boolean; preferences: ClapPreferences; action: ClapActionSettings;
  active: boolean; status: ClapRuntimeStatus; issue: string | null; fix: MicrophoneFix | null;
  pauseReason: string | null; snapPauseReason: string | null;
  mode: 'actions' | 'test' | 'calibration'; gestures: number; meter: ClapMeter | null;
  weakestImpulse?: number;
  modeOwner?: string;
  snapPreferences: ClapPreferences; snapAction: ClapActionSettings; snapActive: boolean;
  snapMeter: ClapMeter | null; snapGestures: number; snapWeakestImpulse?: number;
  testControl: GestureControl;
}
const initial: ClapSnapshot = { userId: '', loaded: false, preferences: DEFAULT_CLAP_PREFERENCES,
  action: DEFAULT_CLAP_ACTION, active: false, status: 'off', issue: null, fix: null, pauseReason: null, snapPauseReason: null, mode: 'actions', gestures: 0, meter: null,
  snapPreferences: DEFAULT_SNAP_PREFERENCES, snapAction: DEFAULT_SNAP_ACTION, snapActive: false, snapMeter: null, snapGestures: 0, testControl: 'clap' };
type Store = { snapshot: ClapSnapshot; listeners: Set<() => void>; channel?: BroadcastChannel; generation: number };
function store(): Store {
  const host = globalThis as typeof globalThis & { __breadboardClapControls?: Store };
  const s = host.__breadboardClapControls ??= { snapshot: initial, listeners: new Set(), generation: 0 };
  if (!s.snapshot.snapPreferences) s.snapshot = { ...initial, ...s.snapshot };
  return s;
}
export const clapSnapshot = () => store().snapshot;
export const clapServerSnapshot = () => initial;
export function gestureSettings(s: ClapSnapshot, control: GestureControl = 'clap') {
  return control === 'snap' ? { preferences: s.snapPreferences, action: s.snapAction, active: s.snapActive,
    gestures: s.snapGestures, meter: s.snapMeter, weakestImpulse: s.snapWeakestImpulse, pauseReason: s.snapPauseReason } : s;
}
export function subscribeClapControls(listener: () => void) { store().listeners.add(listener); return () => { store().listeners.delete(listener); }; }
export function updateClapRuntime(patch: Partial<ClapSnapshot>) {
  const s = store();
  if (Object.entries(patch).every(([k, v]) => s.snapshot[k as keyof ClapSnapshot] === v)) return;
  s.snapshot = { ...s.snapshot, ...patch }; for (const listener of s.listeners) listener();
}
function channel() {
  const s = store();
  if (!s.channel && typeof BroadcastChannel !== 'undefined') {
    s.channel = new BroadcastChannel('breadboard:clap-controls');
    s.channel.onmessage = event => {
      const m = event.data;
      if (m?.userId !== s.snapshot.userId) return;
      if (m.type === 'settings') void loadClapControls().catch(() => {});
      // A peer's status refresh must never turn a local test into live actions.
      if (m.type === 'active' && typeof m.active === 'boolean') {
        const control: GestureControl = m.control === 'snap' ? 'snap' : 'clap';
        const active = m.active && gestureSettings(s.snapshot, control).preferences.enabled;
        updateClapRuntime({ ...(control === 'snap' ? { snapActive: active } : { active }), issue: null,
          ...(!m.active && s.snapshot.testControl === control ? { mode: 'actions' as const, modeOwner: undefined } : {}),
        });
      }
      if (m.type === 'state-request') for (const control of ['clap', 'snap'] as const) {
        if (gestureSettings(s.snapshot, control).active) s.channel?.postMessage({ type: 'active', userId: s.snapshot.userId, control, active: true });
      }
    };
  }
  return s.channel;
}
export async function loadClapControls(signal?: AbortSignal) {
  const generation = ++store().generation;
  const response = await fetch('/api/speech/clap-controls', { cache: 'no-store', signal });
  if (response.status === 401) {
    if (!signal?.aborted && generation === store().generation) updateClapRuntime({ ...initial, loaded: true, modeOwner: undefined, weakestImpulse: undefined });
    return;
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Clap settings could not load.');
  const preferences = parseClapPreferences(body.preferences), action = parseClapSettings(body.action);
  const snapPreferences = body.snapPreferences === undefined ? DEFAULT_SNAP_PREFERENCES : parseClapPreferences(body.snapPreferences);
  const snapAction = body.snapAction === undefined ? DEFAULT_SNAP_ACTION : parseClapSettings(body.snapAction);
  if (!preferences || !action || !snapPreferences || !snapAction || typeof body.userId !== 'string') throw new Error('Gesture settings could not be read.');
  if (signal?.aborted || generation !== store().generation) return;
  const same = clapSnapshot().userId === body.userId && clapSnapshot().loaded;
  updateClapRuntime({ userId: body.userId, loaded: true, preferences, action, snapPreferences, snapAction,
    active: preferences.enabled && (same ? clapSnapshot().active : preferences.resumeOnStartup),
    snapActive: snapPreferences.enabled && (same ? clapSnapshot().snapActive : snapPreferences.resumeOnStartup) });
  channel()?.postMessage({ type: 'state-request', userId: body.userId });
}
export async function saveClapPreferences(preferences: ClapPreferences, active = clapSnapshot().active, control: GestureControl = 'clap') {
  const response = await fetch(`/api/speech/clap-controls${controlQuery(control)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) });
  const body = await response.json(); const saved = parseClapPreferences(body.preferences);
  if (!response.ok || !saved) throw new Error(body.error || 'Clap settings could not save.');
  store().generation++;
  updateClapRuntime({ ...(control === 'snap' ? { snapPreferences: saved, snapActive: saved.enabled && active } : { preferences: saved, active: saved.enabled && active }), issue: null, fix: null });
  channel()?.postMessage({ type: 'settings', userId: clapSnapshot().userId });
  channel()?.postMessage({ type: 'active', userId: clapSnapshot().userId, control, active: saved.enabled && active });
}
export function pauseClapControls(control: GestureControl = 'clap') {
  updateClapRuntime({ ...(control === 'snap' ? { snapActive: false } : { active: false }),
    ...(clapSnapshot().testControl === control ? { mode: 'actions' as const, modeOwner: undefined } : {}), issue: null });
  channel()?.postMessage({ type: 'active', userId: clapSnapshot().userId, control, active: false });
}
export function pauseGestureControls() { pauseClapControls(); pauseClapControls('snap'); }
export function setClapTestMode(mode: ClapSnapshot['mode'], modeOwner?: string, testControl: GestureControl = 'clap') {
  updateClapRuntime({ mode, modeOwner, testControl, gestures: 0, snapGestures: 0, meter: null, snapMeter: null, weakestImpulse: undefined, snapWeakestImpulse: undefined, issue: null });
}
export function finishClapTest(owner: string) {
  if (clapSnapshot().modeOwner === owner) setClapTestMode('actions');
}
export async function saveClapAction(settings: ClapActionSettings, control: GestureControl = 'clap') {
  const response = await fetch(`/api/profile/clap-action${controlQuery(control)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  const body = await response.json(); const action = parseClapSettings(body.settings);
  if (!response.ok || !action) throw new Error(body.error || 'Clap action could not save.');
  store().generation++; updateClapRuntime(control === 'snap' ? { snapAction: action } : { action }); channel()?.postMessage({ type: 'settings', userId: clapSnapshot().userId });
}
