import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/explorer.scss"

// @ts-ignore
import script from "./scripts/explorer.inline"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"
import { FileTrieNode } from "../util/fileTrie"
import OverflowListFactory from "./OverflowList"
import { concatenateResources } from "../util/resources"

type OrderEntries = "sort" | "filter" | "map"

export interface Options {
  title?: string
  folderDefaultState: "collapsed" | "open"
  folderClickBehavior: "collapse" | "link"
  useSavedState: boolean
  sortFn: (a: FileTrieNode, b: FileTrieNode) => number
  filterFn: (node: FileTrieNode) => boolean
  mapFn: (node: FileTrieNode) => void
  order: OrderEntries[]
}

const defaultOptions: Options = {
  folderDefaultState: "collapsed",
  folderClickBehavior: "link",
  useSavedState: true,
  mapFn: (node) => {
    // The generated Learning/ folder inherits its index page title (the topic
    // name, e.g. "Spiking Neural Networks") as its display name. Relabel just
    // the sidebar entry to "Learning" so it reads as a clear container for the
    // numbered sections, while the landing page keeps its topic title.
    if (node.isFolder && String(node.slugSegment ?? "").toLowerCase() === "learning") {
      node.displayName = "Learning"
    }
  },
  sortFn: (a, b) => {
    const rank = (node: FileTrieNode) => {
      const segment = node.slugSegment.toLowerCase()
      const slug = String(node.slug ?? "").toLowerCase()
      const knowledgeType = node.data?.knowledgeType ?? ""
      const breadboardType = node.data?.breadboardType ?? ""
      if (segment === "learning" || slug.endsWith("/learning/index")) return 0
      if (
        knowledgeType === "topic-overview" ||
        knowledgeType === "learning-map" ||
        knowledgeType === "source-map" ||
        knowledgeType === "scope-contract"
      ) {
        return 1
      }
      if (/^\d+\b/.test(segment) || knowledgeType === "textbook-section" || knowledgeType === "learning-section")
        return 2
      if (
        knowledgeType === "textbook-page" ||
        knowledgeType === "learning-page" ||
        breadboardType === "textbook_page" ||
        breadboardType === "learning_page"
      )
        return 3
      if (segment === "sources" || knowledgeType === "source-document") return 4
      if (segment === "legacy") return 8
      if (knowledgeType === "internal-concept" || breadboardType === "internal_concept") return 9
      return 5
    }
    const rankDiff = rank(a) - rank(b)
    if (rankDiff !== 0) return rankDiff

    // Sort order: folders first, then files. Sort folders and files alphabetically
    if ((!a.isFolder && !b.isFolder) || (a.isFolder && b.isFolder)) {
      // numeric: true: Whether numeric collation should be used, such that "1" < "2" < "10"
      // sensitivity: "base": Only strings that differ in base letters compare as unequal. Examples: a ≠ b, a = á, a = A
      return a.displayName.localeCompare(b.displayName, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    }

    if (!a.isFolder && b.isFolder) {
      return 1
    } else {
      return -1
    }
  },
  filterFn: (node) => {
    const knowledgeType = node.data?.knowledgeType ?? ""
    const breadboardType = node.data?.breadboardType ?? ""
    return (
      node.slugSegment !== "tags" &&
      knowledgeType !== "internal-concept" &&
      breadboardType !== "internal_concept"
    )
  },
  order: ["filter", "map", "sort"],
}

export type FolderState = {
  path: string
  collapsed: boolean
}

let numExplorers = 0
export default ((userOpts?: Partial<Options>) => {
  const opts: Options = { ...defaultOptions, ...userOpts }
  const { OverflowList, overflowListAfterDOMLoaded } = OverflowListFactory()

  const Explorer: QuartzComponent = ({ cfg, displayClass, fileData }: QuartzComponentProps) => {
    const id = `explorer-${numExplorers++}`
    const fm = fileData.frontmatter as Record<string, unknown> | undefined
    const graphClusters = Array.isArray(fm?.graph_clusters)
      ? fm.graph_clusters.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
      : []
    const gardenScope = typeof fm?.garden_scope === "string" ? fm.garden_scope : ""

    return (
      <div
        class={classNames(displayClass, "explorer")}
        data-behavior={opts.folderClickBehavior}
        data-collapsed={opts.folderDefaultState}
        data-savestate={opts.useSavedState}
        data-garden-scope={gardenScope}
        data-graph-clusters={JSON.stringify(graphClusters)}
        data-data-fns={JSON.stringify({
          order: opts.order,
          sortFn: opts.sortFn.toString(),
          filterFn: opts.filterFn.toString(),
          mapFn: opts.mapFn.toString(),
        })}
      >
        <button
          type="button"
          class="explorer-toggle mobile-explorer hide-until-loaded"
          data-mobile={true}
          aria-controls={id}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="lucide-menu"
          >
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </button>
        <button
          type="button"
          class="title-button explorer-toggle desktop-explorer"
          data-mobile={false}
          aria-expanded={true}
        >
          <h2>{opts.title ?? i18n(cfg.locale).components.explorer.title}</h2>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="5 8 14 8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="fold"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div id={id} class="explorer-content" aria-expanded={false} role="group">
          <OverflowList class="explorer-ul" />
        </div>
        <template id="template-file">
          <li>
            <a href="#"></a>
          </li>
        </template>
        <template id="template-folder">
          <li>
            <div class="folder-container">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="5 8 14 8"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="folder-icon"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <div>
                <button class="folder-button">
                  <span class="folder-title"></span>
                </button>
              </div>
            </div>
            <div class="folder-outer">
              <ul class="content"></ul>
            </div>
          </li>
        </template>
      </div>
    )
  }

  Explorer.css = style
  Explorer.afterDOMLoaded = concatenateResources(script, overflowListAfterDOMLoaded)
  return Explorer
}) satisfies QuartzComponentConstructor
