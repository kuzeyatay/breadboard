"use client";

import { useSyncExternalStore } from "react";
import {
  getDesktopTabsSnapshot,
  subscribeDesktopTabs,
  type DesktopTabsState,
} from "@/lib/desktop-browser-tabs";

function serverSnapshot(): DesktopTabsState | null {
  return null;
}

/**
 * The tabs of the desktop window this page is in, or null in a browser and
 * before the shell has answered. Every subscriber shares one subscription.
 */
export function useDesktopTabs(): DesktopTabsState | null {
  return useSyncExternalStore(subscribeDesktopTabs, getDesktopTabsSnapshot, serverSnapshot);
}

/** Whether "Open in new tab" can mean a tab of this window. */
export function useDesktopTabsEnabled(): boolean {
  return useDesktopTabs()?.enabled === true;
}
