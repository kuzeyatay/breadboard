"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useDesktopTabs } from "./use-desktop-tabs";
import { usePageLoadingPending } from "./use-page-loading";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import NavigationProgressBar from "./navigation-progress-bar";
export { startNavigationProgress, cancelNavigationProgress } from "./navigation-progress-bar";

export default function NavigationProgress() {
  const desktop = useDesktopTabs();
  const page = desktop?.tabs.find(tab => tab.id === desktop.selfId);
  const pageLoadingPending = usePageLoadingPending();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const persistent = desktop?.persistentShell === true;
  const id = page?.id;
  const generation = page?.generation;
  const reportPending = useCallback((pending: boolean) => {
    if (persistent && id !== undefined && generation !== undefined) {
      void sendDesktopTabsCommand({ type: "page-loading", id, documentGeneration: generation, pending });
    }
  }, [persistent, id, generation]);
  return <NavigationProgressBar listenToNavigation
    renderBar={!persistent}
    routeKey={`${pathname}?${searchParams.toString()}`}
    trackedNavigationPending={pageLoadingPending || (!persistent && desktop?.navigationPending === true)}
    onPendingChange={reportPending} />;
}
