"use client";

import { useState } from "react";
import { ReclaimingVideo } from "../reclaiming-media";

function VideoPreview({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative overflow-hidden" style={{ background: "#080d0a", colorScheme: "dark" }}>
      {failed ? (
        <p className="p-4 text-sm" style={{ color: "#f3f7f4" }} role="status">
          Video preview unavailable. Open the artifact below to view it.
        </p>
      ) : (
        <ReclaimingVideo
          src={src}
          aria-label={`Video preview: ${title}`}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="block aspect-video max-h-80 w-full object-contain"
        />
      )}
    </div>
  );
}

/** Reset errors and release the old decoder when an artifact version changes. */
export default function ArtifactVideoPreview(props: { src: string; title: string }) {
  return <VideoPreview key={props.src} {...props} />;
}
