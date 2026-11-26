"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";

const BrowserContent = dynamic(() => import("@/app/browser/browser-client").then(module => module.BrowserContent));

/** Keep the actual Terminal document mounted across native website navigations. */
export default function TerminalBrowserSurface({ children, ownerKey, showFlowers }: {
  children: ReactNode; ownerKey: string; showFlowers: boolean;
}) {
  const tabs = useDesktopTabs();
  const tab = tabs?.tabs.find(item => item.id === tabs.selfId);
  const browsing = tab?.browser?.terminalOrigin === true;
  return <>
    <div style={{ display: browsing ? "none" : "contents" }} inert={browsing}>{children}</div>
    {browsing && <div className="browser-shell min-h-screen">
      <BrowserContent tab={tab} showFlowers={showFlowers} restoreOwnerKey={ownerKey} />
    </div>}
  </>;
}
