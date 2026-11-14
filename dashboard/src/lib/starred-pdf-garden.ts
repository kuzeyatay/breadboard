import type Database from "better-sqlite3";

/** Resolve the source document's Garden without changing the PDF chat's runtime scope. */
export function starredPdfGardenId(db: Database.Database, userId: number, request: Request,
  sourceUrl: string, readableGardenId: (slug: string) => number): number | null {
  let source: URL;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      || request.headers.get("host") || requestUrl.host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || requestUrl.protocol.slice(0, -1);
    const authority = new URL(`${protocol}://${host}`);
    if (!["http:", "https:"].includes(authority.protocol) || authority.username || authority.password ||
      authority.pathname !== "/" || authority.search || authority.hash) return null;
    source = new URL(sourceUrl, authority);
    if (source.origin !== authority.origin || source.username || source.password) return null;
  } catch { return null; }

  const document = source.pathname.match(/^\/api\/documents\/[^/]+\/source-pdf$/);
  const reader = source.pathname.match(/^\/gardens\/([^/]+)\/pdf\/[^/]+$/);
  if (document || reader) {
    let slug: string | null;
    try { slug = document ? source.searchParams.get("clusterSlug") : decodeURIComponent(reader![1]); }
    catch { return null; }
    if (!slug || slug === "." || slug === ".." || /[/\\:\0%]/.test(slug)) return null;
    return readableGardenId(slug);
  }

  const artifact = source.pathname.match(/^\/api\/hermes\/artifacts\/([^/]+)\/preview$/);
  if (artifact) {
    const row = db.prepare(`SELECT COALESCE(a.cluster_id, c.default_garden_id) AS gardenId
      FROM hermes_artifacts a JOIN conversations c ON c.id = a.conversation_id
      WHERE a.id = ? AND a.user_id = ? AND c.user_id = ? AND c.public_id = ? AND a.kind = 'pdf'`)
      .get(artifact[1], userId, userId, source.searchParams.get("conversationId")) as { gardenId: number | null } | undefined;
    return row?.gardenId ?? null;
  }

  const attachment = source.pathname.match(/^\/api\/chat-attachments\/documents\/([^/]+)$/);
  if (attachment) {
    // A reused upload may occur in several chats; keep its original Garden.
    const row = db.prepare(`SELECT c.default_garden_id AS gardenId
      FROM conversation_message_reads m JOIN conversations c ON c.id = m.conversation_id
      JOIN json_each(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END, '$.attachments') attachment
      WHERE c.user_id = ? AND c.default_garden_id IS NOT NULL AND m.role = 'user'
        AND json_extract(attachment.value, '$.blobId') = ?
        AND json_extract(attachment.value, '$.type') = 'document'
        AND json_extract(attachment.value, '$.format') = 'pdf'
      ORDER BY m.id ASC LIMIT 1`).get(userId, attachment[1]) as { gardenId: number } | undefined;
    return row?.gardenId ?? null;
  }
  return null;
}
