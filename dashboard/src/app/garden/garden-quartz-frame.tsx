"use client";

import { useState } from "react";
import { quartzUrlWithAppTheme } from "@/lib/quartz-url";
import { useQuartzViewLease } from "./use-quartz-view-lease";

interface Props {
  src: string;
  title: string;
  /** View lease already held by the Server Component; null if it could not lease Quartz. */
  quartzViewId?: string | null;
}

// Loading is reported by the global navigation progress bar while the Server
// Component holds the lease; this frame only ever shows the unavailable state.
export default function GardenQuartzFrame({ src, title, quartzViewId = null }: Props) {
  const quartzLease = useQuartzViewLease(true, quartzViewId);
  const [loadFailed, setLoadFailed] = useState(false);

  const quartzUnavailable = loadFailed || quartzLease.failed;

  return (
    <div className="relative min-h-0 flex-1 bg-gray-950">
      {quartzUnavailable && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-gray-950">
          <div className="flex flex-col items-center gap-4">
            <span className="text-xs tracking-widest text-gray-700 uppercase">
              Quartz did not respond
            </span>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              Open Quartz directly
            </a>
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
        }}
        onError={() => setLoadFailed(true)}
      />
    </div>
  );
}
