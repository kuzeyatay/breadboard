import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import VideoPlayerClient from "@/app/components/video-player-client";

export const dynamic = "force-dynamic";

/**
 * A same-origin address only: the player fetches it with the player's own
 * cookies, so the route that serves the bytes is the one deciding who may read
 * them. A scheme or a protocol-relative host would point it elsewhere.
 */
function sameOriginPath(value: string | undefined): string | null {
  const src = value?.trim() ?? "";
  if (!src.startsWith("/") || src.startsWith("//") || /[\\\p{Cc}]/u.test(src)) return null;
  return src;
}

function displayName(name: string | undefined, src: string): string {
  const explicit = name?.trim().replace(/[\p{Cc}]/gu, "") ?? "";
  if (explicit) return explicit;
  const last = src.split("?")[0]!.split("/").filter(Boolean).at(-1) ?? "";
  try {
    const decoded = decodeURIComponent(last);
    if (/\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(decoded)) return decoded;
  } catch {
    // An undecodable segment is not a name worth showing.
  }
  return "Video";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; name?: string }>;
}): Promise<Metadata> {
  const { src, name } = await searchParams;
  return { title: displayName(name, sameOriginPath(src) ?? "") };
}

/**
 * Breadboard's video player, opened on any dashboard address that serves a
 * video. The desktop shell sends a frame here when it would otherwise show
 * Chromium's own media viewer — a raw file address reached by a middle-click,
 * an agent, or a restored tab — and no dedicated route exists for that address.
 */
export default async function GenericVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; name?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string } | undefined)?.id);
  if (!Number.isFinite(userId) || userId <= 0) notFound();

  const { src, name } = await searchParams;
  const sourceUrl = sameOriginPath(src);
  if (!sourceUrl) notFound();

  return (
    <VideoPlayerClient
      title={displayName(name, sourceUrl)}
      sourceUrl={sourceUrl}
      kicker="Video"
      showNavbarFlowers={getNavbarFlowers(userId)}
    />
  );
}
