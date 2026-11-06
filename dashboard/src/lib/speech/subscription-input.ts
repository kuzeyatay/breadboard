type Segment = { id: string; start: number; end: number; text: string; final: boolean };

/** The ordered media channel carries input words before the HTTP relay. Keep
 * its items and completed turns in one timeline, so a late/duplicate relay
 * cannot duplicate words or delay a confirmed voice command. */
export function createSubscriptionInput() {
  const items = new Map<string, Segment>(), turns = new Map<string, Segment>();
  let active = false, floor = -1, latest = -1;
  const covered = (item: Segment) => [...turns.values()].some(turn => item.start >= turn.start && item.end <= turn.end);
  const pending = () => [...items.values()].some(item => item.text.trim());
  const text = () => {
    const segments = [...turns.values(), ...items.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    const parts: string[] = []; let partial = '';
    for (const segment of segments) {
      if (segment.final) {
        if (partial.trim()) parts.push(partial.trim());
        partial = ''; parts.push(segment.text.trim());
      } else partial += segment.text;
    }
    if (partial.trim()) parts.push(partial.trim());
    return parts.filter(Boolean).join(' ');
  };
  return {
    get active() { return active; }, pending, text,
    // Once this connection has a usable media transcript, the relay must stay
    // ignored across holds too: its delayed previous final can arrive later.
    reset() { floor = latest; items.clear(); turns.clear(); },
    isStale(end: number | undefined) { return Number.isFinite(end) && end! <= floor; },
    accept(message: { type?: string; start_ms?: number; end_ms?: number;
      item?: { id?: string; text?: string }; turn?: { id?: string; role?: string; start_ms?: number; end_ms?: number; transcript?: string } }) {
      const final = message.type === 'turn.done' && message.turn?.role === 'user';
      const value = final ? message.turn : message.type === 'input_transcript.added' ? message : undefined;
      const id = final ? message.turn?.id : message.item?.id;
      const words = final ? message.turn?.transcript : message.item?.text;
      if (!value || !id || typeof words !== 'string' || !Number.isFinite(value.start_ms) || !Number.isFinite(value.end_ms)) return;
      const segment = { id, text: words, start: value.start_ms!, end: value.end_ms!, final };
      if (segment.end <= floor || segment.end < segment.start || (final && !active)) return;
      latest = Math.max(latest, segment.end);
      if (final) {
        const previous = turns.get(id);
        if (previous?.text === words && previous.end === segment.end) return;
        turns.set(id, segment);
        for (const [key, item] of items) if (covered(item)) items.delete(key);
      } else {
        const previous = items.get(id);
        if (covered(segment) || (previous?.text === words && previous.start === segment.start && previous.end === segment.end)) return;
        // Providers can publish an empty placeholder, then grow or correct
        // the same item. A placeholder must not take ownership away from the
        // relay, and an item's identity must not freeze its first few words.
        if (!previous && !words.trim()) return;
        active = true; items.set(id, segment);
      }
      return { text: text(), final: final && !pending() };
    },
  };
}
