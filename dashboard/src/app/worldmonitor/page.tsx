import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { FEED_PANELS } from "@/lib/worldmonitor/feeds.ts";
import WorldMonitorClient from "./worldmonitor-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "World monitor — breadboard",
  description:
    "Live global intelligence: 188 curated sources plus climate, weather and hazard instruments, read through ChatMock.",
};

/**
 * The monitor opens in its own tab from the navbar, so like the calendar it
 * renders its own shell. Only the catalog shape is server-rendered — the window
 * itself is fetched client-side so the page paints before the wire does.
 */
export default async function WorldMonitorPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/worldmonitor");

  const panels = Object.entries(FEED_PANELS).map(([id, panel]) => ({
    id,
    label: panel.label,
    sources: panel.feeds.length,
  }));

  return <WorldMonitorClient panels={panels} />;
}
