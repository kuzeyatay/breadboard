import { Root, Paragraph, RootContent } from "mdast"
import { Element as HastElement, ElementContent, Properties } from "hast"
import { visit } from "unist-util-visit"
import { QuartzTransformerPlugin } from "../types"
import { JSResource, CSSResource } from "../../util/resources"
// @ts-ignore
import breadboardVideoScript from "../../components/scripts/breadboardVideo.inline"
import breadboardVideoStyle from "../../components/styles/breadboardVideo.inline.scss"

/**
 * Breadboard video embeds.
 *
 * A note refers to a video the same way it refers to an image — `![Title](…)` —
 * pointing either at a file in the garden's `assets/` folder or at a YouTube
 * link. This transformer turns those into one player widget instead of the bare
 * `<video>` / `<iframe>` Obsidian-flavored Markdown would emit, so both sources
 * read as the same object in the page.
 *
 * Replaces (rather than nests inside) the surrounding paragraph when the embed
 * is the whole paragraph, because `<figure>` inside `<p>` is invalid HTML and
 * the browser would hoist it out. An embed sharing a paragraph with other text
 * degrades to a plain inline player, which is valid there.
 *
 * Pairs with `enableVideoEmbed: false` / `enableYouTubeEmbed: false` on
 * ObsidianFlavoredMarkdown — this plugin owns both cases.
 */

// .ogv but not .ogg: Obsidian-flavored Markdown reads .ogg as audio.
const VIDEO_FILE_RE = /\.(mp4|m4v|webm|ogv|mov|mkv|avi)(?:[?#].*)?$/i

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
])
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"])
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v"])

// A wikilink embed (`![[clip.mp4]]`) is rewritten by ObsidianFlavoredMarkdown
// into a raw <video> tag before this plugin runs; recover its source so those
// embeds get the same widget.
const RAW_VIDEO_RE = /^<video\s+[^>]*src="([^"]+)"[^>]*>\s*(?:<\/video>)?$/i

interface YouTubeTarget {
  id: string
  /** Start offset in seconds, 0 when the link carries none. */
  start: number
}

/** `90`, `1m30s`, `2h3m1s` → seconds. */
function parseTimestamp(raw: string | null): number {
  if (!raw) return 0
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(trimmed)
  if (!match || !match.slice(1).some(Boolean)) return 0
  const [, hours, minutes, seconds] = match
  return (
    Number.parseInt(hours ?? "0", 10) * 3600 +
    Number.parseInt(minutes ?? "0", 10) * 60 +
    Number.parseInt(seconds ?? "0", 10)
  )
}

function youtubeTarget(raw: string): YouTubeTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split("/").filter(Boolean)
  let id: string | null = null

  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    id = segments[0] ?? null
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 0) {
      id = url.searchParams.get("v")
    } else if (YOUTUBE_PATH_PREFIXES.has(segments[0])) {
      id = segments[1] ?? null
    } else {
      id = url.searchParams.get("v")
    }
  }

  if (!id || !YOUTUBE_ID_RE.test(id)) return null
  return { id, start: parseTimestamp(url.searchParams.get("t") ?? url.searchParams.get("start")) }
}

function isVideoFile(url: string): boolean {
  return VIDEO_FILE_RE.test(url)
}

function el(
  tagName: string,
  properties: Properties,
  children: ElementContent[] = [],
): HastElement {
  return { type: "element", tagName, properties, children }
}

function playIcon(): HastElement {
  return el(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    [el("path", { d: "M8 5.2v13.6a.7.7 0 0 0 1.06.6l11.2-6.8a.7.7 0 0 0 0-1.2L9.06 4.6A.7.7 0 0 0 8 5.2Z" })],
  )
}

function caption(title: string, source?: string): HastElement[] {
  if (!title && !source) return []
  const children: ElementContent[] = []
  if (title) children.push(el("span", { className: ["bb-video-title"] }, [{ type: "text", value: title }]))
  if (source) {
    children.push(el("span", { className: ["bb-video-source"] }, [{ type: "text", value: source }]))
  }
  return [el("figcaption", { className: ["bb-video-caption"] }, children)]
}

/**
 * The `data` payload that turns an mdast node into the widget element. Assigned
 * onto the containing paragraph so the `<p>` itself becomes the `<figure>`.
 */
interface FigureData {
  hName: string
  hProperties: Properties
  hChildren: ElementContent[]
}

function fileVideoFigure(src: string, title: string): FigureData {
  const stage = el("div", { className: ["bb-video-stage"] }, [
    el("video", {
      className: ["bb-video-media"],
      src,
      // Native controls are the no-JavaScript fallback; the inline script
      // removes them once it has installed the styled control bar.
      controls: true,
      preload: "metadata",
      playsInline: true,
    }),
  ])

  return {
    hName: "figure",
    hProperties: { className: ["bb-video", "bb-video--file"], "data-bb-video": "file" },
    hChildren: [stage, ...caption(title)],
  }
}

function youtubeFigure(target: YouTubeTarget, title: string): FigureData {
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
  })
  if (target.start > 0) params.set("start", String(target.start))

  // A facade, not an iframe: the page stays free of YouTube's player (and its
  // cookies) until someone actually presses play.
  const stage = el("div", { className: ["bb-video-stage", "bb-video-stage--wide"] }, [
    el("img", {
      className: ["bb-video-poster"],
      // hqdefault always exists; it is 4:3, so the stage crops the pillar bars.
      src: `https://i.ytimg.com/vi/${target.id}/hqdefault.jpg`,
      alt: "",
      loading: "lazy",
      decoding: "async",
    }),
    el(
      "button",
      {
        type: "button",
        className: ["bb-video-play"],
        "aria-label": title ? `Play ${title}` : "Play video",
      },
      [playIcon()],
    ),
  ])

  return {
    hName: "figure",
    hProperties: {
      className: ["bb-video", "bb-video--youtube"],
      "data-bb-video": "youtube",
      "data-video-id": target.id,
      "data-embed-src": `https://www.youtube-nocookie.com/embed/${target.id}?${params.toString()}`,
    },
    hChildren: [stage, ...caption(title, "YouTube")],
  }
}

/** The single meaningful child of a paragraph, ignoring whitespace-only text. */
function soleChild(node: Paragraph): RootContent | null {
  const meaningful = node.children.filter(
    (child) => !(child.type === "text" && child.value.trim() === ""),
  )
  return meaningful.length === 1 ? (meaningful[0] as RootContent) : null
}

function figureFor(url: string, title: string): FigureData | null {
  const youtube = youtubeTarget(url)
  if (youtube) return youtubeFigure(youtube, title)
  if (isVideoFile(url)) return fileVideoFigure(url, title)
  return null
}

export const BreadboardVideos: QuartzTransformerPlugin = () => {
  return {
    name: "BreadboardVideos",
    markdownPlugins() {
      return [
        () => {
          return (tree: Root) => {
            visit(tree, "paragraph", (node: Paragraph) => {
              const only = soleChild(node)
              if (!only) return

              if (only.type === "image") {
                const figure = figureFor(only.url, (only.alt ?? "").trim())
                if (!figure) return
                node.children = []
                node.data = { ...node.data, ...figure }
                return
              }

              if (only.type === "html") {
                const match = RAW_VIDEO_RE.exec(only.value.trim())
                if (!match) return
                node.children = []
                node.data = { ...node.data, ...fileVideoFigure(match[1], "") }
              }
            })

            // Anything left over shares its paragraph with other content, where
            // a <figure> would be invalid. Render a plain player in place.
            visit(tree, "image", (node) => {
              if (node.data?.hName) return
              const youtube = youtubeTarget(node.url)
              if (youtube) {
                node.data = {
                  ...node.data,
                  hName: "iframe",
                  hProperties: {
                    className: ["bb-video-media", "bb-video-media--inline"],
                    src: `https://www.youtube-nocookie.com/embed/${youtube.id}`,
                    allow: "fullscreen",
                    loading: "lazy",
                    title: (node.alt ?? "").trim() || "YouTube video",
                    // The image handler still contributes `alt`, which neither
                    // <iframe> nor <video> accepts; null drops the attribute.
                    alt: null,
                  },
                  hChildren: [],
                }
                return
              }
              if (!isVideoFile(node.url)) return
              node.data = {
                ...node.data,
                hName: "video",
                hProperties: {
                  className: ["bb-video-media", "bb-video-media--inline"],
                  src: node.url,
                  controls: true,
                  preload: "metadata",
                  playsInline: true,
                  alt: null,
                },
                hChildren: [],
              }
            })
          }
        },
      ]
    },
    externalResources() {
      const js: JSResource[] = [
        {
          script: breadboardVideoScript,
          loadTime: "afterDOMReady",
          contentType: "inline",
        },
      ]
      const css: CSSResource[] = [
        {
          content: breadboardVideoStyle,
          inline: true,
        },
      ]
      return { js, css }
    },
  }
}
