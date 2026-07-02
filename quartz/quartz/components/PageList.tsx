import { FullSlug, isFolderPath, resolveRelative } from "../util/path"
import { QuartzPluginData } from "../plugins/vfile"
import { Date, getDate } from "./Date"
import { QuartzComponent, QuartzComponentProps } from "./types"
import { GlobalConfiguration } from "../cfg"

export type SortFn = (f1: QuartzPluginData, f2: QuartzPluginData) => number

function knowledgeType(file: QuartzPluginData): string {
  const frontmatter = file.frontmatter as Record<string, unknown> | undefined
  return typeof frontmatter?.knowledge_type === "string" ? frontmatter.knowledge_type : ""
}

function breadboardType(file: QuartzPluginData): string {
  const frontmatter = file.frontmatter as Record<string, unknown> | undefined
  if (typeof frontmatter?.breadboardType === "string") return frontmatter.breadboardType
  return typeof frontmatter?.breadboard_type === "string" ? frontmatter.breadboard_type : ""
}

function generatedNoteType(file: QuartzPluginData): string {
  const frontmatter = file.frontmatter as Record<string, unknown> | undefined
  return typeof frontmatter?.generated_note_type === "string" ? frontmatter.generated_note_type : ""
}

function isInternalConcept(file: QuartzPluginData): boolean {
  return knowledgeType(file) === "internal-concept" || breadboardType(file) === "internal_concept"
}

function readingOrderRank(file: QuartzPluginData): number {
  const type = knowledgeType(file)
  const slug = String(file.slug ?? "").toLowerCase()
  const filePath = String(file.filePath ?? "")
    .replace(/\\/g, "/")
    .toLowerCase()
  if (slug.includes("/learning/") || filePath.includes("/learning/")) return 0
  if (
    type === "topic-overview" ||
    type === "learning-map" ||
    type === "source-map" ||
    type === "scope-contract"
  ) {
    return 1
  }
  if (/\/\d+\.\s*[^/]+\//.test(filePath) || type === "textbook-section") return 2
  if (type === "textbook-page" || breadboardType(file) === "textbook_page") return 3
  if (type === "source-document" || filePath.includes("/sources/")) return 4
  if (isInternalConcept(file)) return 9
  return 5
}

function readingOrderSort(f1: QuartzPluginData, f2: QuartzPluginData): number {
  return readingOrderRank(f1) - readingOrderRank(f2)
}

export function byDateAndAlphabetical(cfg: GlobalConfiguration): SortFn {
  return (f1, f2) => {
    const orderSort = readingOrderSort(f1, f2)
    if (orderSort !== 0) return orderSort

    // Sort by date/alphabetical
    if (f1.dates && f2.dates) {
      // sort descending
      return getDate(cfg, f2)!.getTime() - getDate(cfg, f1)!.getTime()
    } else if (f1.dates && !f2.dates) {
      // prioritize files with dates
      return -1
    } else if (!f1.dates && f2.dates) {
      return 1
    }

    // otherwise, sort lexographically by title
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? ""
    const f2Title = f2.frontmatter?.title.toLowerCase() ?? ""
    return f1Title.localeCompare(f2Title)
  }
}

export function byDateAndAlphabeticalFolderFirst(cfg: GlobalConfiguration): SortFn {
  return (f1, f2) => {
    // Sort folders first
    const f1IsFolder = isFolderPath(f1.slug ?? "")
    const f2IsFolder = isFolderPath(f2.slug ?? "")
    if (f1IsFolder && !f2IsFolder) return -1
    if (!f1IsFolder && f2IsFolder) return 1

    const orderSort = readingOrderSort(f1, f2)
    if (orderSort !== 0) return orderSort

    // If both are folders or both are files, sort by date/alphabetical
    if (f1.dates && f2.dates) {
      // sort descending
      return getDate(cfg, f2)!.getTime() - getDate(cfg, f1)!.getTime()
    } else if (f1.dates && !f2.dates) {
      // prioritize files with dates
      return -1
    } else if (!f1.dates && f2.dates) {
      return 1
    }

    // otherwise, sort lexographically by title
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? ""
    const f2Title = f2.frontmatter?.title.toLowerCase() ?? ""
    return f1Title.localeCompare(f2Title)
  }
}

type Props = {
  limit?: number
  sort?: SortFn
} & QuartzComponentProps

export const PageList: QuartzComponent = ({ cfg, fileData, allFiles, limit, sort }: Props) => {
  const sorter = sort ?? byDateAndAlphabeticalFolderFirst(cfg)
  let list = allFiles.filter((page) => !isInternalConcept(page)).sort(sorter)
  if (limit) {
    list = list.slice(0, limit)
  }

  return (
    <ul class="section-ul">
      {list.map((page) => {
        const title = page.frontmatter?.title
        const tags = page.frontmatter?.tags ?? []
        const isSourceDocument = knowledgeType(page) === "source-document"
        const isTextbookPage = knowledgeType(page) === "textbook-page"
        const isChatNodeNote =
          knowledgeType(page) === "generated-note" && generatedNoteType(page) === "chat-node"

        return (
          <li
            class={`section-li${isSourceDocument ? " source-document-entry" : ""}${
              isTextbookPage ? " textbook-page-entry" : ""
            }${isChatNodeNote ? " chat-node-note-entry" : ""}`}
          >
            <div class="section">
              <p class="meta">
                {page.dates && <Date date={getDate(cfg, page)!} locale={cfg.locale} />}
              </p>
              <div class="desc">
                <h3>
                  <a href={resolveRelative(fileData.slug!, page.slug!)} class="internal">
                    {title}
                  </a>
                </h3>
              </div>
              <ul class="tags">
                {tags.map((tag) => (
                  <li>
                    <a
                      class="internal tag-link"
                      href={resolveRelative(fileData.slug!, `tags/${tag}` as FullSlug)}
                    >
                      {tag}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

PageList.css = `
.section h3 {
  margin: 0;
}

.section > .tags {
  margin: 0;
}
`
