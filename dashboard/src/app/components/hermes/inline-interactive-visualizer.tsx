"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { artifactUrl } from "./artifact-viewer";

interface Props {
  artifact: PresentedArtifact;
}

const PROTOCOL = "breadboard:interactive-visualizer:v1";
const INITIAL_INLINE_HEIGHT = 420;
const MIN_INLINE_HEIGHT = 280;
const MAX_INLINE_HEIGHT = 1_200;

function currentTheme(): "dark" | "light" {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "light" || explicitTheme === "dark") {
    return explicitTheme;
  }
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The same sandboxed artifact preview used by the full viewer, presented as a
 * natural continuation of the assistant response instead of a nested card.
 * Its compact artifact card remains a separate sibling below the embed.
 */
export default function InlineInteractiveVisualizer({ artifact }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // A large initial viewport becomes a false content measurement in older
  // visualizers whose document is min-height: 100%. Start near the compact
  // inline size; genuinely taller content will report its scroll height.
  const [height, setHeight] = useState(INITIAL_INLINE_HEIGHT);
  const instanceId = useId();
  const channel = `${artifact.id}:${artifact.version}:${instanceId}`;
  const previewUrl = `${artifactUrl(artifact, "preview")}&channel=${encodeURIComponent(channel)}`;

  useEffect(() => {
    const ownedFrame = frameRef.current;
    const sendContext = () => {
      const target = frameRef.current?.contentWindow;
      target?.postMessage({
        protocol: PROTOCOL,
        type: "host-theme",
        channel,
        theme: currentTheme(),
      }, "*");
      target?.postMessage({
        protocol: PROTOCOL,
        type: "host-presentation",
        channel,
        presentation: "inline",
      }, "*");
    };
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      const data = event.data as Record<string, unknown> | null;
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== "null" ||
        !data ||
        data.protocol !== PROTOCOL ||
        data.channel !== channel
      ) return;
      if (data.type === "ready") sendContext();
      if (data.type === "ready" || data.type === "resize") {
        const nextHeight = Number(data.height);
        if (Number.isFinite(nextHeight)) {
          setHeight(
            Math.max(
              MIN_INLINE_HEIGHT,
              Math.min(MAX_INLINE_HEIGHT, nextHeight),
            ),
          );
        }
      }
    };
    const observer = new MutationObserver(sendContext);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sendContext);
    window.addEventListener("message", onMessage);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sendContext);
      window.removeEventListener("message", onMessage);
      ownedFrame?.contentWindow?.postMessage({
        protocol: PROTOCOL,
        type: "host-dispose",
        channel,
      }, "*");
    };
  }, [channel]);

  if (!artifact.previewAvailable || artifact.status !== "ready") {
    return null;
  }

  return (
    <article
      className="relative mt-3 min-w-0"
      aria-label={`${artifact.title} interactive visualization`}
    >
      <iframe
        key={previewUrl}
        ref={frameRef}
        title={`${artifact.title} interactive visualization`}
        sandbox="allow-scripts"
        allow=""
        referrerPolicy="no-referrer"
        src={previewUrl}
        style={{ height }}
        className="block min-h-[17.5rem] w-full border-0 bg-transparent"
      />
    </article>
  );
}
