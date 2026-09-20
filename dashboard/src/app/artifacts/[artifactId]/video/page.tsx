import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import {
  ArtifactStoreError,
  getArtifactForUser,
} from "@/lib/hermes/artifact-store";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import VideoPlayerClient from "@/app/components/video-player-client";

export const dynamic = "force-dynamic";

/** A video artifact, opened in Breadboard's player rather than a bare frame. */
export default async function ArtifactVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ artifactId: string }>;
  searchParams: Promise<{ conversationId?: string; version?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string } | undefined)?.id);
  const { artifactId } = await params;
  const query = await searchParams;
  const conversationId = query.conversationId?.trim() ?? "";
  if (!Number.isFinite(userId) || userId <= 0 || !conversationId) notFound();

  let artifact;
  try {
    artifact = getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    });
  } catch (error) {
    if (error instanceof ArtifactStoreError) notFound();
    throw error;
  }
  if (artifact.kind !== "video" || !artifact.preview_location) notFound();

  const requestedVersion = Number(query.version);
  const version =
    Number.isInteger(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : artifact.current_version;
  const sourceQuery = new URLSearchParams({ conversationId });
  if (version !== artifact.current_version) {
    sourceQuery.set("version", String(version));
  }

  return (
    <VideoPlayerClient
      title={artifact.title}
      sourceUrl={`/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/preview?${sourceQuery.toString()}`}
      kicker="Video artifact"
      showNavbarFlowers={getNavbarFlowers(userId)}
    />
  );
}
