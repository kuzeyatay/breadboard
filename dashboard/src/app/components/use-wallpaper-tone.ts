"use client";

import { useEffect, useState } from "react";
import type { AppearanceTheme } from "@/lib/page-appearance";
import { sampleWallpaperTone } from "@/lib/wallpaper-tone";

export function useWallpaperTone(src: string | undefined, fallback: AppearanceTheme): AppearanceTheme {
  const [sample, setSample] = useState<{ src: string; tone: AppearanceTheme } | null>(null);
  useEffect(() => {
    if (!src) return;
    let active = true;
    void sampleWallpaperTone(src).then((tone) => {
      if (active && tone) setSample({ src, tone });
    });
    return () => { active = false; };
  }, [src]);
  // A slow previous image must never supply the current background's color.
  return sample && sample.src === src ? sample.tone : fallback;
}
