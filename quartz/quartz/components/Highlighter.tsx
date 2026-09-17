// Selection highlighter for garden pages.
//
// Selecting text in a note pops a small floating menu; picking a colour paints
// the selection and remembers it in the reader's Breadboard account, with a
// local recovery journal. The garden's markdown is never touched. Anchoring is
// by text offset plus surrounding context; missing sentences retain their saved
// highlights so rebuilding or temporarily editing a page cannot erase them.

// @ts-ignore - resolved by esbuild at build time
import script from "./scripts/highlighter.inline"
import styles from "./styles/highlighter.scss"
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS } from "./scripts/highlightPalette"
import { QuartzComponent, QuartzComponentConstructor } from "./types"

const Highlighter: QuartzComponent = () => (
  <div class="bb-highlighter" hidden>
    <div class="bb-highlight-menu" role="toolbar" aria-label="Selected text actions">
      <div class="bb-highlight-colors" role="group" aria-label="Highlight color">
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
        class="bb-highlight-ask bb-highlight-note"
        data-highlight-action="note"
        title="Add a note to this highlight"
        aria-label="Add note"
      >
        <span>Add note</span>
      </button>
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
    <div class="bb-highlight-note-editor" role="group" aria-label="Highlight note editor" hidden>
      <textarea
        class="bb-highlight-note-input"
        rows={3}
        maxLength={4000}
        placeholder="Write a note about this highlight…"
        aria-label="Note about highlighted text"
      ></textarea>
      <div class="bb-highlight-note-actions">
        <button type="button" data-highlight-action="remove-note" class="bb-highlight-note-remove" hidden>
          Remove note
        </button>
        <button type="button" data-highlight-action="cancel-note">Cancel</button>
        <button type="button" data-highlight-action="save-note" class="bb-highlight-note-save">
          Save note
        </button>
      </div>
    </div>
  </div>
)

Highlighter.afterDOMLoaded = script
Highlighter.css = styles

export default (() => Highlighter) satisfies QuartzComponentConstructor
