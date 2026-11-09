"use client";

import BreadboardVideoPlayer from "@/app/components/breadboard-video-player";

/** Keyed on src so an artifact version change releases the old decoder. */
export default function ArtifactVideoPreview({ src, title }: { src: string; title: string }) {
  return (
    <BreadboardVideoPlayer
      key={src}
      src={src}
      title={title}
      className="aspect-video max-h-80 rounded-none"
    />
  );
}
