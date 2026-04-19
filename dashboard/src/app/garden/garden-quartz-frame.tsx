"use client";

import { useState } from "react";

interface Props {
  src: string;
  title: string;
}

export default function GardenQuartzFrame({ src, title }: Props) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const isLoaded = loadedSource === src && !loadFailed;

  return (
    <div className="relative min-h-0 flex-1 bg-gray-950">
      {!isLoaded && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-gray-950">
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-none bg-gray-600 animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
            <span className="text-xs tracking-widest text-gray-700 uppercase">
              {loadFailed ? "Quartz did not respond" : title}
            </span>
            {loadFailed && (
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
              >
                Open Quartz directly
              </a>
            )}
          </div>
        </div>
      )}

      <iframe
        key={src}
        src={src}
        className="block h-full w-full border-0 bg-gray-950"
        title={title}
        onLoad={() => {
          setLoadFailed(false);
          setLoadedSource(src);
        }}
        onError={() => setLoadFailed(true)}
      />
    </div>
  );
}
