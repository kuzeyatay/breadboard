import "server-only";
import { ApiError } from "../hermes/route-core.ts";
import type { SpotifyPlaybackState } from "./service.ts";

type Sample = { playback: SpotifyPlaybackState | null; receivedAt: number };
type Listener = (sample: Sample) => void;
const globalState = globalThis as typeof globalThis & {
  spotifyPlaybackEvents?: { samples: Map<number, Sample>; listeners: Map<number, Set<Listener>> };
};
const state = globalState.spotifyPlaybackEvents ??= { samples: new Map(), listeners: new Map() };
const FRESH_MS = 15_000;

/** Only authenticated engine registrations can publish local playback. */
export function publishSpotifyPlayback(userId: number, deviceId: string, value: unknown): void {
  let playback: SpotifyPlaybackState | null = null;
  if (value !== null) {
    const input = value as SpotifyPlaybackState;
    const track = input?.track;
    if (!track || typeof track.id !== "string" || !/^[A-Za-z0-9]{10,64}$/.test(track.id) ||
      track.uri !== `spotify:track:${track.id}` ||
      ![track.name, track.artist, track.album].every(text => typeof text === "string" && text.length <= 1024) ||
      !(track.imageUrl === null || (typeof track.imageUrl === "string" && track.imageUrl.length <= 2048 && /^https:\/\//.test(track.imageUrl))) ||
      !Number.isSafeInteger(track.durationMs) || track.durationMs < 0 ||
      !Number.isSafeInteger(input.positionMs) || input.positionMs < 0 || typeof input.isPlaying !== "boolean") {
      throw new ApiError(400, "invalid_spotify_playback", "The player state is invalid.");
    }
    playback = {
      track: { id: track.id, uri: track.uri, name: track.name, artist: track.artist,
        album: track.album, imageUrl: track.imageUrl, durationMs: track.durationMs },
      positionMs: Math.min(input.positionMs, track.durationMs), isPlaying: input.isPlaying,
      shuffle: input.shuffle === true, deviceId, deviceName: "Breadboard",
    };
  }
  const sample = { playback, receivedAt: Date.now() };
  for (const [id, previous] of state.samples) if (sample.receivedAt - previous.receivedAt > FRESH_MS) state.samples.delete(id);
  state.samples.set(userId, sample);
  for (const listener of state.listeners.get(userId) ?? []) listener(sample);
}

export function subscribeSpotifyPlayback(userId: number, listener: Listener): () => void {
  const listeners = state.listeners.get(userId) ?? new Set<Listener>();
  state.listeners.set(userId, listeners);
  listeners.add(listener);
  const sample = state.samples.get(userId);
  if (sample && Date.now() - sample.receivedAt <= FRESH_MS) listener(sample);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) state.listeners.delete(userId);
  };
}

export function spotifyPlaybackEventStream(userId: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  return new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const unsubscribe = subscribeSpotifyPlayback(userId, sample => {
        const elapsed = Date.now() - sample.receivedAt;
        const playback = sample.playback && { ...sample.playback,
          positionMs: Math.min(sample.playback.track.durationMs, sample.playback.positionMs + (sample.playback.isPlaying ? elapsed : 0)) };
        send(`data: ${JSON.stringify({ playback })}\n\n`);
      });
      send(": connected\n\n");
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), 10_000);
      heartbeat.unref?.();
      const abort = () => { cleanup(); controller.close(); };
      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    cancel() { cleanup(); },
  });
}
