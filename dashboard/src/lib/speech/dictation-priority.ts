/** A short, renewable priority lease for hold-to-dictate. Unlike ordinary
 * audio focus, this explicitly asks open conversations to pause too. */
export const DICTATION_PRIORITY_CHANNEL = 'breadboard:dictation-priority';
const listeners = new Set<() => void>(), peers = new Map<string, number>(), standbyPeers = new Map<string, number>();
const id = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'server';
let holds = 0, standby = 0, channel: BroadcastChannel | undefined;
const changed = () => { for (const listener of listeners) listener(); };
const publish = () => channel?.postMessage({ id, holds, standby });
function connect() {
  if (channel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(DICTATION_PRIORITY_CHANNEL);
  channel.onmessage = event => {
    if (event.data === 'query') { publish(); return; }
    if (typeof event.data?.id !== 'string') return;
    if (event.data.holds > 0) peers.set(event.data.id, Date.now() + 15000);
    else peers.delete(event.data.id);
    if (event.data.standby > 0) standbyPeers.set(event.data.id, Date.now() + 15000);
    else standbyPeers.delete(event.data.id);
    changed();
  };
  channel.postMessage('query');
  window.setInterval(() => {
    if (holds || standby) publish();
    for (const [peer, until] of peers) if (until < Date.now()) { peers.delete(peer); changed(); }
    for (const [peer, until] of standbyPeers) if (until < Date.now()) { standbyPeers.delete(peer); changed(); }
  }, 5000);
  window.addEventListener('pagehide', () => channel?.postMessage({ id, holds: 0, standby: 0 }));
}
export function dictationHasPriority() { return holds > 0 || [...peers.values()].some(until => until > Date.now()); }
/** Reserve one idle provider slot without pausing voice, wake words or ambient capture. */
export function dictationStandbyReserved() { return standby > 0 || [...standbyPeers.values()].some(until => until > Date.now()); }
export function reserveDictationStandby() {
  connect(); standby++; publish(); changed();
  let released = false;
  return () => { if (released) return; released = true; standby--; publish(); changed(); };
}
export function watchDictationPriority(listener: () => void) {
  connect(); listeners.add(listener); listener();
  return () => { listeners.delete(listener); };
}
export function holdDictationPriority() {
  connect(); holds++; publish(); changed();
  let released = false;
  return () => { if (released) return; released = true; holds--; publish(); changed(); };
}
