"use client";

import { useState } from "react";
import { quartzUrlWithAppTheme } from "@/lib/quartz-url";
import { useQuartzViewLease } from "./use-quartz-view-lease";

interface Props {
  src: string;
  title: string;
}

export default function GardenQuartzFrame({ src, title }: Props) {
  const quartzLease = useQuartzViewLease();
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const quartzUnavailable = loadFailed || quartzLease.failed;
  const isLoaded = quartzLease.ready && loadedSource === src && !quartzUnavailable;

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
              {quartzUnavailable ? "Quartz did not respond" : title}
            </span>
            {quartzUnavailable && (
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
        src={quartzLease.ready ? quartzUrlWithAppTheme(src) : undefined}
        className="block h-full w-full border-0 bg-gray-950"
        title={title}
        onLoad={() => {
          if (!quartzLease.ready) return;
          setLoadFailed(false);
          setLoadedSource(src);
        }}
        onError={() => setLoadFailed(true)}
      />
    </div>
  );
}
