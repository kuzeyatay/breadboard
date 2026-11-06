"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const ImageGenerationReveal = dynamic(() => import("../effects/image-generation-reveal"), {
  ssr: false,
});

// Virtualized transcript rows may remount when scrolling. A displayed image
// must not disappear into another reveal when its row comes back into view.
const seenImages = new Set<string>();
function rememberImage(src: string) {
  seenImages.add(src);
  if (seenImages.size > 256) seenImages.delete(seenImages.values().next().value!);
}

class OptionalImageEffect extends Component<{
  children: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

interface Props {
  src: string;
  title: string;
  animate: boolean;
}

function ImagePreview({
  src,
  title,
  animate,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "revealing" | "visible" | "failed">(
    () => animate && !seenImages.has(src) ? "loading" : "visible",
  );
  const finishReveal = useCallback(() => {
    rememberImage(src);
    setPhase("visible");
  }, [src]);
  const visible = phase === "visible" || phase === "failed";

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    // Fetch once, then share the decoded source with the native image and
    // WebGL effect. Desktop routes this read outside its busy stream pool.
    // A blob also stays origin-clean when the desktop transport redirects.
    void fetch(src, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Image preview failed (${response.status})`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => { if (!controller.signal.aborted) setPhase("failed"); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { if (media.matches) finishReveal(); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [finishReveal]);

  useEffect(() => {
    if (phase !== "ready" || !container.current) return;
    // Artifact rows can mount below the viewport. Start only when the user
    // can see the card, rather than spending its one reveal offscreen.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setPhase("revealing");
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing") return;
    // Own the deadline outside the lazy effect so even a stalled chunk import
    // or unavailable WebGL context releases the native image.
    const timeout = window.setTimeout(finishReveal, 6_000);
    return () => window.clearTimeout(timeout);
  }, [phase, finishReveal]);

  return (
    <div ref={container} className="neu-inset relative block w-full overflow-hidden bg-[var(--paper-bg)]" aria-busy={phase !== "failed" && (!visible || !imageUrl)}
      style={{ minHeight: imageUrl || phase === "failed" ? undefined : 240 }}>
      {/* Reserve the natural aspect ratio, but never paint the photo before
          its reveal. The final frame hands off to this same native image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {imageUrl && <img
        src={imageUrl}
        alt={title}
        className="block h-auto w-full object-contain"
        style={{ opacity: visible ? 1 : 0 }}
        loading="eager"
        onLoad={() => {
          if (phase !== "loading") return;
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finishReveal();
          else setPhase("ready");
        }}
        onError={() => setPhase("failed")}
      />}
      {phase === "failed" && (
        <p className="p-4 text-sm text-[var(--ink-muted)]">Image preview unavailable. Open the artifact to view it.</p>
      )}
      {phase === "revealing" && imageUrl && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <OptionalImageEffect onError={finishReveal}>
            <ImageGenerationReveal src={imageUrl} onComplete={finishReveal} />
          </OptionalImageEffect>
        </div>
      )}
    </div>
  );
}

export default function ArtifactImagePreview(props: Props) {
  return <ImagePreview key={props.src} {...props} />;
}
