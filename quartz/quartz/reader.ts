// Render one canonical document with the same transforms as the published
// reader. No site traversal, resource build, or publication happens here.
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
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
    TableOfContents(), CrawlLinks({ markdownLinkResolution: "shortest" }),
  ]
  const ctx = {
    argv: { directory: input.contentRoot },
    cfg: { configuration: { locale: "en-US" } },
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
  const markdown = unified().use(remarkParse).use(transformers.flatMap(p => p.markdownPlugins?.(ctx) ?? [])).use(remarkMath)
  const tree = await markdown.run(markdown.parse(file), file)
  const html = await unified().use(remarkRehype, { allowDangerousHtml: true })
    .use(transformers.flatMap(p => p.htmlPlugins?.(ctx) ?? []))
    .use(rehypeKatex, { output: "html" }).run(tree as MarkdownRoot, file)
  return { html: toHtml(deferLongDocumentBlocks(html)), title: file.data.frontmatter?.title, toc: file.data.toc ?? [], slug: file.data.slug }
}
