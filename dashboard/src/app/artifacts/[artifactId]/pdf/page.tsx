import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import {
  ArtifactStoreError,
  getArtifactForUser,
} from "@/lib/hermes/artifact-store";
import { getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";
import PdfViewerClient from "@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client";

export const dynamic = "force-dynamic";

export default async function ArtifactPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ artifactId: string }>;
  searchParams: Promise<{ conversationId?: string; version?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number(
    (session.user as { id?: string } | undefined)?.id,
  );
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
  if (artifact.kind !== "pdf" || !artifact.preview_location) notFound();

  const requestedVersion = Number(query.version);
  const version =
    Number.isInteger(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : artifact.current_version;
  const sourceQuery = new URLSearchParams({
    conversationId,
    version: String(version),
  });
  const sourceUrl =
    `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/preview?${sourceQuery.toString()}`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-gray-100">
      <PdfViewerClient
        title={artifact.title}
        browserTitle={artifact.filename}
        sourceUrl={sourceUrl}
        readOnly
        fastRead={getNavbarShortcuts(userId).fastRead}
      />
    </div>
  );
}
