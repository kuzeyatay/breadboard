type TurnEvent = {
  type?: string;
  end_ms?: number;
  turn?: { id?: string; role?: string; start_ms?: number; end_ms?: number };
};

/** Real received audio, excluding samples synthesized to conceal packet loss.
 * A decoder still produces silence during a network stall; those samples must
 * not advance a reading to completion. Stats counters are in codec samples,
 * not AudioContext samples. https://www.w3.org/TR/webrtc-stats/ */
function receivedAudioMs(stats: RTCStatsReport): number | undefined {
  const incoming = [...stats.values()].find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
  const rate = incoming?.codecId ? stats.get(incoming.codecId)?.clockRate : undefined;
  const samples = incoming?.totalSamplesReceived;
  const concealed = incoming?.concealedSamples;
  if (![rate, samples, concealed].every(value => typeof value === 'number' && Number.isFinite(value)) ||
      rate <= 0 || samples < 0 || concealed < 0 || concealed > samples) return undefined;
  return 1000 * (samples - concealed) / rate;
}

export function createSpeechPlayoutClock(options: { previousTurns?: ReadonlySet<string>; afterMs?: number } = {}) {
  let firstAudioAt: number | undefined;
  let start: number | undefined, end: number | undefined, turnId: string | undefined;
  let lastReceivedMs: number | undefined;
  let receivedMs = 0, measured = false;
  return {
    /** False only for an event known to belong to another reading. */
    accept(event: TurnEvent): boolean {
      const through = event.end_ms ?? event.turn?.end_ms;
      if (typeof through === 'number' && typeof options.afterMs === 'number' && through <= options.afterMs &&
          (event.type === 'output_transcript.added' || event.turn?.role === 'assistant')) return false;
      if (!['turn.created', 'turn.delta', 'turn.done'].includes(event.type ?? '') || event.turn?.role !== 'assistant') return true;
      const id = event.turn.id;
      if (id && (options.previousTurns?.has(id) || (turnId && id !== turnId))) return false;
      turnId ??= id;
      const from = event.turn.start_ms, to = event.turn.end_ms;
      if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return true;
      start = Math.min(start ?? from, from);
      end = Math.max(end ?? to, to);
      return true;
    },
    observeAudio(now: number) { firstAudioAt ??= now; },
    observeStats(stats: RTCStatsReport) {
      const current = receivedAudioMs(stats);
      if (current === undefined) return;
      measured = true;
      if (firstAudioAt !== undefined && lastReceivedMs !== undefined) receivedMs += Math.max(0, current - lastReceivedMs);
      lastReceivedMs = current;
    },
    /** Legacy transports without RTP sample counters retain nominal timing;
     * once counters are available a stalled/missing report cannot fall back to
     * wall time and incorrectly declare the remaining speech drained. */
    remainingMs(now: number): number | undefined {
      if (start === undefined || end === undefined) return undefined;
      if (firstAudioAt === undefined) return Infinity;
      const elapsed = Math.max(0, now - firstAudioAt);
      return Math.max(0, end - start - (measured ? Math.min(elapsed, receivedMs) : elapsed));
    },
  };
}
