import { DEFAULT_HIGHLIGHT_COLOR, HighlightColor, isHighlightColor } from "./highlightPalette"

interface StoredHighlight {
  id: string
  color: HighlightColor
  /** Offset into the article's plain text, used as the fast path on restore. */
  start: number
  end: number
  /** The highlighted text plus its neighbours, used when the offsets moved. */
  text: string
  prefix: string
  suffix: string
  createdAt: number
}

interface TextEntry {
  node: Text
  start: number
  end: number
}

interface TextMap {
  text: string
  entries: TextEntry[]
  index: Map<Text, TextEntry>
}

interface Span {
  start: number
  end: number
}

const STORAGE_PREFIX = "breadboard:garden-highlights:v1:"
const COLOR_KEY = "breadboard:garden-highlight-color:v1"
// How much text either side of a highlight is kept so it can be found again
// after the page around it changes.
const CONTEXT = 48

// Widgets, media, and rendered math own their DOM: wrapping their text in a
// <mark> would fight their layout, so they are invisible to the highlighter and
// their text is left out of the offsets entirely.
const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "video",
  "iframe",
  "button",
  ".katex",
  ".bb-video",
  ".penecho-board-block",
  ".breadboard-generated-visual-block",
  ".breadboard-visual",
  ".mermaid",
  "[data-no-highlight]",
].join(", ")

const articleRoot = (): HTMLElement | null => document.querySelector("article.popover-hint")

const storageKey = () => STORAGE_PREFIX + (document.body.dataset.slug ?? window.location.pathname)

function readStored(): StoredHighlight[] {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry: StoredHighlight) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.text === "string" &&
        entry.text.length > 0 &&
        isHighlightColor(entry.color),
    )
  } catch {
    return []
  }
}

function writeStored(list: StoredHighlight[]) {
  try {
    if (list.length === 0) localStorage.removeItem(storageKey())
    else localStorage.setItem(storageKey(), JSON.stringify(list))
  } catch {
    // A full or blocked store only costs this page's highlights, never the page.
  }
}

function readColor(): HighlightColor {
  try {
    const stored = localStorage.getItem(COLOR_KEY)
    if (isHighlightColor(stored)) return stored
  } catch {}
  return DEFAULT_HIGHLIGHT_COLOR
}

function writeColor(color: HighlightColor) {
  try {
    localStorage.setItem(COLOR_KEY, color)
  } catch {}
}

function newId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${random}`
}

/**
 * The article as one string, with a cursor back to the text node each character
 * came from. Marks are walked into rather than skipped, so an offset means the
 * same thing whether or not the page is currently painted.
 */
function buildTextMap(root: HTMLElement): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      const parent = (node as Text).parentElement
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const entries: TextEntry[] = []
  const index = new Map<Text, TextEntry>()
  let text = ""

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? ""
    const entry: TextEntry = {
      node: node as Text,
      start: text.length,
      end: text.length + value.length,
    }
    entries.push(entry)
    index.set(entry.node, entry)
    text += value
  }

  return { text, entries, index }
}

/** Where a DOM boundary point falls in the article's plain text. */
function pointOffset(map: TextMap, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = map.index.get(container as Text)
    if (entry) return entry.start + Math.min(Math.max(offset, 0), entry.end - entry.start)
  }

  // An element boundary (or a point in skipped content) sits at the start of the
  // first mapped text node that follows it.
  const point = document.createRange()
  try {
    point.setStart(container, offset)
  } catch {
    return 0
  }
  point.collapse(true)

  for (const entry of map.entries) {
    try {
      if (point.comparePoint(entry.node, 0) >= 0) return entry.start
    } catch {
      continue
    }
  }
  return map.text.length
}

function selectionSpan(map: TextMap, root: HTMLElement): Span | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  let start = pointOffset(map, range.startContainer, range.startOffset)
  let end = pointOffset(map, range.endContainer, range.endOffset)
  if (end < start) [start, end] = [end, start]

  // A sloppy drag usually grabs the whitespace at either end; painting it would
  // put colour in the gaps between blocks.
  while (start < end && /\s/.test(map.text[start])) start += 1
  while (end > start && /\s/.test(map.text[end - 1])) end -= 1

  return end > start ? { start, end } : null
}

function makeHighlight(
  text: string,
  start: number,
  end: number,
  color: HighlightColor,
): StoredHighlight {
  return {
    id: newId(),
    color,
    start,
    end,
    text: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    createdAt: Date.now(),
  }
}

function clipHighlight(
  highlight: StoredHighlight,
  text: string,
  start: number,
  end: number,
  keepId: boolean,
): StoredHighlight {
  const next = makeHighlight(text, start, end, highlight.color)
  next.createdAt = highlight.createdAt
  if (keepId) next.id = highlight.id
  return next
}

const sortHighlights = (list: StoredHighlight[]) =>
  [...list].sort((a, b) => a.start - b.start || a.end - b.end)

/**
 * Adds a span to the list while keeping every highlight disjoint: same-colour
 * neighbours merge into one, and a different colour wins the overlap.
 */
function addSpan(
  list: StoredHighlight[],
  text: string,
  span: Span,
  color: HighlightColor,
): StoredHighlight[] {
  let { start, end } = span

  // Absorbing a neighbour can bring the next one into reach, so widen until the
  // bounds settle.
  for (let pass = 0; pass < 8; pass += 1) {
    let widened = false
    for (const highlight of list) {
      if (highlight.color !== color) continue
      if (highlight.end < start || highlight.start > end) continue
      if (highlight.start < start) {
        start = highlight.start
        widened = true
      }
      if (highlight.end > end) {
        end = highlight.end
        widened = true
      }
    }
    if (!widened) break
  }

  const kept: StoredHighlight[] = []
  for (const highlight of list) {
    if (highlight.end <= start || highlight.start >= end) {
      kept.push(highlight)
      continue
    }
    if (highlight.color === color) continue // merged into the new span

    let idTaken = false
    if (highlight.start < start) {
      kept.push(clipHighlight(highlight, text, highlight.start, start, true))
      idTaken = true
    }
    if (highlight.end > end) {
      kept.push(clipHighlight(highlight, text, end, highlight.end, !idTaken))
    }
  }

  kept.push(makeHighlight(text, start, end, color))
  return sortHighlights(kept)
}

/** Erases a span, trimming or splitting whatever it crosses. */
function subtractSpan(list: StoredHighlight[], text: string, span: Span): StoredHighlight[] {
  const kept: StoredHighlight[] = []
  for (const highlight of list) {
    if (highlight.end <= span.start || highlight.start >= span.end) {
      kept.push(highlight)
      continue
    }

    let idTaken = false
    if (highlight.start < span.start) {
      kept.push(clipHighlight(highlight, text, highlight.start, span.start, true))
      idTaken = true
    }
    if (highlight.end > span.end) {
      kept.push(clipHighlight(highlight, text, span.end, highlight.end, !idTaken))
    }
  }
  return sortHighlights(kept)
}

/**
 * Finds a stored highlight in the current text: the saved offsets first, then
 * the saved context, then the nearest copy of the text itself.
 */
function resolveHighlight(text: string, highlight: StoredHighlight): Span | null {
  const quote = highlight.text
  if (!quote) return null

  if (text.slice(highlight.start, highlight.start + quote.length) === quote) {
    return { start: highlight.start, end: highlight.start + quote.length }
  }

  const withContext = highlight.prefix + quote + highlight.suffix
  const contextAt = text.indexOf(withContext)
  if (contextAt >= 0) {
    const start = contextAt + highlight.prefix.length
    return { start, end: start + quote.length }
  }

  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    const distance = Math.abs(at - highlight.start)
    if (distance < bestDistance) {
      best = at
      bestDistance = distance
    }
  }
  return best >= 0 ? { start: best, end: best + quote.length } : null
}

function clearMarks(root: HTMLElement) {
  for (const mark of Array.from(root.querySelectorAll("mark.bb-hl"))) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  root.normalize()
}

function paint(map: TextMap, list: StoredHighlight[]) {
  const pieces: { node: Text; from: number; to: number; highlight: StoredHighlight }[] = []
  for (const highlight of list) {
    for (const entry of map.entries) {
      if (entry.end <= highlight.start || entry.start >= highlight.end) continue
      const from = Math.max(highlight.start, entry.start) - entry.start
      const to = Math.min(highlight.end, entry.end) - entry.start
      if (to <= from) continue
      // The whitespace between two blocks is part of the range but painting it
      // would leave coloured slivers hanging in the margin.
      if (!(entry.node.nodeValue ?? "").slice(from, to).trim()) continue
      pieces.push({ node: entry.node, from, to, highlight })
    }
  }

  // Wrapping splits a text node and leaves everything to its left in the
  // original node, so painting back to front keeps the offsets still to come
  // valid. The list is disjoint and sorted, so `pieces` is already in document
  // order.
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i]
    try {
      const range = document.createRange()
      range.setStart(piece.node, piece.from)
      range.setEnd(piece.node, piece.to)
      const mark = document.createElement("mark")
      mark.className = "bb-hl"
      mark.dataset.hlId = piece.highlight.id
      mark.dataset.hlColor = piece.highlight.color
      range.surroundContents(mark)
    } catch {
      // A piece that will not wrap (an unbalanced range) is simply not painted.
    }
  }
}

/** Repaints the page from storage, healing anchors that moved. */
function render(root: HTMLElement): StoredHighlight[] {
  clearMarks(root)
  const map = buildTextMap(root)

  let changed = false
  const resolved: StoredHighlight[] = []
  for (const highlight of readStored()) {
    const span = resolveHighlight(map.text, highlight)
    if (!span) {
      changed = true
      continue
    }
    if (span.start !== highlight.start || span.end !== highlight.end) changed = true
    resolved.push({
      ...highlight,
      start: span.start,
      end: span.end,
      prefix: map.text.slice(Math.max(0, span.start - CONTEXT), span.start),
      suffix: map.text.slice(span.end, span.end + CONTEXT),
    })
  }

  // Re-anchoring can land two highlights on top of each other; painting assumes
  // they never overlap.
  const disjoint: StoredHighlight[] = []
  for (const highlight of sortHighlights(resolved)) {
    const previous = disjoint[disjoint.length - 1]
    if (previous && highlight.start < previous.end) {
      changed = true
      if (highlight.end <= previous.end) continue
      disjoint.push(clipHighlight(highlight, map.text, previous.end, highlight.end, true))
      continue
    }
    disjoint.push(highlight)
  }

  if (changed) writeStored(disjoint)
  paint(map, disjoint)
  return disjoint
}

document.addEventListener("nav", () => {
  const container = document.querySelector<HTMLElement>(".bb-highlighter")
  const root = articleRoot()
  if (!container || !root || container.dataset.bound === "true") return
  container.dataset.bound = "true"

  // The menu is positioned in page coordinates, so it has to hang off the body
  // rather than the column it was rendered into.
  if (container.parentElement !== document.body) document.body.appendChild(container)

  const menu = container.querySelector<HTMLElement>(".bb-highlight-menu")!
  const palette = container.querySelector<HTMLElement>(".bb-highlight-palette")!
  const trigger = container.querySelector<HTMLElement>('[data-highlight-action="palette"]')!
  const triggerSwatch = trigger.querySelector<HTMLElement>(".bb-highlight-swatch")!
  const copyButton = container.querySelector<HTMLElement>('[data-highlight-action="copy"]')!
  const eraseButton = container.querySelector<HTMLElement>(
    '.bb-highlight-menu [data-highlight-action="erase"]',
  )!

  let highlights = render(root)
  let activeColor = readColor()
  let copyResetTimer = 0
  // Escape means "leave me alone with this selection": without it the next
  // keyup would put the menu straight back.
  let dismissed = false

  const syncColorUi = () => {
    triggerSwatch.dataset.hlColor = activeColor
    for (const option of container.querySelectorAll<HTMLElement>("[data-highlight-color]")) {
      option.setAttribute(
        "aria-checked",
        option.dataset.highlightColor === activeColor ? "true" : "false",
      )
    }
  }

  const closePalette = () => {
    palette.hidden = true
    trigger.setAttribute("aria-expanded", "false")
  }

  const hide = () => {
    container.hidden = true
    closePalette()
  }

  const place = (rect: DOMRect) => {
    container.hidden = false
    container.style.visibility = "hidden"
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const gap = 10

    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))

    let top = rect.top - height - gap
    if (top < 8) top = rect.bottom + gap
    // A selection can be scrolled out of view (clicking a highlight, say); the
    // menu still has to land somewhere the reader can see it.
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8))

    container.style.left = `${left + window.scrollX}px`
    container.style.top = `${top + window.scrollY}px`
    container.style.visibility = ""
  }

  const showForSelection = () => {
    const map = buildTextMap(root)
    const span = selectionSpan(map, root)
    if (!span) {
      hide()
      return
    }

    const selection = window.getSelection()!
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hide()
      return
    }

    const overlapping = highlights.some((h) => h.start < span.end && h.end > span.start)
    eraseButton.hidden = !overlapping
    place(rect)
  }

  const currentSpan = (): { map: TextMap; span: Span } | null => {
    const map = buildTextMap(root)
    const span = selectionSpan(map, root)
    return span ? { map, span } : null
  }

  const finish = () => {
    highlights = render(root)
    window.getSelection()?.removeAllRanges()
    hide()
  }

  const applyColor = (color: HighlightColor) => {
    const current = currentSpan()
    if (!current) return
    activeColor = color
    writeColor(color)
    syncColorUi()
    highlights = addSpan(highlights, current.map.text, current.span, color)
    writeStored(highlights)
    finish()
  }

  const eraseSelection = () => {
    const current = currentSpan()
    if (!current) return
    highlights = subtractSpan(highlights, current.map.text, current.span)
    writeStored(highlights)
    finish()
  }

  const copySelection = () => {
    const text = window.getSelection()?.toString() ?? ""
    if (!text) return
    navigator.clipboard?.writeText(text).then(
      () => {
        copyButton.dataset.copied = "true"
        window.clearTimeout(copyResetTimer)
        copyResetTimer = window.setTimeout(() => delete copyButton.dataset.copied, 1400)
      },
      () => {},
    )
  }

  syncColorUi()

  // Keep the selection alive while the menu is clicked.
  const onMenuMouseDown = (event: Event) => event.preventDefault()
  container.addEventListener("mousedown", onMenuMouseDown)

  const onMenuClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-highlight-action], [data-highlight-color]",
    )
    if (!target) return
    event.preventDefault()

    const color = target.dataset.highlightColor
    if (isHighlightColor(color)) {
      applyColor(color)
      return
    }

    switch (target.dataset.highlightAction) {
      case "apply":
        applyColor(activeColor)
        break
      case "copy":
        copySelection()
        break
      case "erase":
        eraseSelection()
        break
      case "palette": {
        const open = palette.hidden
        palette.hidden = !open
        trigger.setAttribute("aria-expanded", open ? "true" : "false")
        break
      }
    }
  }
  container.addEventListener("click", onMenuClick)

  const onPointerUp = (event: PointerEvent) => {
    if (dismissed || container.contains(event.target as Node)) return
    // Let the browser settle the selection this click produced.
    window.setTimeout(showForSelection, 0)
  }
  document.addEventListener("pointerup", onPointerUp)

  const onPointerDown = (event: PointerEvent) => {
    if (container.contains(event.target as Node)) return
    dismissed = false
    hide()
  }
  document.addEventListener("pointerdown", onPointerDown)

  // Keyboard selections (shift+arrows, ctrl+A) deserve the menu too, but the
  // text map is only worth building once something is actually selected.
  const onKeyUp = (event: KeyboardEvent) => {
    if (dismissed) return
    const target = event.target as HTMLElement | null
    if (target?.closest("input, textarea, select, [contenteditable]")) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    showForSelection()
  }
  document.addEventListener("keyup", onKeyUp)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || container.hidden) return
    if (!palette.hidden) {
      closePalette()
      return
    }
    dismissed = true
    hide()
  }
  document.addEventListener("keydown", onKeyDown)

  const onSelectionChange = () => {
    // Any change of selection is a fresh intent, so a past Escape stops counting.
    dismissed = false
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) hide()
  }
  document.addEventListener("selectionchange", onSelectionChange)

  // Clicking a highlight selects it whole, so the menu can recolour or lift it.
  const onArticleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest("a")) return
    const mark = target.closest<HTMLElement>("mark.bb-hl")
    const id = mark?.dataset.hlId
    if (!id) return

    const pieces = Array.from(
      root.querySelectorAll<HTMLElement>(`mark.bb-hl[data-hl-id="${CSS.escape(id)}"]`),
    )
    if (pieces.length === 0) return

    const range = document.createRange()
    range.setStartBefore(pieces[0])
    range.setEndAfter(pieces[pieces.length - 1])
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    showForSelection()
  }
  root.addEventListener("click", onArticleClick)

  window.addCleanup(() => {
    window.clearTimeout(copyResetTimer)
    container.removeEventListener("mousedown", onMenuMouseDown)
    container.removeEventListener("click", onMenuClick)
    document.removeEventListener("pointerup", onPointerUp)
    document.removeEventListener("pointerdown", onPointerDown)
    document.removeEventListener("keyup", onKeyUp)
    document.removeEventListener("keydown", onKeyDown)
    document.removeEventListener("selectionchange", onSelectionChange)
    root.removeEventListener("click", onArticleClick)
    delete container.dataset.bound
  })
})
