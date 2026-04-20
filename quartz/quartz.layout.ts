import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import { QuartzComponentProps } from "./quartz/components/types"

const frontmatterString = (page: QuartzComponentProps, key: string): string => {
  const value = (page.fileData.frontmatter as Record<string, unknown> | undefined)?.[key]
  return typeof value === "string" ? value : ""
}

const isHomePage = (page: QuartzComponentProps) => page.fileData.slug === "index"
const isGardenOverview = (page: QuartzComponentProps) =>
  isHomePage(page) || frontmatterString(page, "knowledge_type") === "garden-overview"
const isClusterIndex = (page: QuartzComponentProps) =>
  !isGardenOverview(page) && String(page.fileData.slug ?? "").endsWith("/index")

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Empty(),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.ConditionalRender({
      component: Component.Graph({
        variant: "home",
        title: "Full Knowledge Map",
        localGraph: {
          scope: "all",
          clickToNavigate: true,
          scale: 0.82,
          repelForce: 2.8,
          centerForce: 0.035,
          linkDistance: 175,
          fontSize: 0.82,
        },
        globalGraph: {
          scope: "all",
          clickToNavigate: true,
          scale: 1.08,
          repelForce: 3,
          centerForce: 0.035,
          linkDistance: 190,
          fontSize: 0.84,
        },
      }),
      condition: isGardenOverview,
    }),
    Component.ConditionalRender({
      component: Component.Graph({
        variant: "home",
        title: "Knowledge Map",
        localGraph: {
          scope: "cluster",
          clickToNavigate: true,
          scale: 0.82,
          repelForce: 2.8,
          centerForce: 0.035,
          linkDistance: 175,
          fontSize: 0.82,
        },
        globalGraph: {
          scope: "cluster",
          clickToNavigate: true,
          scale: 1.08,
          repelForce: 3,
          centerForce: 0.035,
          linkDistance: 190,
          fontSize: 0.84,
        },
      }),
      condition: isClusterIndex,
    }),
    Component.ConditionalRender({
      component: Component.HomeOverview(),
      condition: isGardenOverview,
    }),
    Component.MarkdownActions(),
    Component.TagList(),
  ],
  left: [
    Component.PageTitle(),
    Component.DashboardBackLink(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
      ],
    }),
    Component.Explorer(),
  ],
  right: [
    Component.ConditionalRender({
      component: Component.Graph(),
      condition: (page) => !isGardenOverview(page) && !isClusterIndex(page),
    }),
    Component.DesktopOnly(Component.TableOfContents()),
    Component.Backlinks(),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.ConditionalRender({
      component: Component.Graph({
        variant: "home",
        title: "Knowledge Map",
        localGraph: {
          scope: "cluster",
          clickToNavigate: true,
          scale: 0.82,
          repelForce: 2.8,
          centerForce: 0.035,
          linkDistance: 175,
          fontSize: 0.82,
        },
        globalGraph: {
          scope: "cluster",
          clickToNavigate: true,
          scale: 1.08,
          repelForce: 3,
          centerForce: 0.035,
          linkDistance: 190,
          fontSize: 0.84,
        },
      }),
      condition: isClusterIndex,
    }),
  ],
  left: [
    Component.PageTitle(),
    Component.DashboardBackLink(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
      ],
    }),
    Component.Explorer(),
  ],
  right: [
    Component.ConditionalRender({
      component: Component.Graph(),
      condition: (page) => !isClusterIndex(page),
    }),
  ],
}
