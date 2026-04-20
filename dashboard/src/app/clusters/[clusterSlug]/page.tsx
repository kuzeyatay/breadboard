import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getCluster, getReadableCluster } from "@/app/actions/clusters";
import db from "@/lib/db";
import WorkspaceClient from "./workspace-client";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ clusterSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string }).id);
  const { clusterSlug } = await params;

  // Try owner access first
  let cluster = await getCluster(userId, clusterSlug);
  let isOwner = true;

  if (!cluster) {
    // Fall back to public + chat_accessible access
    const row = db
      .prepare(
        `SELECT * FROM clusters WHERE slug = ? AND visibility = 'public' AND chat_accessible = 1`,
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
        border_color: (fullRow.border_color as string) ?? "#374151",
        card_width: Number(fullRow.card_width) || 392,
        card_height: Number(fullRow.card_height) || 244,
        chat_accessible: true,
        fork_allowed: Boolean(fullRow.fork_allowed),
        view_count: Number(fullRow.view_count) || 0,
        last_viewed_at: (fullRow.last_viewed_at as string | null) ?? null,
        created_at: fullRow.created_at as string,
        noteCount: 0,
        isOwner: false,
      };
    }
    isOwner = false;
  }

  return (
    <WorkspaceClient
      clusterSlug={clusterSlug}
      clusterName={cluster.name}
      isOwner={isOwner}
      clusterVisibility={cluster.visibility}
      chatAccessible={cluster.chat_accessible}
      forkAllowed={cluster.fork_allowed}
    />
  );
}
