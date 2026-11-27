"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserDock } from "./browser-home-widgets";
import { BrowserDailyQuote } from "./browser-personalization";
import BrowserHomeCalendar from "./browser-home-calendar";
import type { DockPanel } from "./browser-dock-popovers";

/**
 * The shared lower edge of Breadboard's two home surfaces.
 *
 * Keeping the quote, dock, and calendar together means
 * the Browser home and the app-level New tab cannot quietly drift into two
 * different widgets or behaviours.
 */
export default function BrowserHomeAccessories({ ownerKey, active = true, preparing = false }: { ownerKey: string; active?: boolean; preparing?: boolean }) {
  const [openPanel, setOpenPanel] = useState<DockPanel | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('panel') !== 'spotify') return;
    const frame = requestAnimationFrame(() => setOpenPanel('spotify'));
    return () => cancelAnimationFrame(frame);
  }, []);
  const setPanelOpen = useCallback((panel: DockPanel, open: boolean) => {
    setOpenPanel((current) => open ? panel : current === panel ? null : current);
  }, []);

  return (
    <>
      <BrowserDailyQuote ownerKey={ownerKey} key={ownerKey} />
      <BrowserDock active={active} preparing={preparing} openPanel={openPanel} setPanelOpen={setPanelOpen} />
      <BrowserHomeCalendar key={ownerKey} active={active || preparing} open={active && openPanel === "calendar"} onOpenChange={(open) => setPanelOpen("calendar", open)} />
    </>
  );
}
