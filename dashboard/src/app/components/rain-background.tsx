"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import type { AppearanceTheme, RainMode } from "@/lib/page-appearance";
import { localRainIntensity } from "@/lib/local-weather-reading";
import { useRainWeather } from "./use-rain-weather";
import styles from "./rain-background.module.css";

function subscribeVisibility(changed: () => void) {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}
const visible = () => document.visibilityState !== "hidden";
const serverVisible = () => false;
// Stable, dispersed drops avoid hydration changes and per-frame React updates.
const drops = Array.from({ length: 72 }, (_, index) => ({
  left: `${(index * 61.8034) % 100}%`,
  "--rain-length": `${18 + (index * 7) % 23}px`,
  "--rain-duration": `${1.25 + ((index * 13) % 12) / 10}s`,
  "--rain-delay": `${-((index * 17) % 53) / 10}s`,
  "--rain-opacity": 0.22 + ((index * 7) % 10) / 25,
} as CSSProperties));

export default function RainBackground({ mode, theme }: { mode: RainMode; theme: AppearanceTheme }) {
  const code = useRainWeather(mode === "weather");
  const pageVisible = useSyncExternalStore(subscribeVisibility, visible, serverVisible);
  const intensity = mode === "on" ? "steady" : mode === "weather" ? localRainIntensity(code) : "none";
  return <div className={styles.rain} data-rain-background data-theme={theme} data-intensity={intensity}
    data-active={intensity !== "none"} data-moving={pageVisible && intensity !== "none"} aria-hidden="true">
    {drops.map((style, index) => <span key={index} className={styles.drop} style={style} />)}
  </div>;
}
