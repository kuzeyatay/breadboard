import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import {
  ArtifactStoreError,
  getArtifactForUser,
  presentArtifact,
} from "@/lib/hermes/artifact-store";
import { artifactEditorMode } from "@/lib/hermes/artifact-editor-types";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import MarkdownArtifactEditor from "./markdown-artifact-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Markdown editor | breadboard",
};

export default async function MarkdownArtifactEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ artifactId: string }>;
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string } | undefined)?.id);
  const { artifactId } = await params;
  const conversationId = (await searchParams).conversationId?.trim() ?? "";
  if (!Number.isFinite(userId) || userId <= 0 || !conversationId) notFound();

  let artifact: PresentedArtifact;
  try {
    artifact = presentArtifact(getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    }));
  } catch (error) {
    if (error instanceof ArtifactStoreError) notFound();
    throw error;
  }
  if (artifact.kind !== "markdown" || !artifactEditorMode(artifact)) notFound();
  return <MarkdownArtifactEditor initialArtifact={artifact} />;
}
