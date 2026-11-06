"use client";

import { useRef, useState } from "react";
import { quartzUrlWithAppTheme } from "@/lib/quartz-url";
import { useQuartzViewLease } from "./use-quartz-view-lease";
import { useQuartzNavigationProgress } from "./use-quartz-navigation-progress";

interface Props {
  src: string;
  title: string;
  /** View lease already held by the Server Component; null if it could not lease Quartz. */
  quartzViewId?: string | null;
}

// Loading is reported by the global navigation progress bar while the Server
// Component holds the lease; this frame only ever shows the unavailable state.
export default function GardenQuartzFrame({ src, title, quartzViewId = null }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useQuartzNavigationProgress(iframeRef, src);
  const quartzLease = useQuartzViewLease(true, quartzViewId);
  const [loadFailed, setLoadFailed] = useState(false);

  const quartzUnavailable = loadFailed || quartzLease.failed;

  return (
    <div className="relative min-h-0 flex-1 bg-gray-950">
      {quartzUnavailable && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm" role="alert">
          <span>Garden did not respond</span>
          <button type="button" className="underline disabled:opacity-50" disabled={quartzLease.retrying}
            onClick={async () => {
              if (!await quartzLease.retry()) return;
              setLoadFailed(false);
              const iframe = iframeRef.current;
              if (iframe) iframe.src = quartzUrlWithAppTheme(src);
            }}>{quartzLease.retrying ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}

      <iframe
        ref={iframeRef}
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
