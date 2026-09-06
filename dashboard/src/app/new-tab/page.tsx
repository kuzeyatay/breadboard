import type { Metadata } from "next";
import { randomInt } from "node:crypto";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getClusters } from "@/app/actions/clusters";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import NavBar from "@/app/components/navbar";
import NewTabClient from "./new-tab-client";
import { pickNewTabAddressee } from "./new-tab-greetings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New tab — breadboard",
};

/**
 * Where a new tab starts.
 *
 * A tab exists to hold a different place than the one beside it — the
 * dashboard next to a workspace, a plan next to a garden's lessons. Opening on
 * a copy of the current page gives nobody that, so a fresh tab opens here, on
 * the places there are to go, and leaves as soon as one is chosen.
 */
export default async function NewTabPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/new-tab");
  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=/new-tab");

  const email = session.user.email ?? "";
  const username = session.user.name ?? email;
  const clusters = await getClusters(userId);
  const gardens = clusters.map((cluster) => ({
    slug: cluster.slug,
    name: cluster.name,
    noteCount: cluster.noteCount,
    lastViewedAt: cluster.last_viewed_at,
    borderColor: cluster.border_color,
  }));

  return (
    <div className="dashboard-shell h-screen min-h-screen overflow-hidden bg-[var(--paper-bg)] text-white flex flex-col">
      <NavBar
        email={email}
        username={username}
        showActions={false}
        showFlowers={getNavbarFlowers(userId)}
      />
      <NewTabClient
        gardens={gardens}
        addressee={pickNewTabAddressee({}, [], () => randomInt(0x1000000) / 0x1000000)}
        greetingOwnerKey={String(userId)}
        widgetOwnerKey={(email || String(userId)).trim().toLowerCase()}
      />
    </div>
  );
}
