"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { installAnchoredTabNavigation } from "@/lib/anchored-tab-navigation";
import { useDesktopTabs } from "./use-desktop-tabs";

export default function AnchoredTabNavigationGuard() {
  const router = useRouter();
  useDesktopTabs();
  useEffect(() => installAnchoredTabNavigation(router), [router]);
  return null;
}
