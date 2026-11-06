import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// @ts-ignore -- Compile the browser entry with Quartz's inline-script loader.
import documentEditorScript from "./scripts/documentEditor.inline"
// @ts-ignore -- Compile with Quartz's inline-script loader.
import pageExportsScript from "./scripts/pageExports.inline"

const MarkdownActions: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const slug = fileData.slug
  if (!slug || slug === "index" || slug.endsWith("/index") || slug.startsWith("tags/")) return null
  return <div class={classNames(displayClass, "markdown-actions")} data-note-slug={slug} data-dashboard-url={process.env.DASHBOARD_URL ?? process.env.NEXT_PUBLIC_DASHBOARD_URL ?? ""}>
    <span class="markdown-action-status" aria-live="polite" />
    <button class="markdown-action-button markdown-edit-button" type="button" role="switch" aria-checked="false" aria-label="Edit page">Edit</button>
    <button class="markdown-action-button markdown-delete-button" type="button" aria-label="Delete page" title="Delete page">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" />
      </svg>
    </button>
  </div>
}
MarkdownActions.afterDOMLoaded = `${documentEditorScript}\n${pageExportsScript}`
MarkdownActions.css = `
.markdown-actions{display:flex;align-items:center;gap:.65rem;margin:.45rem 0 .65rem;min-height:1.75rem}
.markdown-action-button{border:1px solid var(--lightgray);border-radius:8px;background:var(--light);color:var(--secondary);font:inherit;font-size:.85rem;padding:.45rem .75rem;cursor:pointer}
.markdown-action-button[aria-checked=true]{background:var(--secondary);color:var(--light)}
.markdown-action-status{font-size:.8rem;color:var(--gray)}
.markdown-action-button:focus-visible{outline:2px solid var(--secondary);outline-offset:3px}
.markdown-actions>.markdown-delete-button{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;padding:.4rem;border:0;background:transparent;box-shadow:none;color:#b42332}
.markdown-actions>.markdown-delete-button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.markdown-actions>.markdown-delete-button[hidden]{display:none}
:root[saved-theme=dark] .markdown-actions>.markdown-delete-button{color:#fb7185}
.bb-document-heading{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap}.bb-document-heading>h1{flex:1;min-width:12rem}.bb-document-heading .markdown-actions{flex-wrap:wrap}
`
export default (() => MarkdownActions) satisfies QuartzComponentConstructor
