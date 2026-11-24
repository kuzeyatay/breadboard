import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import DesignClient from "@/app/design/design-client";
import VideoStudioClient from "@/app/video-studio/video-studio-client";
import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import { spacesStudio } from "@/lib/office/types.ts";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import { defaultSpacesGarden, ownedGardenScope } from "@/lib/spaces/garden-save.ts";
import SpacesEditor from "./spaces-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spaces · Breadboard" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : null);

/**
 * One Spaces editor page: `?garden&file` opens a Spaces file (documents and pages in their editors,
 * images in Design, videos in Video); `?app=design|video&artifact&conversation` edits a chat image or
 * video; `?app=video&garden&title` starts a new video that is saved into Spaces on its first save.
 */
export default async function SpacesEditPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/spaces/edit?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"))}`)}`);
  const userId = Number((session.user as { id?: string }).id);
  const showFlowers = getNavbarFlowers(userId);

  const gardenSlug = one(params.garden);
  const garden = gardenSlug
    ? (db.prepare("SELECT slug, name FROM clusters WHERE slug = ? AND user_id = ?").get(gardenSlug, userId) as { slug: string; name: string } | undefined) ?? null
    : defaultSpacesGarden(userId);
  const fileId = one(params.file), app = one(params.app), artifact = one(params.artifact), conversation = one(params.conversation), title = one(params.title);

  let body: React.ReactNode = null;
  if (fileId && garden) {
    const { store, scope } = ownedGardenScope(userId, garden.slug);
    let file;
    try { file = store.get(scope, fileId); } catch { redirect("/spaces"); }
    const studio = spacesStudio(file.path);
    const gardenFile = { gardenId: garden.slug, fileId: file.id, name: file.name };
    body = studio === "design" ? <DesignClient showFlowers={showFlowers} garden={garden} artifact={null} gardenFile={gardenFile} initialDesign={null} />
      : studio === "video" ? <VideoStudioClient showFlowers={showFlowers} garden={garden} source={null} gardenFile={gardenFile} />
      : <SpacesEditor showFlowers={showFlowers} garden={garden} file={file} ask={one(params.ask)} />;
  } else if (app === "design") {
    body = <DesignClient showFlowers={showFlowers} garden={garden}
      artifact={artifact && conversation ? { id: artifact, conversationId: conversation, title: title ?? "Image" } : null} initialDesign={one(params.design)} />;
  } else if (app === "video") {
    body = <VideoStudioClient showFlowers={showFlowers} garden={garden}
      source={artifact ? { id: artifact, conversationId: conversation ?? "", title: title ?? "Video", kind: one(params.kind) ?? "video" } : null}
      gardenFile={!artifact && garden ? { gardenId: garden.slug, fileId: null, name: `${title ?? "Untitled video"}.mp4` } : null}
      importUrl={garden && one(params.media)?.startsWith(`/api/gardens/${encodeURIComponent(garden.slug)}/media/`) ? one(params.media) : null} />;
  }
  if (!body) redirect("/spaces");
  return <div className="flex h-screen flex-col overflow-hidden">{body}</div>;
}
