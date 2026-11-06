"use client";

import { useEffect, useRef } from "react";
import { ImageGeneration, setMaxDpr, type ImageGenerationHandle } from "img-fx";
import { useSurfaceTheme } from "./use-surface-theme";

// The mosaic needs far fewer pixels than the photograph. Keep the shader
// inexpensive on software WebGL; img-fx's separate image canvas stays sharp.
setMaxDpr(0.5);

/** Reveal once, then release the canvases and leave the full native image. */
export default function ImageGenerationReveal({
  src,
  onComplete,
}: {
  src: string;
  onComplete: () => void;
}) {
  const effect = useRef<ImageGenerationHandle>(null);
  const theme = useSurfaceTheme();

  useEffect(() => {
    effect.current?.triggerReveal({ hold: "manual" });
  }, [src]);

  return (
    <ImageGeneration
      ref={effect}
      preset="pixels-organic"
      theme={theme ?? "auto"}
      images={src}
      autoReveal={false}
      borderRadius={0}
      aria-hidden="true"
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
      onCycle={({ phase }) => {
        if (phase === "visible") onComplete();
      }}
    >
      <div style={{ width: "100%", height: "100%" }} />
    </ImageGeneration>
  );
}
