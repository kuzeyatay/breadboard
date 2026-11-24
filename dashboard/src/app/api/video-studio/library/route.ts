import { NextResponse } from "next/server";
import db from "@/lib/db";
import { scanClusterKnowledgeCooperatively } from "@/lib/knowledge";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { ownedGardenScope } from "@/lib/spaces/garden-save.ts";
import { videoAttachmentFormat } from "@/lib/video-attachments";

export const dynamic = "force-dynamic";

type Kind = "video" | "audio" | "image";
interface LibraryItem { garden: string; gardenName: string; title: string; filename: string; kind: Kind; url: string; size?: number }

const KIND_BY_EXTENSION: Record<string, Kind> = {
  mp4: "video", webm: "video", mov: "video", m4v: "video", mkv: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio", aac: "audio",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
};
const kindOf = (name: string): Kind | null => KIND_BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

/**
 * Every video, recording and image in the person's Gardens, for the Video editor's My assets: the Garden it was
 * opened in first, then the others. Uploaded sources with a kept original (recordings, kept YouTube videos)
 * and Garden files (Spaces videos, images) both count.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const first = new URL(request.url).searchParams.get("garden") ?? "";
    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    const gardens = (db.prepare("SELECT slug, name FROM clusters WHERE user_id = ? ORDER BY COALESCE(last_viewed_at, created_at) DESC").all(userId) as { slug: string; name: string }[])
      .sort((a, b) => Number(b.slug === first) - Number(a.slug === first));
    const items: LibraryItem[] = [];
    for (const garden of gardens) {
      const seen = new Set<string>();
      if (contentPath) {
        const { nodes } = await scanClusterKnowledgeCooperatively(contentPath, garden.slug);
        for (const node of nodes) {
          if (node.type !== "source-document" || !node.sourceMedia) continue;
          const named = node.sourceFile && !/^https?:/i.test(node.sourceFile) ? node.sourceFile : `${node.title || node.slug}.mp4`;
          const kind = kindOf(named) ?? (videoAttachmentFormat(named) ? "video" : null) ?? (/youtube|video/i.test(String(node.sourceType ?? "")) ? "video" : "audio");
          seen.add(named.toLowerCase());
          items.push({ garden: garden.slug, gardenName: garden.name, title: node.title || named, filename: named, kind,
            url: `/api/gardens/${encodeURIComponent(garden.slug)}/media/${encodeURIComponent(node.slug)}` });
        }
      }
      try {
        const { store, scope } = ownedGardenScope(userId, garden.slug);
        for (const file of store.list(scope)) {
          const kind = file.kind === "file" && !file.deletedAt ? kindOf(file.name) : null;
          if (!kind || seen.has(file.name.toLowerCase())) continue;
          items.push({ garden: garden.slug, gardenName: garden.name, title: file.name, filename: file.name, kind, size: file.size,
            url: `/api/gardens/${encodeURIComponent(garden.slug)}/files/${encodeURIComponent(file.id)}/content` });
        }
      } catch { /* a Garden without files */ }
    }
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
