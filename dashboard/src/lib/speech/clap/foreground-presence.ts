/** Prefer a foreground detector, with the existing Web Lock enforcing one capture. */
export function gestureForegroundPresence(current: () => { userId: string; foreground: boolean }, changed: () => void) {
  const id = crypto.randomUUID();
  const peers = new Map<string, { userId: string; until: number }>();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('breadboard:gesture-foreground');
  let previous = '';
  function publish(force = false) {
    const value = current(), key = JSON.stringify(value);
    if (!force && key === previous) return;
    previous = key;
    channel?.postMessage({ id, ...value });
  }
  if (channel) {
    channel.onmessage = event => {
      const value = event.data;
      if (value === 'query') { publish(true); return; }
      if (!value || typeof value.id !== 'string' || typeof value.userId !== 'string' || typeof value.foreground !== 'boolean') return;
      if (value.foreground) peers.set(value.id, { userId: value.userId, until: Date.now() + 15_000 });
      else peers.delete(value.id);
      changed();
    };
    channel.postMessage('query');
  }
  const timer = window.setInterval(() => {
    publish(true);
    for (const [peer, value] of peers) if (value.until < Date.now()) peers.delete(peer);
    changed();
  }, 5000);
  const leave = () => channel?.postMessage({ id, userId: current().userId, foreground: false });
  window.addEventListener('pagehide', leave);
  return {
    publish,
    hasForegroundPeer: () => [...peers.values()].some(value => value.userId === current().userId && value.until > Date.now()),
    close() { window.clearInterval(timer); window.removeEventListener('pagehide', leave); leave(); channel?.close(); },
  };
}
