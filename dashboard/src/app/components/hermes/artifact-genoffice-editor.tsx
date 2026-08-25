"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

interface ArtifactGenOfficeEditorProps {
  artifact: PresentedArtifact;
  onSaved: (artifact: PresentedArtifact) => void;
}

interface GenOfficeMessage {
  type?: string;
  artifact?: PresentedArtifact;
}

export default function ArtifactGenOfficeEditor({
  artifact,
  onSaved,
}: ArtifactGenOfficeEditorProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [source] = useState(() => {
    const query = new URLSearchParams({
      artifactId: artifact.id,
      conversationId: artifact.conversationId,
      version: String(artifact.version),
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
        onSaved(event.data.artifact);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [artifact.id, onSaved]);

  return (
    <div className="h-full min-h-[42rem] overflow-hidden bg-[#f5efe3]" data-genoffice-artifact-editor>
      <iframe
        ref={frameRef}
        src={source}
        title={`Edit ${artifact.title} in GenOffice`}
        className="h-full min-h-[42rem] w-full border-0 bg-[#f5efe3]"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
