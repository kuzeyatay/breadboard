const AUDIO_FILE = /\.(mp3|m4a|wav|ogg|oga|flac|aac|opus|weba)$/i

/**
 * Where a source note's original opens: a dashboard viewer path (PDF reader,
 * video or audio player) or, for an imported link, the website itself.
 */
export function sourceDocumentTarget(
  slug: string,
  frontmatter: Record<string, unknown> | undefined,
): { path: string } | { url: string } | null {
  const field = (key: string) => {
    const value = frontmatter?.[key]
    return typeof value === "string" ? value.trim() : ""
  }
  const [cluster, ...rest] = slug.split("/")
  const name = rest.at(-1)
  if (!cluster || !name) return null
  const garden = encodeURIComponent(cluster)
  const source = encodeURIComponent(name)

  if (field("source_pdf")) return { path: `/gardens/${garden}/pdf/${source}` }
  const media = field("source_media")
  if (media) {
    const type = field("source_type").toLowerCase()
    const audio = type === "audio" || (type !== "video" && AUDIO_FILE.test(media))
    const query = new URLSearchParams({
      src: `/api/gardens/${garden}/media/${source}`,
      name: field("original_filename") || field("source_file") || name,
    })
    return { path: `/${audio ? "audio" : "video"}?${query}` }
  }
  const url = field("original_url") || field("canonical_url")
  return /^https?:\/\//i.test(url) ? { url } : null
}
