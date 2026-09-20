import { Date, getDate } from "./Date"
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { contentMetadata, handwritingWordsPerMinute } from "../util/contentMeta"
import { formatDuration } from "../util/duration"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"
import { JSX } from "preact"
import style from "./styles/contentMeta.scss"
// @ts-ignore
import script from "./scripts/contentMeta.inline"

interface ContentMetaOptions {
  /**
   * Whether to display reading time
   */
  showReadingTime: boolean
  showComma: boolean
}

const defaultOptions: ContentMetaOptions = {
  showReadingTime: true,
  showComma: true,
}

export default ((opts?: Partial<ContentMetaOptions>) => {
  // Merge options with defaults
  const options: ContentMetaOptions = { ...defaultOptions, ...opts }

  function ContentMetadata({
    cfg,
    fileData,
    allFiles,
    folderSlug,
    displayClass,
  }: QuartzComponentProps) {
    const text = fileData.text
    const isFolder = folderSlug !== undefined

    if (text || isFolder) {
      const segments: (string | JSX.Element)[] = []

      if (fileData.dates) {
        segments.push(<Date date={getDate(cfg, fileData)!} locale={cfg.locale} />)
      }

      // Display reading time, word count, and estimated handwriting time if enabled
      if (options.showReadingTime) {
        // Folder indexes describe navigation; count descendant notes once, including
        // nested folders, without adding their index descriptions to the totals.
        const files = isFolder
          ? allFiles.filter((file) => {
              const slug = file.slug ?? ""
              return slug.startsWith(`${folderSlug}/`) && !slug.endsWith("/index")
            })
          : [fileData]
        const { readingMinutes, words, handwritingMinutes } = contentMetadata(
          files.map((file) => file.text ?? ""),
        )
        const displayedTime = i18n(cfg.locale).components.contentMeta.readingTime({
          minutes: readingMinutes,
        })
        segments.push(
          <span title={isFolder ? "All notes in this folder and its subfolders" : undefined}>
            {displayedTime}
            {isFolder ? " total" : ""}
          </span>,
        )
        segments.push(
          <span>
            {words.toLocaleString(cfg.locale)} {words === 1 ? "word" : "words"}
          </span>,
        )
        segments.push(
          <span title={`Estimated at ${handwritingWordsPerMinute} words per minute`}>
            ~{formatDuration(handwritingMinutes, cfg.locale)} to handwrite
            {isFolder ? " total" : ""}
          </span>,
        )
      }

      return (
        <p
          show-comma={options.showComma}
          data-reading-time={String(options.showReadingTime)}
          data-locale={cfg.locale}
          class={classNames(displayClass, "content-meta")}
        >
          {segments}
        </p>
      )
    } else {
      return null
    }
  }

  ContentMetadata.css = style
  ContentMetadata.afterDOMLoaded = script

  return ContentMetadata
}) satisfies QuartzComponentConstructor
