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

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
  "aria-hidden": true,
}

const HighlightIcon = () => (
  <svg {...iconProps}>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </svg>
)

const CopyIcon = () => (
  <svg {...iconProps}>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg {...iconProps}>
    <path d="m20 6-11 11-5-5" />
  </svg>
)

const EraserIcon = () => (
  <svg {...iconProps}>
    <path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
)

const ChevronIcon = () => (
  <svg {...iconProps} width={14} height={14}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const Highlighter: QuartzComponent = () => (
  <div class="bb-highlighter" hidden>
    <div class="bb-highlight-menu" role="toolbar" aria-label="Highlight selected text">
      <button
        type="button"
        class="bb-highlight-button"
        data-highlight-action="apply"
        title="Highlight selection"
        aria-label="Highlight selection"
      >
        <HighlightIcon />
      </button>
      <button
        type="button"
        class="bb-highlight-button bb-highlight-copy"
        data-highlight-action="copy"
        title="Copy selection"
        aria-label="Copy selection"
      >
        <span class="bb-highlight-icon-idle">
          <CopyIcon />
        </span>
        <span class="bb-highlight-icon-done">
          <CheckIcon />
        </span>
      </button>
      <button
        type="button"
        class="bb-highlight-button bb-highlight-erase"
        data-highlight-action="erase"
        title="Remove highlight"
        aria-label="Remove highlight"
        hidden
      >
        <EraserIcon />
      </button>
      <span class="bb-highlight-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="bb-highlight-trigger"
        data-highlight-action="palette"
        aria-haspopup="true"
        aria-expanded="false"
        title="Choose highlight colour"
      >
        <span class="bb-highlight-swatch" data-hl-color={DEFAULT_HIGHLIGHT_COLOR}></span>
        <span class="bb-highlight-trigger-label">Color</span>
        <ChevronIcon />
      </button>
    </div>

    <div class="bb-highlight-palette" role="menu" aria-label="Highlight colours" hidden>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          type="button"
          role="menuitemradio"
          class="bb-highlight-option"
          data-highlight-color={color.id}
          aria-checked={color.id === DEFAULT_HIGHLIGHT_COLOR ? "true" : "false"}
        >
          <span class="bb-highlight-swatch" data-hl-color={color.id}></span>
          <span class="bb-highlight-option-label">{color.label}</span>
          <span class="bb-highlight-option-check">
            <CheckIcon />
          </span>
        </button>
      ))}
      <span class="bb-highlight-palette-divider" aria-hidden="true"></span>
      <button
        type="button"
        role="menuitem"
        class="bb-highlight-option bb-highlight-option-remove"
        data-highlight-action="erase"
      >
        <span class="bb-highlight-option-icon">
          <EraserIcon />
        </span>
        <span class="bb-highlight-option-label">Remove highlight</span>
      </button>
    </div>
  </div>
)

Highlighter.afterDOMLoaded = script
Highlighter.css = styles

export default (() => Highlighter) satisfies QuartzComponentConstructor
