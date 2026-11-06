"use client";

import { useId } from "react";
import { Check, CloudRain } from "lucide-react";
import type { RainMode } from "@/lib/page-appearance";
import { localRainIntensity } from "@/lib/local-weather-reading";
import { useRainWeather } from "./use-rain-weather";
import styles from "./page-appearance.module.css";

export default function RainAppearanceChoice({ mode, onChange }: { mode: RainMode; onChange: (mode: RainMode) => void }) {
  const labelId = useId();
  const hintId = useId();
  const code = useRainWeather(mode === "weather");
  return <div className={styles.spotifyChoice}>
    <button type="button" className={styles.spotifyButton} aria-label="Rain" aria-pressed={mode !== "off"}
      onClick={() => onChange(mode === "off" ? "on" : "off")}>
      <span className={`${styles.spotifyPreview} ${styles.rainPreview}`} aria-hidden="true"><CloudRain /></span>
      <span><strong>Rain</strong><small>Soft, animated rainfall over your background, behind everything else.</small></span>
      {mode !== "off" && <Check size={16} aria-hidden="true" />}
    </button>
    {mode !== "off" && <div className={styles.randomRow}>
      <div>
        <label id={labelId} htmlFor={`${labelId}-switch`}>Sync with local weather</label>
        <p id={hintId}>Rain only when it’s raining where you are.</p>
      </div>
      <button id={`${labelId}-switch`} type="button" role="switch" aria-checked={mode === "weather"}
        aria-labelledby={labelId} aria-describedby={hintId} className={styles.randomSwitch}
        onClick={() => onChange(mode === "weather" ? "on" : "weather")}><span aria-hidden="true" /></button>
    </div>}
    {mode === "weather" && <p className={styles.hint} role="status">
      {code === "off" ? "Enable current location in Settings to follow your weather."
        : code === "waiting" ? "Waiting for a recent local weather reading."
        : localRainIntensity(code) === "none" ? "No rain locally. The effect will return when it rains."
        : "Following the rain in your local weather."}
    </p>}
  </div>;
}
