'use client';

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

// Reader mode is owned by Quartz's book button. Reserve the assistant's space
// in the host so the iframe gets a real viewport resize and its text reflows.
export function useQuartzReaderLayout(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  quartzOrigin: string,
) {
  const [readerMode, setReaderMode] = useState(false);
  const [assistantWidth, setAssistantWidth] = useState(0);

  useEffect(() => {
    if (!quartzOrigin) return;

    function receiveReaderMode(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== quartzOrigin) return;
      if (event.data?.type !== 'second-brain:reader-mode') return;
      if (typeof event.data.enabled === 'boolean') setReaderMode(event.data.enabled);
    }

    function requestReaderMode() {
      iframeRef.current?.contentWindow?.postMessage({ type: 'second-brain:reader-mode-request' }, quartzOrigin);
    }

    function handleFrameLoad(event: Event) {
      if (event.target === iframeRef.current) requestReaderMode();
    }

    window.addEventListener('message', receiveReaderMode);
    // Capture also covers LibraryGardenClient replacing its keyed iframe.
    document.addEventListener('load', handleFrameLoad, true);
    requestReaderMode();
    return () => {
      window.removeEventListener('message', receiveReaderMode);
      document.removeEventListener('load', handleFrameLoad, true);
    };
  }, [iframeRef, quartzOrigin]);

  return {
    // Include the 8px resize handle. Mobile keeps the existing full-screen panel.
    readerLayoutStyle: {
      '--garden-assistant-space': `${readerMode && assistantWidth > 0 ? assistantWidth + 8 : 0}px`,
    } as CSSProperties,
    setAssistantWidth,
  };
}
