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
import { preparePrivateQuartzIndexes } from "@/lib/quartz-garden-index";
import { publishQuartzIndexesIfIdle } from "@/lib/quartz-publish";
import type { TerminalPanel } from "@/app/components/hermes/terminal-sidebar";
import DashboardClient from "./dashboard-client";

export default async function DashboardPageShell({
  initialTerminalPanel = null,
  initialTerminalChatId = null,
}: {
  initialTerminalPanel?: TerminalPanel | null;
  initialTerminalChatId?: string | null;
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
  const clusters = await getClusters(userId);
  const publicClusters = await getPublicClusters(userId);
  const organizationClusters = await getOrganizationClusters(userId);
  const clusterFolders = await getClusterFolders(userId);
  const privateGardenIndexes = preparePrivateQuartzIndexes(userId);
  if (privateGardenIndexes.some((index) => index.publishRequired)) {
    publishQuartzIndexesIfIdle("prepare dashboard cluster garden indexes", userId);
  }
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
    />
  );
}
