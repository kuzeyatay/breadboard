import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/folderPdfExport.inline"

function displayNameFromSlug(slug: string): string {
  const segment = slug.split("/").filter(Boolean).at(-1) ?? "folder"
  return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

const FolderPdfExport: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
  const pageSlug = fileData.slug ?? ""
  if (!pageSlug.endsWith("/index") || pageSlug.startsWith("tags/")) return null

  const folderSlug = pageSlug.replace(/\/index$/, "")
  const clusterSlug = folderSlug.split("/").filter(Boolean)[0] ?? ""
  if (!clusterSlug) return null

  const prefix = `${folderSlug}/`
  const documents = allFiles
    .filter((file) => {
      const slug = file.slug ?? ""
      return slug.startsWith(prefix) && !slug.endsWith("/index") && !slug.startsWith("tags/")
    })
    .map((file) => ({
      slug: file.slug!,
      title: file.frontmatter?.title || displayNameFromSlug(file.slug!),
    }))
    .sort((left, right) => left.title.localeCompare(right.title))

  if (documents.length === 0) return null

  const rawTitle = fileData.frontmatter?.title?.trim() ?? ""
  const folderTitle =
    rawTitle && !rawTitle.toLowerCase().startsWith("folder:")
      ? rawTitle
      : displayNameFromSlug(folderSlug)

  return (
    <div
      class="folder-pdf-export"
      data-cluster-slug={clusterSlug}
      data-folder-slug={folderSlug}
      data-folder-title={folderTitle}
      data-documents={JSON.stringify(documents)}
    >
      <button class="folder-pdf-open" type="button">
        Export folder as PDF
      </button>

      <div class="folder-pdf-modal" hidden>
        <div class="folder-pdf-panel" role="dialog" aria-modal="true" aria-label="Export folder">
          <div class="folder-pdf-header">
            <div>
              <p class="folder-pdf-kicker">Folder PDF</p>
              <h2>Select and arrange notes</h2>
              <p class="folder-pdf-description">
                Choose the Markdown notes to include. Drag them or use the arrows to set their PDF
                order.
              </p>
            </div>
            <button class="folder-pdf-close" type="button" aria-label="Close folder PDF export">
              Close
            </button>
          </div>

          <div class="folder-pdf-toolbar">
            <span class="folder-pdf-count" aria-live="polite" />
            <div class="folder-pdf-select-actions">
              <button class="folder-pdf-select-all" type="button">
                Select all
              </button>
              <button class="folder-pdf-clear" type="button">
                Clear
              </button>
            </div>
          </div>

          <ol class="folder-pdf-list" />

          <div class="folder-pdf-footer">
            <span class="folder-pdf-status" aria-live="polite" />
            <div class="folder-pdf-footer-actions">
              <button class="folder-pdf-cancel" type="button">
                Cancel
              </button>
              <button class="folder-pdf-export-button" type="button">
                Export selected PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

FolderPdfExport.css = `
.folder-pdf-export {
  margin: 0.55rem 0 0.85rem;
}

.folder-pdf-open,
.folder-pdf-close,
.folder-pdf-select-all,
.folder-pdf-clear,
.folder-pdf-previous,
.folder-pdf-next,
.folder-pdf-up,
.folder-pdf-down,
.folder-pdf-cancel,
.folder-pdf-export-button {
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 88%, transparent);
  color: var(--secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 500;
  line-height: 1;
  padding: 0.48rem 0.68rem;
}

.folder-pdf-open:hover,
.folder-pdf-close:hover,
.folder-pdf-select-all:hover,
.folder-pdf-clear:hover,
.folder-pdf-up:hover,
.folder-pdf-down:hover,
.folder-pdf-cancel:hover {
  border-color: var(--secondary);
  color: var(--tertiary);
}

.folder-pdf-modal[hidden] {
  display: none;
}

.folder-pdf-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.64);
  backdrop-filter: blur(4px);
}

.folder-pdf-panel {
  display: flex;
  flex-direction: column;
  width: min(54rem, calc(100vw - 2rem));
  max-height: min(46rem, calc(100vh - 2rem));
  border: 1px solid var(--lightgray);
  border-radius: 10px;
  background: var(--light);
  box-shadow: none;
  overflow: hidden;
}

.folder-pdf-header,
.folder-pdf-toolbar,
.folder-pdf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
}

.folder-pdf-header,
.folder-pdf-toolbar {
  border-bottom: 1px solid var(--lightgray);
}

.folder-pdf-footer {
  border-top: 1px solid var(--lightgray);
}

.folder-pdf-kicker,
.folder-pdf-description {
  margin: 0;
  color: var(--gray);
  font-size: 0.8rem;
}

.folder-pdf-header h2 {
  margin: 0.2rem 0;
  color: var(--dark);
  font-size: 1.1rem;
  font-weight: 600;
}

.folder-pdf-select-actions,
.folder-pdf-footer-actions,
.folder-pdf-order-actions {
  display: flex;
  align-items: center;
  gap: 0.42rem;
}

.folder-pdf-count,
.folder-pdf-status {
  color: var(--gray);
  font-size: 0.82rem;
}

.folder-pdf-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--lightgray);
  font-size: 0.8rem;
}
.folder-pdf-pagination[hidden] { display: none; }

.folder-pdf-list {
  counter-reset: folder-pdf-order;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  margin: 0;
  padding: 0.85rem 1rem;
  overflow: auto;
  list-style: none;
}

.folder-pdf-item {
  counter-increment: folder-pdf-order;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  margin: 0;
  padding: 0.68rem 0.75rem;
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  background: color-mix(in srgb, var(--light) 78%, var(--lightgray));
}

.folder-pdf-item.dragging {
  opacity: 0.45;
}

.folder-pdf-drag {
  cursor: grab;
  color: var(--gray);
  font-family: var(--codeFont);
}

.folder-pdf-note {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  cursor: pointer;
}

.folder-pdf-note span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.folder-pdf-note strong::before {
  content: counter(folder-pdf-order) ". ";
  color: var(--gray);
  font-weight: normal;
}

.folder-pdf-note strong,
.folder-pdf-note small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-pdf-note strong {
  color: var(--dark);
  font-size: 0.9rem;
  font-weight: 600;
}

.folder-pdf-note small {
  color: var(--gray);
  font-size: 0.72rem;
}

.folder-pdf-checkbox {
  flex: 0 0 auto;
}

.folder-pdf-export-button {
  border-color: var(--dark);
  background: var(--dark);
  color: var(--light);
}

.folder-pdf-export-button:hover {
  opacity: 0.86;
}

.folder-pdf-export-button:disabled {
  cursor: wait;
  opacity: 0.52;
}

@media (max-width: 600px) {
  .folder-pdf-header,
  .folder-pdf-footer {
    align-items: flex-start;
  }

  .folder-pdf-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .folder-pdf-order-actions {
    grid-column: 2;
  }
}
`

FolderPdfExport.afterDOMLoaded = script

export default (() => FolderPdfExport) satisfies QuartzComponentConstructor
