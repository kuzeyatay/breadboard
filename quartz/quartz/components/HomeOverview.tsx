import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative, simplifySlug } from "../util/path"
import style from "./styles/homeOverview.scss"

type ClusterCard = {
  slug: FullSlug
  clusterSlug: string
  title: string
  description: string
  stats: {
    sources?: string
    topics?: string
    notes?: string
    links?: string
  }
}

function frontmatterString(fm: Record<string, unknown> | undefined, key: string): string {
  const value = fm?.[key]
  return typeof value === "string" ? value : ""
}

function frontmatterArray(fm: Record<string, unknown> | undefined, key: string): string[] {
  const value = fm?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function statFromText(text: string | undefined, label: string): string | undefined {
  const match = text?.match(new RegExp(`(?:^|\\n)\\s*-?\\s*${label}:\\s*([^\\n]+)`, "i"))
  return match?.[1]?.trim()
}

function clusterCards(
  allFiles: QuartzComponentProps["allFiles"],
  allowedClusters: string[] = [],
  clusterOrder: string[] = [],
): ClusterCard[] {
  const allowed = new Set(allowedClusters)
  const order = new Map(clusterOrder.map((slug, index) => [slug, index]))
  const cards = allFiles
    .filter((file) => {
      const slug = String(file.slug ?? "")
      const fm = file.frontmatter as Record<string, unknown> | undefined
      const clusterSlug = slug.replace(/\/index$/, "")
      const isAllowedCluster = allowed.size > 0 && allowed.has(clusterSlug)
      return (
        slug.endsWith("/index") &&
        (fm?.knowledge_type === "cluster-index" || isAllowedCluster) &&
        fm?.knowledge_type !== "garden-overview" &&
        (allowed.size === 0 || allowed.has(clusterSlug))
      )
    })
    .map((file) => {
      const fm = file.frontmatter as Record<string, unknown> | undefined
      const fullSlug = file.slug as FullSlug
      const clusterSlug = String(file.slug ?? "").replace(/\/index$/, "")
      const stats = {
        sources: statFromText(file.text, "Source documents"),
        topics: statFromText(file.text, "Knowledge topics"),
        notes: statFromText(file.text, "Generated chat notes"),
        links: statFromText(file.text, "Graph links"),
      }
      const fallbackDescription = `${stats.sources ?? "0"} source documents, ${stats.topics ?? "0"} topics, and ${stats.links ?? "0"} links.`
      return {
        slug: fullSlug,
        clusterSlug,
        title: typeof fm?.title === "string" ? fm.title : simplifySlug(fullSlug),
        description:
          typeof fm?.description === "string" && fm.description.trim()
            ? fm.description.trim()
            : fallbackDescription,
        stats,
      }
    })
  return cards.sort((a, b) => {
    const left = order.get(a.clusterSlug)
    const right = order.get(b.clusterSlug)
    if (left !== undefined || right !== undefined) {
      return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER)
    }
    return a.title.localeCompare(b.title)
  })
}

const HomeOverview: QuartzComponent = (props: QuartzComponentProps) => {
  const fm = props.fileData.frontmatter as Record<string, unknown> | undefined
  const scope = frontmatterString(fm, "garden_scope")
  const isGardenOverview =
    props.fileData.slug === "index" || frontmatterString(fm, "knowledge_type") === "garden-overview"
  if (!isGardenOverview) return null

  const clusters = clusterCards(
    props.allFiles,
    frontmatterArray(fm, "graph_clusters"),
    frontmatterArray(fm, "cluster_order"),
  )
  const totalSources = clusters.reduce(
    (sum, cluster) => sum + Number(cluster.stats.sources ?? 0),
    0,
  )
  const totalTopics = clusters.reduce((sum, cluster) => sum + Number(cluster.stats.topics ?? 0), 0)
  const totalNotes = clusters.reduce((sum, cluster) => sum + Number(cluster.stats.notes ?? 0), 0)
  const totalLinks = clusters.reduce((sum, cluster) => sum + Number(cluster.stats.links ?? 0), 0)
  const headerText =
    scope === "public"
      ? "Shared clusters live here, ranked by popularity."
      : scope === "private"
        ? "Your account's clusters live here. Open a cluster to work inside its scoped map."
        : "A full map of every cluster lives here. Open a cluster to work inside its own scoped map."

  return (
    <section class="home-overview">
      <div class="home-overview-header">
        <p class="eyebrow">
          {scope === "public"
            ? "Public library"
            : scope === "private"
              ? "My library"
              : "Digital Garden"}
        </p>
        <p>{headerText}</p>
      </div>
      <div class="home-overview-stats" aria-label="Garden totals">
        <span>{clusters.length} clusters</span>
        <span>{totalSources} sources</span>
        <span>{totalTopics} topics</span>
        <span>{totalNotes} chat notes</span>
        <span>{totalLinks} links</span>
      </div>
      <div class="cluster-grid">
        {clusters.length > 0 ? (
          clusters.map((cluster) => (
            <a
              class="cluster-card"
              href={resolveRelative(props.fileData.slug!, cluster.slug)}
              key={cluster.slug}
            >
              <span class="cluster-title">{cluster.title}</span>
              <span class="cluster-description">{cluster.description}</span>
              <span class="cluster-meta">
                <span>{cluster.stats.sources ?? "0"} sources</span>
                <span>{cluster.stats.topics ?? "0"} topics</span>
                <span>{cluster.stats.links ?? "0"} links</span>
              </span>
            </a>
          ))
        ) : (
          <p class="empty-clusters">No clusters yet.</p>
        )}
      </div>
    </section>
  )
}

HomeOverview.css = style

export default (() => HomeOverview) satisfies QuartzComponentConstructor
