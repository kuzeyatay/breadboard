'use client';
import { useEffect } from 'react';
import { startAmbientFrameGovernor } from '@/lib/ambient-frame-governor';
import { isAmbientTabPresented, subscribeDesktopTabs } from '@/lib/desktop-browser-tabs';

/** Advances slow decorative animations from one shared low-rate clock. */
export default function AmbientFrameGovernorRuntime() {
  useEffect(() => {
    const start = () => startAmbientFrameGovernor(document, {
      visible: isAmbientTabPresented,
      subscribe: subscribeDesktopTabs,
    });
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stop = start();
    const restart = () => { stop(); stop = start(); };
    preference.addEventListener('change', restart);
    return () => {
      preference.removeEventListener('change', restart);
      stop();
    };
  }, []);
  return null;
}
