"use client";

import { paletteFromCover } from "./player-palette";

export interface SpotifyAmbientInput {
  imageUrl: string | null;
  name: string;
  artist: string;
  playing: boolean;
}
export interface SpotifyAmbientSource extends SpotifyAmbientInput {
  colors: string[] | null;
  previousColors: string[] | null;
  paletteAt: number;
  paletteImageUrl: string | null;
}
interface Sample { at: number; id: string; step: number; source: SpotifyAmbientSource | null }

const stores = new Map<string, ReturnType<typeof createStore>>();
const samePlayback = (a: SpotifyAmbientInput | null, b: SpotifyAmbientInput | null) =>
  a === b || Boolean(a && b && a.imageUrl === b.imageUrl && a.name === b.name && a.artist === b.artist && a.playing === b.playing);
const validColors = (value: unknown) => value === null || (Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(color => typeof color === "string" && /^rgb\([\d. ]+\)$/u.test(color)));
function validSample(value: unknown): value is Sample {
  if (!value || typeof value !== "object") return false;
  const sample = value as Sample;
  const source = sample.source;
  return Number.isFinite(sample.at) && typeof sample.id === "string" && (sample.step === 0 || sample.step === 1) && (source === null || Boolean(source &&
    (source.imageUrl === null || typeof source.imageUrl === "string") && typeof source.name === "string" &&
    typeof source.artist === "string" && typeof source.playing === "boolean" && Number.isFinite(source.paletteAt) &&
    (source.paletteImageUrl === null || typeof source.paletteImageUrl === "string") && validColors(source.colors) && validColors(source.previousColors)));
}

function createStore(ownerKey: string) {
  let current: Sample | null = null;
  let channel: BroadcastChannel | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const apply = (sample: Sample) => {
    if (current && (sample.at < current.at || (sample.at === current.at && sample.id < current.id))) return;
    if (current?.id === sample.id && sample.step < current.step) return;
    if (JSON.stringify(sample) === JSON.stringify(current)) return;
    current = sample;
    notify();
  };
  const send = (sample: Sample) => { apply(sample); channel?.postMessage({ type: "sample", sample }); };
  return {
    read: () => current?.source ?? null,
    subscribe: (listener: () => void) => {
      clearTimeout(releaseTimer);
      listeners.add(listener);
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`breadboard:spotify-ambient:${ownerKey}`);
        channel.onmessage = event => {
          if (event.data?.type === "request" && current) channel?.postMessage({ type: "sample", sample: current });
          else if (event.data?.type === "sample" && validSample(event.data.sample)) apply(event.data.sample);
        };
        if (current) channel.postMessage({ type: "sample", sample: current });
        channel.postMessage({ type: "request" });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) releaseTimer = setTimeout(() => {
          if (!listeners.size) { channel?.close(); channel = null; current = null; }
        }, 0);
      };
    },
    publish: (input: SpotifyAmbientInput | null) => {
      if (current && samePlayback(current.source, input)) return;
      const before = current?.source;
      const sameImage = before?.paletteImageUrl === input?.imageUrl;
      const sample: Sample = {
        at: Math.max(Date.now(), (current?.at ?? 0) + 1), id: crypto.randomUUID(), step: 0,
        source: input ? { ...input,
          colors: input.imageUrl ? before?.colors ?? null : null,
          previousColors: before?.previousColors ?? null,
          paletteAt: before?.paletteAt ?? 0,
          paletteImageUrl: before?.paletteImageUrl ?? null,
        } : null,
      };
      send(sample);
      if (!input?.imageUrl || (sameImage && before?.colors)) return;
      // One publisher samples the artwork; peers reuse both its colors and the
      // blend timestamp. Late image loads cannot replace a newer song.
      void paletteFromCover(input.imageUrl).then(palette => {
        if (current?.id !== sample.id || !sample.source) return;
        send({ ...sample, step: 1, source: { ...sample.source, colors: palette.ambientColors,
          previousColors: before?.colors ?? palette.ambientColors, paletteAt: Date.now(), paletteImageUrl: input.imageUrl } });
      }).catch(() => {
        if (current?.id === sample.id && sample.source) send({ ...sample, step: 1, source: { ...sample.source, colors: null, previousColors: null, paletteImageUrl: null } });
      });
    },
  };
}

/** Palette transport only: never changes playback or starts a Spotify poller.
 * No persisted playing state can leak into a later desktop session. */
export function spotifyAmbientStore(ownerKey: string) {
  const key = ownerKey.trim().toLowerCase();
  let store = stores.get(key);
  if (!store) { store = createStore(key); stores.set(key, store); }
  return store;
}
