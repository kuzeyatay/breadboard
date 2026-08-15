"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { artifactUrl } from "./artifact-viewer";

interface Props {
  artifact: PresentedArtifact;
  onOpen: () => void;
}

const PROTOCOL = "breadboard:interactive-visualizer:v1";

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
export default function InlineInteractiveVisualizer({ artifact, onOpen }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(760);
  const instanceId = useId();
  const channel = `${artifact.id}:${artifact.version}:${instanceId}`;
  const previewUrl = `${artifactUrl(artifact, "preview")}&channel=${encodeURIComponent(channel)}`;

  useEffect(() => {
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
          setHeight(Math.max(460, Math.min(1_200, nextHeight)));
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
    };
  }, [channel]);

  if (!artifact.previewAvailable || artifact.status !== "ready") {
    return null;
  }

  return (
    <article
      className="group relative mt-3 min-w-0"
      aria-label={`${artifact.title} interactive visualization`}
    >
      <button
        type="button"
        onClick={onOpen}
        title="Open in the artifact viewer"
        aria-label={`Open ${artifact.title} in the artifact viewer`}
        className="absolute bottom-2 right-2 z-[1] rounded-full border border-[var(--line)] bg-[var(--paper-bg)]/90 p-2 text-[var(--ink-muted)] opacity-0 backdrop-blur-sm transition hover:text-[var(--ink-heading)] focus-visible:opacity-100 group-hover:opacity-70 group-hover:hover:opacity-100"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 4H4v4m12-4h4v4M8 20H4v-4m12 4h4v-4" />
        </svg>
      </button>
      <iframe
        ref={frameRef}
        title={`${artifact.title} interactive visualization`}
        sandbox="allow-scripts"
        allow=""
        referrerPolicy="no-referrer"
        src={previewUrl}
        style={{ height }}
        className="block min-h-[27.5rem] w-full border-0 bg-transparent"
      />
    </article>
  );
}
