import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getCluster, getReadableCluster } from "@/app/actions/clusters";
import db from "@/lib/db";
import { organizationClusterClause } from "@/lib/organizations/store";
import WorkspaceClient from "./workspace-client";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterSlug: string }>;
  searchParams: Promise<{ chat?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string }).id);
  const { clusterSlug } = await params;
  const requested = await searchParams;
  const initialChatId = Array.isArray(requested.chat)
    ? requested.chat[0] ?? null
    : requested.chat ?? null;

  // Try owner access first
  let cluster = await getCluster(userId, clusterSlug);
  let isOwner = true;

  if (!cluster) {
    // Fall back to chat-accessible gardens shared publicly or with one of the
    // organizations this account is in.
    const row = db
      .prepare(
        `SELECT * FROM clusters c
         WHERE c.slug = ? AND c.chat_accessible = 1
           AND (c.visibility = 'public'
                OR ${organizationClusterClause(userId, "c")})`,
      )
      .get(clusterSlug) as { id: number; name: string } | undefined;

    if (!row) notFound();

    // Re-fetch as a readable cluster for note counts and normalized settings.
    cluster = await getReadableCluster(userId, clusterSlug);
    if (!cluster) {
      // Build minimal cluster object from the row
      const fullRow = db
        .prepare("SELECT * FROM clusters WHERE slug = ?")
        .get(clusterSlug) as Record<string, unknown>;
      cluster = {
        id: fullRow.id as number,
        user_id: fullRow.user_id as number,
        name: fullRow.name as string,
        slug: clusterSlug,
        description: (fullRow.description as string | null) ?? null,
        visibility: "public",
        organization_id: null,
        border_color: (fullRow.border_color as string) ?? "#a9c1b1",
        card_width: Number(fullRow.card_width) || 392,
        card_height: Number(fullRow.card_height) || 244,
        chat_accessible: true,
        fork_allowed: Boolean(fullRow.fork_allowed),
        view_count: Number(fullRow.view_count) || 0,
        last_viewed_at: (fullRow.last_viewed_at as string | null) ?? null,
        folder: (fullRow.folder as string | null) ?? null,
        created_at: fullRow.created_at as string,
        noteCount: 0,
        isOwner: false,
        repo_connected: false,
        repo_name: null,
        graft_enabled: true,
        thought_topology_enabled: Boolean(fullRow.thought_topology_enabled),
      };
    }
    isOwner = false;
  }

  return (
    <WorkspaceClient
      clusterSlug={clusterSlug}
      clusterName={cluster.name}
      initialChatId={initialChatId}
      isOwner={isOwner}
      clusterVisibility={cluster.visibility}
      chatAccessible={cluster.chat_accessible}
      forkAllowed={cluster.fork_allowed}
    />
  );
}
