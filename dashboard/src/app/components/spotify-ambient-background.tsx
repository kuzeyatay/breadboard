"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { RANDOM_AMBIENT_PERIOD_MS } from "@/lib/random-ambient-palette";
import type { AppearanceTheme } from "@/lib/page-appearance";
import { useSpotifyAmbientSource } from "./spotify-ambient-context";
import { useRandomAmbientPalette } from "./use-random-ambient-palette";
import styles from "./spotify-ambient-background.module.css";

function subscribeVisibility(changed: () => void) {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}
const visible = () => document.visibilityState !== "hidden";
const serverVisible = () => false;

function subscribeMotion(changed: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", changed);
  return () => preference.removeEventListener("change", changed);
}
const motionReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
type AlbumPalette = { colors: string[]; previousColors: string[] | null; paletteAt: number };

export default function SpotifyAmbientBackground({ theme, spotifyColors = true, randomColors = false }: {
  theme: AppearanceTheme; spotifyColors?: boolean; randomColors?: boolean;
}) {
  const source = useSpotifyAmbientSource();
  const backgroundRef = useRef<HTMLDivElement>(null);
  const pageVisible = useSyncExternalStore(subscribeVisibility, visible, serverVisible);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionReduced, serverVisible);
  const imageUrl = spotifyColors ? source?.imageUrl : undefined;
  // Pausing keeps the selected track and its artwork; only an absent source
  // (or unavailable artwork) should hand the background back to random colors.
  const spotifyActive = Boolean(imageUrl && source?.colors?.length);
  // Keep the outgoing album mounted even when playback clears its source, so
  // clearing the track can fade to random colors instead of deleting the lights.
  const [album, setAlbum] = useState<AlbumPalette | null>(null);
  if (source?.colors?.length && (album?.colors !== source.colors || album.paletteAt !== source.paletteAt)) {
    setAlbum({ colors: source.colors, previousColors: source.previousColors, paletteAt: source.paletteAt });
  }
  const randomPalette = useRandomAmbientPalette(true, randomColors && pageVisible && !spotifyActive, reducedMotion);
  const randomActive = randomColors && !spotifyActive;

  useLayoutEffect(() => {
    if ((!randomActive && !spotifyActive) || !pageVisible || reducedMotion) return;
    let cancelled = false;
    for (const light of backgroundRef.current?.querySelectorAll<HTMLSpanElement>("span") ?? []) {
      const randomLayer = light.parentElement?.dataset.ambientLayer === "random";
      light.getAnimations({subtree: true}).forEach(animation => {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration !== "number" || duration <= 0) return;
        // CSS does the frame-by-frame work. Seek its two movement animations
        // and palette blend to the shared clock before this tab paints.
        const align = () => {
          if (cancelled) return;
          const now = Date.now();
          const paletteAnimation = /palette/i.test((animation as CSSAnimation).animationName);
          animation.currentTime = !paletteAnimation ? now % (duration * 2)
            : randomLayer ? now % RANDOM_AMBIENT_PERIOD_MS : Math.max(0, now - (album?.paletteAt ?? now));
        };
        align();
        // A newly created CSS animation may still be waiting for its first
        // frame. Align again when the compositor has started its timeline.
        // Seeking can clear `pending` before the first start time is applied.
        // Always recheck readiness so newly joined tabs keep the same phase.
        void animation.ready.then(align).catch(() => {});
      });
    }
    return () => { cancelled = true; };
  }, [randomActive, spotifyActive, pageVisible, reducedMotion, randomPalette, album?.paletteAt]);

  // Retain the previous palette until the next cover is ready, then CSS blends
  // the colors. Playback ticks never restart the animation or sample the cover.
  const active = spotifyActive || Boolean(randomActive && randomPalette?.colors.length);
  // A visible Terminal keeps its lighting on across monitors, even without
  // input. Only a hidden page pauses; it rejoins the shared clock on return.
  const moving = active && pageVisible;
  return (
    <div ref={backgroundRef} className={styles.background} data-spotify-background data-color-source={spotifyActive ? "spotify" : randomColors ? "random" : "none"} data-random-cycle={randomActive ? randomPalette?.cycle : undefined} data-theme={theme} data-active={active} data-playing={moving} aria-hidden="true">
      {([
        { name: "random", active: randomActive, colors: randomPalette?.colors, previous: randomPalette?.previousColors, period: `${RANDOM_AMBIENT_PERIOD_MS}ms` },
        { name: "spotify", active: spotifyActive, colors: album?.colors, previous: album?.previousColors, period: "2800ms" },
      ] as const).map(layer => <div key={layer.name} className={styles.layer} data-ambient-layer={layer.name} data-active={layer.active}>
        {layer.colors?.map((color, index) => <span key={index} className={styles.light} style={{
          backgroundColor: color,
          "--ambient-previous-color": layer.previous?.[index] ?? color,
          "--ambient-current-color": color,
          "--ambient-color-period": layer.period,
        } as CSSProperties} />)}
      </div>)}
      <div className={styles.wash} />
    </div>
  );
}
