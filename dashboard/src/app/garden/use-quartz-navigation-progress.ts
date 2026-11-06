'use client';

import { useEffect, useState, type RefObject } from 'react';
import { usePageLoading } from '../components/use-page-loading';

/** Quartz work belongs in the same top bar as shell navigation. */
export function useQuartzNavigationProgress(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  src: string,
) {
  const [pending, setPending] = useState(false);
  usePageLoading(pending);

  useEffect(() => {
    let origin: string;
    try { origin = new URL(src).origin; } catch { return; }
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type !== 'second-brain:navigation-progress' || typeof event.data.pending !== 'boolean') return;
      setPending(event.data.pending);
    };
    const request = () => iframeRef.current?.contentWindow?.postMessage(
      { type: 'second-brain:navigation-progress-request' }, origin,
    );
    // Recover the state if the frame loaded before React attached the listener.
    const loaded = (event: Event) => {
      if (event.target !== iframeRef.current) return;
      // A hard load may end on a browser error page without the Quartz bridge.
      setPending(false);
      request();
    };
    window.addEventListener('message', receive);
    document.addEventListener('load', loaded, true);
    request();
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('load', loaded, true);
    };
  }, [iframeRef, src]);
}
