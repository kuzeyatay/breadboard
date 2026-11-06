// Render one canonical document with the same transforms as the published
// reader. No site traversal, resource build, or publication happens here.
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkMath from "remark-math"
import rehypeKatex from "./util/rehypeKatexSource"
import { normalizeLatexDelimiters } from "./util/latexDelimiters"
import { toHtml } from "hast-util-to-html"
import { VFile } from "vfile"
import { FrontMatter } from "./plugins/transformers/frontmatter"
import { SyntaxHighlighting } from "./plugins/transformers/syntax"
import { ObsidianFlavoredMarkdown } from "./plugins/transformers/ofm"
import { GitHubFlavoredMarkdown } from "./plugins/transformers/gfm"
import { CrawlLinks } from "./plugins/transformers/links"
import { BreadboardVideos } from "./plugins/transformers/breadboardVideo"
import { BreadboardSourceVisuals } from "./plugins/transformers/breadboardSourceVisual"
import { BreadboardVisuals } from "./plugins/transformers/breadboardVisual"
import { BreadboardGeneratedVisuals } from "./plugins/transformers/breadboardGeneratedVisual"
import { PenechoBoards } from "./plugins/transformers/penechoBoard"
import { BreadboardArtifacts } from "./plugins/transformers/breadboardArtifact"
import { TableOfContents } from "./plugins/transformers/toc"
import { Description } from "./plugins/transformers/description"
import ContentMeta from "./components/ContentMeta"
import FolderContent from "./components/pages/FolderContent"
import FolderPdfExport from "./components/FolderPdfExport"
import Graph from "./components/Graph"
import Breadcrumbs from "./components/Breadcrumbs"
import { createElement } from "preact"
import { toString as markdownText } from "mdast-util-to-string"
import type { QuartzPluginData } from "./plugins/vfile"
import type { FullSlug, SimpleSlug } from "./util/path"
import { contentMetadata } from "./util/contentMeta"
import type { QuartzComponentProps } from "./components/types"
import { renderToString } from "preact-render-to-string"
import { slugifyFilePath, type FilePath } from "./util/path"
import type { BuildCtx } from "./util/ctx"
import type { Root as MarkdownRoot } from "mdast"
import { deferLongDocumentBlocks } from "./util/longDocument"

export async function renderQuartzDocument(input: {
  content: string; relativePath: string; contentRoot: string; allFiles: string[]
}) {
  const transformers = [
    FrontMatter(),
    SyntaxHighlighting({ theme: { light: "github-light", dark: "github-dark" }, keepBackground: false }),
    ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false, enableVideoEmbed: false, enableYouTubeEmbed: false }),
    BreadboardVideos(), BreadboardSourceVisuals(), BreadboardVisuals(),
    BreadboardGeneratedVisuals(), PenechoBoards(), BreadboardArtifacts(), GitHubFlavoredMarkdown(),
    TableOfContents(), CrawlLinks({ markdownLinkResolution: "shortest" }), Description(),
  ]
  const ctx = {
    argv: { directory: input.contentRoot },
    cfg: { configuration: { locale: "en-US", defaultDateType: "modified" } },
    allSlugs: input.allFiles.map(p => slugifyFilePath(p as FilePath)),
    allFiles: input.allFiles, incremental: false,
  } as BuildCtx
  const file = new VFile(input.content.trim())
  file.data.relativePath = input.relativePath as FilePath
  file.data.filePath = `${input.contentRoot}/${input.relativePath}` as FilePath
  file.data.slug = slugifyFilePath(input.relativePath as FilePath)
  for (const plugin of transformers) {
    if (plugin.textTransform) file.value = plugin.textTransform(ctx, String(file.value))
  }
  file.value = normalizeLatexDelimiters(String(file.value))
  const markdown = unified().use(remarkParse).use(transformers.flatMap(p => p.markdownPlugins?.(ctx) ?? [])).use(remarkMath)
  const tree = await markdown.run(markdown.parse(file), file)
  const html = await unified().use(remarkRehype, { allowDangerousHtml: true })
    .use(transformers.flatMap(p => p.htmlPlugins?.(ctx) ?? []))
    .use(rehypeKatex, { output: "html" }).run(tree as MarkdownRoot, file)
  // FrontMatter normalizes date/created and modified aliases just as in a
  // publication. Match Quartz's configured modified date without a site scan.
  const dateValue = file.data.frontmatter?.modified
  if (typeof dateValue === "string" || typeof dateValue === "number") {
    const date = new Date(typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? `${dateValue}T00:00:00` : dateValue)
    if (Number.isFinite(date.getTime())) file.data.dates = { created: date, modified: date, published: date }
  }
  // The canonical reader also serves notes absent from the published index.
  // Return the same metadata component as a normal Quartz page with the body.
  const contentMetaHtml = renderToString(createElement(ContentMeta(), {
    cfg: ctx.cfg.configuration, fileData: file.data, allFiles: [],
  } as unknown as QuartzComponentProps))
  return { html: toHtml(deferLongDocumentBlocks(html)), contentMetaHtml, title: file.data.frontmatter?.title, toc: file.data.toc ?? [], slug: file.data.slug }
}

/** Render the normal folder components directly from saved files. Publication
 * is not a prerequisite for opening a new or renamed folder. */
export async function renderQuartzFolder(input: {
  relativePath: string; contentRoot: string; title: string
  files: { relativePath: string; content: string }[]
}) {
  const ctx = {
    argv: { directory: input.contentRoot },
    cfg: { configuration: { locale: "en-US", defaultDateType: "modified" } },
    allSlugs: [], allFiles: input.files.map(file => file.relativePath), incremental: false,
  } as unknown as BuildCtx
  const parser = unified().use(remarkParse).use(FrontMatter().markdownPlugins!(ctx))
  const allFiles: QuartzPluginData[] = []
  for (const source of input.files) {
    const file = new VFile({ value: source.content, path: source.relativePath })
    file.data.slug = slugifyFilePath(source.relativePath as FilePath)
    file.data.filePath = source.relativePath as FilePath
    const tree = await parser.run(parser.parse(file), file) as MarkdownRoot
    file.data.text = markdownText({ ...tree, children: tree.children.filter(node => !["yaml", "toml"].includes(node.type)) })
    allFiles.push(file.data)
  }
  const slug = slugifyFilePath(`${input.relativePath}/_index.md` as FilePath)
  let fileData = allFiles.find(file => file.slug === slug)
  if (!fileData) {
    fileData = { slug, filePath: `${input.relativePath}/_index.md` as FilePath, frontmatter: { title: input.title, tags: [] } }
    allFiles.push(fileData)
  }
  fileData.frontmatter = { ...fileData.frontmatter, title: input.title }
  const props = { ctx, cfg: ctx.cfg.configuration, fileData, allFiles,
    children: [], externalResources: { css: [], js: [], additionalHead: [] },
    tree: { type: "root", children: [] }, folderSlug: input.relativePath as SimpleSlug,
  } as QuartzComponentProps
  // Folder paths on disk can contain spaces; metadata scopes use Quartz slugs.
  props.folderSlug = slug.slice(0, -"/index".length) as SimpleSlug
  const indexSource = input.files.find(file => slugifyFilePath(file.relativePath as FilePath) === slug)
  if (indexSource) {
    const description = await renderQuartzDocument({ content: indexSource.content,
      relativePath: indexSource.relativePath, contentRoot: input.contentRoot, allFiles: ctx.allFiles })
    // FolderContent accepts a parsed tree for its optional introduction.
    const { fromHtml } = await import("hast-util-from-html")
    props.tree = fromHtml(description.html, { fragment: true })
  }
  const index = Object.fromEntries(allFiles.map(file => [file.slug!, {
    slug: file.slug as FullSlug, title: file.frontmatter?.title ?? "", filePath: file.filePath,
    tags: file.frontmatter?.tags ?? [], links: [], ...contentMetadata([file.text ?? ""]),
  }]))
  return { kind: "folder" as const, slug, title: input.title,
    breadcrumbsHtml: renderToString(createElement(Breadcrumbs(), props)),
    html: renderToString(createElement(FolderContent(), props)),
    contentMetaHtml: renderToString(createElement(ContentMeta(), props)),
    folderActionsHtml: renderToString(createElement(Graph({ variant: "home", title: "Knowledge Map",
      localGraph: { mode: "auto", scope: "cluster", clickToNavigate: true, scale: 0.82,
        repelForce: 2.8, centerForce: 0.035, linkDistance: 175, fontSize: 0.82 },
      globalGraph: { mode: "auto", scope: "cluster", clickToNavigate: true, scale: 1.08,
        repelForce: 3, centerForce: 0.035, linkDistance: 190, fontSize: 0.84 },
    }), props)) + renderToString(createElement(FolderPdfExport(), props)), index, toc: [],
  }
}
