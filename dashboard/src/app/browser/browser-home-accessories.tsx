"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { BrowserDock } from "./browser-home-widgets";
import { BrowserDailyQuote } from "./browser-personalization";
import BrowserHomeCalendar from "./browser-home-calendar";
import type { DockPanel } from "./browser-dock-popovers";

const SettingsDialog = dynamic(() => import("@/app/components/settings-dialog"), {
  ssr: false,
});

/**
 * The shared lower edge of Breadboard's two home surfaces.
 *
 * Keeping the quote, dock, calendar, and Connections handoff together means
 * the Browser home and the app-level New tab cannot quietly drift into two
 * different widgets or behaviours.
 */
export default function BrowserHomeAccessories({ ownerKey }: { ownerKey: string }) {
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<DockPanel | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('panel') === 'spotify') setOpenPanel('spotify');
  }, []);
  const setPanelOpen = useCallback((panel: DockPanel, open: boolean) => {
    setOpenPanel((current) => open ? panel : current === panel ? null : current);
  }, []);

  return (
    <>
      <BrowserDailyQuote ownerKey={ownerKey} />
      <BrowserDock openConnections={() => setConnectionsOpen(true)} openPanel={openPanel} setPanelOpen={setPanelOpen} />
      <BrowserHomeCalendar key={ownerKey} open={openPanel === "calendar"} onOpenChange={(open) => setPanelOpen("calendar", open)} />
      {connectionsOpen ? (
        <SettingsDialog
          initialTab="connections"
          onClose={() => setConnectionsOpen(false)}
        />
      ) : null}
    </>
  );
}
