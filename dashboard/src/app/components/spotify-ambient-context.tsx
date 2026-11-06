"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { spotifyAmbientStore, type SpotifyAmbientInput, type SpotifyAmbientSource } from "@/lib/spotify/ambient-store";

const SourceContext = createContext<SpotifyAmbientSource | null>(null);
const PublishContext = createContext<((source: SpotifyAmbientInput | null) => void) | null>(null);
const serverSource = () => null;

/** Share lighting across this account's Terminal pages, not playback controls. */
export function SpotifyAmbientProvider({ children, ownerKey = "local" }: { children: ReactNode; ownerKey?: string }) {
  const store = useMemo(() => spotifyAmbientStore(ownerKey), [ownerKey]);
  const source = useSyncExternalStore(store.subscribe, store.read, serverSource);
  return <PublishContext.Provider value={store.publish}><SourceContext.Provider value={source}>{children}</SourceContext.Provider></PublishContext.Provider>;
}

export function useSpotifyAmbientSource() { return useContext(SourceContext); }

/** Reuse the dock's live samples, including its optimistic pause/resume state. */
export function usePublishSpotifyAmbient(source: SpotifyAmbientInput | null, enabled = true, sampleRevision?: number) {
  const publish = useContext(PublishContext);
  const imageUrl = source?.imageUrl ?? null;
  const name = source?.name ?? "";
  const artist = source?.artist ?? "";
  const playing = source?.playing ?? false;
  const present = source !== null;
  const previous = useRef<{ publish: typeof publish; signature: string } | null>(null);
  useEffect(() => {
    if (!enabled || !publish) return;
    const next = present ? { imageUrl, name, artist, playing } : null;
    const signature = JSON.stringify([next, sampleRevision]);
    // Reactivating an old dock must not publish its stale sample over the song
    // another Terminal has already reported. Wait for a real playback change.
    if (previous.current?.publish === publish && previous.current.signature === signature) return;
    previous.current = { publish, signature };
    publish(next);
  }, [publish, enabled, present, imageUrl, name, artist, playing, sampleRevision]);
}
