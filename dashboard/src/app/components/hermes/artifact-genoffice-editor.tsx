"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

interface ArtifactGenOfficeEditorProps {
  artifact: PresentedArtifact;
  mode?: "edit" | "preview";
  onSaved?: (artifact: PresentedArtifact) => void;
}

interface GenOfficeMessage {
  type?: string;
  artifact?: PresentedArtifact;
}

export default function ArtifactGenOfficeEditor({
  artifact,
  mode = "edit",
  onSaved,
}: ArtifactGenOfficeEditorProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [source] = useState(() => {
    const query = new URLSearchParams({
      artifactId: artifact.id,
      conversationId: artifact.conversationId,
      version: String(artifact.version),
      mode,
    });
    return `/genoffice-editor/index.html?${query}`;
  });

  useEffect(() => {
    const receive = (event: MessageEvent<GenOfficeMessage>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow ||
        !event.data
      ) return;
      if (
        event.data.type === "breadboard:genoffice-artifact-saved" &&
        event.data.artifact?.id === artifact.id
      ) {
        onSaved?.(event.data.artifact);
      }
    };
    if (mode !== "edit" || !onSaved) return;
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [artifact.id, mode, onSaved]);

  const readOnly = mode === "preview";

  return (
    <div
      className="h-full min-h-[42rem] overflow-hidden bg-[var(--background)]"
      data-genoffice-artifact-editor={readOnly ? undefined : ""}
      data-genoffice-artifact-preview={readOnly ? "" : undefined}
    >
      <iframe
        ref={frameRef}
        src={source}
        title={readOnly ? `${artifact.title} Word preview` : `Edit ${artifact.title} in GenOffice`}
        className="h-full min-h-[42rem] w-full border-0 bg-[var(--background)]"
        allow={readOnly ? "" : "clipboard-read; clipboard-write"}
      />
    </div>
  );
}
