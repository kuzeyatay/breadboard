import { contentMetadata, handwritingWordsPerMinute } from "../../util/contentMeta"
import { formatDuration } from "../../util/duration"
import { i18n, TRANSLATIONS } from "../../i18n"
import type { ValidLocale } from "../../i18n"

// Scoped publications can retain HTML from an earlier renderer. Refresh its
// metadata from the merged index so shared improvements reach every Garden.
async function updateContentMeta() {
  const slug = document.body.dataset.slug
  if (!slug || slug === "tags/index" || slug.startsWith("tags/")) return
  let metadata = document.querySelector<HTMLElement>(".content-meta")
  if (metadata?.dataset.readingTime === "false") return
  const title = document.querySelector("h1.article-title")
  if (!title) return

  try {
    const index = await fetchData
    if (document.body.dataset.slug !== slug) return
    metadata = document.querySelector<HTMLElement>(".content-meta")
    const isFolder = slug.endsWith("/index")
    const prefix = slug.slice(0, -"index".length)
    const pages = isFolder
      ? Object.entries(index)
          .filter(([key]) => key.startsWith(prefix) && !key.endsWith("/index"))
          .map(([, page]) => page)
      : [index[slug]].filter(Boolean)
    if (!isFolder && pages.length === 0) return
    // New publications carry small precomputed counts; older indexes retain
    // the full text. Never load every note's text just to display metadata.
    if (pages.length > 0 && pages.every((page) => page.wordCount === undefined && !page.content))
      return

    const { words, time } = pages.reduce(
      (total, page) => {
        const stats =
          page.wordCount !== undefined && page.readingTimeMs !== undefined
            ? { words: page.wordCount, readingTimeMs: page.readingTimeMs }
            : contentMetadata([page.content ?? ""])
        return { words: total.words + stats.words, time: total.time + stats.readingTimeMs }
      },
      { words: 0, time: 0 },
    )
    const readingMinutes = Math.ceil(time / 60_000)
    const handwritingMinutes = Math.ceil(words / handwritingWordsPerMinute)
    const language = metadata?.dataset.locale || document.documentElement.lang || "en-US"
    const locale = (
      language in TRANSLATIONS
        ? language
        : Object.keys(TRANSLATIONS).find((key) => key.split("-")[0] === language) || "en-US"
    ) as ValidLocale
    const span = (text: string, tooltip?: string) => {
      const element = document.createElement("span")
      element.textContent = text
      if (tooltip) element.title = tooltip
      return element
    }
    const suffix = isFolder ? " total" : ""
    const date = metadata?.querySelector("time")
    if (!metadata) {
      metadata = document.createElement("p")
      metadata.className = "content-meta"
      metadata.setAttribute("show-comma", "true")
      title.after(metadata)
    }
    metadata.replaceChildren(
      ...(date ? [date] : []),
      span(
        i18n(locale).components.contentMeta.readingTime({ minutes: readingMinutes }) + suffix,
        isFolder ? "All notes in this folder and its subfolders" : undefined,
      ),
      span(`${words.toLocaleString(locale)} ${words === 1 ? "word" : "words"}`),
      span(
        `~${formatDuration(handwritingMinutes, locale)} to handwrite${suffix}`,
        `Estimated at ${handwritingWordsPerMinute} words per minute`,
      ),
    )
  } catch {
    // Keep the build-time metadata if the content index is unavailable.
  }
}

const metadataWindow = window as Window & { __quartzContentMetaInstalled?: boolean }
if (!metadataWindow.__quartzContentMetaInstalled) {
  metadataWindow.__quartzContentMetaInstalled = true
  document.addEventListener("nav", () => void updateContentMeta())
  void updateContentMeta()
}
