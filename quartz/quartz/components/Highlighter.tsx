// Selection highlighter for garden pages.
//
// Selecting text in a note pops a small floating menu; picking a colour paints
// the selection and remembers it. Highlights live in the reader's own browser
// (localStorage, keyed by page slug) — the garden's markdown is never touched,
// so a rebuild of the site cannot lose or duplicate them. Anchoring is by text
// offset plus surrounding context, so a highlight survives edits elsewhere in
// the page and is dropped quietly when its sentence is gone.

// @ts-ignore - resolved by esbuild at build time
import script from "./scripts/highlighter.inline"
import styles from "./styles/highlighter.scss"
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS } from "./scripts/highlightPalette"
import { QuartzComponent, QuartzComponentConstructor } from "./types"

const Highlighter: QuartzComponent = () => (
  <div class="bb-highlighter" hidden>
    <div class="bb-highlight-menu" role="toolbar" aria-label="Selected text actions">
      <div class="bb-highlight-colors" role="group" aria-label="Highlight color">
        <span class="bb-highlight-colors-label">Highlight</span>
        {HIGHLIGHT_COLORS.filter((color) => color.id !== DEFAULT_HIGHLIGHT_COLOR).map((color) => (
          <button
            type="button"
            class="bb-highlight-color"
            data-highlight-color={color.id}
            aria-label={`Highlight ${color.label.toLowerCase()}`}
            title={color.label}
          >
            <span class="bb-highlight-swatch" data-hl-color={color.id}></span>
          </button>
        ))}
        <button
          type="button"
          class="bb-highlight-remove"
          data-highlight-action="erase"
          title="Remove highlight"
          aria-label="Remove highlight"
          hidden
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <span class="bb-highlight-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="bb-highlight-ask"
        data-highlight-action="ask-chat"
        title="Ask about this selection in chat"
        aria-label="Ask about this selection in chat"
      >
        <span>Ask in chat</span>
      </button>
      <span class="bb-highlight-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="bb-highlight-ask"
        data-highlight-action="ask-inline"
        title="Attach an answer to this highlight"
        aria-label="Attach an answer to this highlight"
      >
        <span>Ask here</span>
      </button>
    </div>
  </div>
)

Highlighter.afterDOMLoaded = script
Highlighter.css = styles

export default (() => Highlighter) satisfies QuartzComponentConstructor
