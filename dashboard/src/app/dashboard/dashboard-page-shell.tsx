import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import {
  getClusters,
  getClusterFolders,
  getOrganizationClusters,
  getPublicClusters,
} from "@/app/actions/clusters";
import { listOrganizations } from "@/lib/organizations/store";
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import type { TerminalPanel } from "@/app/components/hermes/terminal-sidebar";
import DashboardClient from "./dashboard-client";
import { randomInt } from "node:crypto";
import db from "@/lib/db";
import { readNewTabGardens } from "@/lib/new-tab-gardens";
import { readSearchHistory } from "@/lib/new-tab-search-history";
import { pickNewTabAddressee } from "@/app/new-tab/new-tab-greetings";

export default async function DashboardPageShell({
  initialTerminalPanel = null,
  initialTerminalChatId = null,
  combinedHome = true,
}: {
  initialTerminalPanel?: TerminalPanel | null;
  initialTerminalChatId?: string | null;
  /** The original dashboard composition remains available to internal callers. */
  combinedHome?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const callbackUrl = initialTerminalPanel === "hooks"
      ? "/hooks"
      : initialTerminalPanel === "processes"
        ? "/processes"
        : null;
    redirect(
      callbackUrl
        ? `/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : "/auth/login",
    );
  }

  const userId = Number((session.user as { id?: string }).id);
  const userEmail = session.user.email ?? "";
  const username = session.user.name ?? userEmail;
  const [clusters, publicClusters, organizationClusters, clusterFolders] = await Promise.all([
    getClusters(userId), getPublicClusters(userId), getOrganizationClusters(userId), getClusterFolders(userId),
  ]);
  // Library routes prepare their own Quartz indexes when opened. Doing that
  // here scans every garden's contents and blocks all tabs on the local server.
  const organizations = listOrganizations(userId).map((organization) => ({
    id: organization.id,
    name: organization.name,
  }));

  return (
    <DashboardClient
      userEmail={userEmail}
      username={username}
      initialClusters={clusters}
      initialPublicClusters={publicClusters}
      initialOrganizationClusters={organizationClusters}
      organizations={organizations}
      initialClusterFolders={clusterFolders}
      navbarShortcuts={getNavbarShortcuts(userId)}
      showNavbarFlowers={getNavbarFlowers(userId)}
      initialTerminalPanel={initialTerminalPanel}
      initialTerminalChatId={initialTerminalChatId}
      home={combinedHome ? {
        gardens: readNewTabGardens(db, userId),
        initialSearchHistory: readSearchHistory(db, userId),
        addressee: pickNewTabAddressee({}, [], () => randomInt(0x1000000) / 0x1000000),
        greetingOwnerKey: String(userId),
        widgetOwnerKey: (userEmail || String(userId)).trim().toLowerCase(),
      } : undefined}
    />
  );
}
