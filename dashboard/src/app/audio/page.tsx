import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import VideoPlayerClient from "@/app/components/video-player-client";
import { sameOriginPath } from "@/lib/same-origin-path";

export const dynamic = "force-dynamic";

function displayName(name: string | undefined): string {
  return name?.trim().replace(/[\p{Cc}]/gu, "") || "Audio";
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ name?: string }> }): Promise<Metadata> {
  return { title: displayName((await searchParams).name) };
}

/** Breadboard's audio player on any dashboard address that serves audio, such as a garden source recording. */
export default async function GenericAudioPage({ searchParams }: { searchParams: Promise<{ src?: string; name?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");
  const userId = Number((session.user as { id?: string } | undefined)?.id);
  if (!Number.isFinite(userId) || userId <= 0) notFound();

  const { src, name } = await searchParams;
  const sourceUrl = sameOriginPath(src);
  if (!sourceUrl) notFound();

  return <VideoPlayerClient audio title={displayName(name)} sourceUrl={sourceUrl} showNavbarFlowers={getNavbarFlowers(userId)} />;
}
