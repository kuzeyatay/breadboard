import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

function normalizedBaseUrl(value?: string): string {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return ""

  return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
}

function derivedQuartzBaseUrlFromDashboard(value?: string): string {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return ""

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (/^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(url.hostname)) {
      return `${url.hostname}:8081`
    }
    return `garden.${url.host}`
  } catch {
    return ""
  }
}

const quartzBaseUrl =
  normalizedBaseUrl(process.env.QUARTZ_BASE_URL ?? process.env.NEXT_PUBLIC_QUARTZ_URL) ||
  derivedQuartzBaseUrlFromDashboard(
    process.env.DASHBOARD_URL ?? process.env.NEXT_PUBLIC_DASHBOARD_URL,
  ) ||
  "localhost:8081"

const enableCustomOgImages = process.env.QUARTZ_CUSTOM_OG_IMAGES !== "false"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "breadboard",
    pageTitleSuffix: "",
    enableSPA: false,
    enablePopovers: true,
    analytics: {
      provider: "plausible",
    },
    locale: "en-US",
    baseUrl: quartzBaseUrl,
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        // Reading-first light theme: pale green / warm paper, dark
        // charcoal-green text, muted botanical accents. Both modes share the
        // same palette so the published garden stays consistently light.
        lightMode: {
          light: "#e6f0e6",
          lightgray: "#a6bdad",
          gray: "#50615a",
          darkgray: "#13201b",
          dark: "#0f1a16",
          secondary: "#4f6f68",
          tertiary: "#84a59d",
          highlight: "rgba(132, 165, 157, 0.20)",
          textHighlight: "#ffe27859",
        },
        darkMode: {
          light: "#e6f0e6",
          lightgray: "#a6bdad",
          gray: "#50615a",
          darkgray: "#13201b",
          dark: "#0f1a16",
          secondary: "#4f6f68",
          tertiary: "#84a59d",
          highlight: "rgba(132, 165, 157, 0.20)",
          textHighlight: "#ffe27859",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-light",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      ...(enableCustomOgImages
        ? [Plugin.CustomOgImages()]
        : []),
    ],
  },
}

export default config
