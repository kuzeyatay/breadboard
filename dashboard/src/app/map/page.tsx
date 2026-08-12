import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import MapClient from "./map-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Map — breadboard",
  description:
    "The map the assistant works on: places, nearby results and routes, drawn from the same OpenStreetMap data it answers from.",
};

/**
 * The map opens in its own tab, like the monitor and the board.
 *
 * Nothing geographic is server-rendered: the whole page is a view of
 * Breadboard's geographic state, which the map tools and the user's own actions
 * both write. It follows the conversation named in `?conversation=`, and
 * otherwise the one this user's map state last moved in — so asking the
 * assistant for a route makes the route appear here without selecting anything.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/map");
  const params = await searchParams;
  return <MapClient conversationPublicId={params.conversation ?? null} />;
}
