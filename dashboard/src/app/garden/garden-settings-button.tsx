'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';

/** The settings panel belongs to Quartz, so it works in every reading view. */
export default function GardenSettingsButton({ quartzOrigin }: { quartzOrigin: string }) {
  const [ready, setReady] = useState(false);
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[data-quartz-reader]');
  useEffect(() => {
    const announce = () => { setReady(false); frame()?.contentWindow?.postMessage({ type: 'breadboard:quartz-settings-host' }, quartzOrigin); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== quartzOrigin || event.source !== frame()?.contentWindow) return;
      if (event.data?.type === 'breadboard:quartz-settings-ready') setReady(true);
      // Quartz can start before iframe load (fonts/embeds may still be pending).
      else if (event.data?.type === 'breadboard:quartz-settings-available') announce();
    };
    const load = (event: Event) => { if (event.target === frame()) announce(); };
    window.addEventListener('message', receive); document.addEventListener('load', load, true); announce();
    return () => { window.removeEventListener('message', receive); document.removeEventListener('load', load, true); };
  }, [quartzOrigin]);
  return <button type="button" aria-label="Page settings" aria-haspopup="dialog" disabled={!ready}
    title={ready ? 'Page settings' : 'Settings become available when the garden finishes loading'}
    onClick={() => frame()?.contentWindow?.postMessage({ type: 'breadboard:quartz-settings-open' }, quartzOrigin)}
    className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40">
    <Settings2 size={15} aria-hidden="true" /><span className="hidden sm:inline">Settings</span>
  </button>;
}
