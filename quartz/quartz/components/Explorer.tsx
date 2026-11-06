import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/explorer.scss"

// @ts-ignore
import script from "./scripts/explorer.inline"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"
import { FileTrieNode } from "../util/fileTrie"
import { compareGardenNodes } from "../util/gardenOrder"
import OverflowListFactory from "./OverflowList"
import { concatenateResources } from "../util/resources"

type OrderEntries = "sort" | "filter" | "map"

export interface Options {
  title?: string
  showTitle?: boolean
  folderDefaultState: "collapsed" | "open"
  folderClickBehavior: "collapse" | "link"
  useSavedState: boolean
  sortFn: (a: FileTrieNode, b: FileTrieNode) => number
  filterFn: (node: FileTrieNode) => boolean
  mapFn: (node: FileTrieNode) => void
  order: OrderEntries[]
}

const defaultOptions: Options = {
  showTitle: true,
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
  sortFn: compareGardenNodes,
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
    const gardenClusterFolders = Array.isArray(fm?.garden_cluster_folders)
      ? fm.garden_cluster_folders.filter((value): value is string => typeof value === "string")
      : []
    const gardenScope = typeof fm?.garden_scope === "string" ? fm.garden_scope : ""

    return (
      <div
        class={classNames(displayClass, "explorer", opts.showTitle ? "has-title" : "titleless")}
        data-behavior={opts.folderClickBehavior}
        data-collapsed={opts.folderDefaultState}
        data-savestate={opts.useSavedState}
        data-garden-scope={gardenScope}
        data-graph-clusters={JSON.stringify(graphClusters)}
        data-garden-cluster-folders={JSON.stringify(gardenClusterFolders)}
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
          aria-label={opts.title ?? i18n(cfg.locale).components.explorer.title}
          aria-expanded={false}
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
        {opts.showTitle ? (
          <button
            type="button"
            class="title-button explorer-toggle desktop-explorer"
            data-mobile={false}
            aria-controls={id}
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
        ) : null}
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
              <div class="folder-title-clip">
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
