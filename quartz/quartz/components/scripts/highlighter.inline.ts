import { normalizeQuartzChatLink, type QuartzChatLink } from "../../../../dashboard/src/lib/quartz-chat-link"
import { allowMarkTextSelection } from "../../../../dashboard/src/lib/chat-text-selection"
import { DEFAULT_HIGHLIGHT_COLOR, HighlightColor, isHighlightColor } from "./highlightPalette"
import { openTextHighlights } from "../../../../dashboard/src/lib/text-highlight-client"
import { generatedVisualDashboardBaseUrl } from "./generatedVisualHost"
import { installHighlightNoteTooltip } from "./highlightNoteTooltip"
import { mathAnnotationText } from "../../util/mathAnnotation"
import { restoreMathSources } from "./mathAnnotationSource"

interface StoredHighlight {
  chatLink?: QuartzChatLink
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
  note?: string
  /** Notes created without a manual highlight have no background fill. */
  noteOnly?: boolean
}

interface StoredInlineAnswer {
  requestId: string
  highlightId: string
  question: string
  answer: string
  thinking?: string
  progressNotes?: string[]
  state: "pending" | "streaming" | "complete" | "error"
  responseDurationMs?: number
  updatedAt: number
}

interface TextEntry {
  node: Text | HTMLElement
  start: number
  end: number
}

interface TextMap {
  text: string
  entries: TextEntry[]
  index: Map<Node, TextEntry>
}

interface Span {
  start: number
  end: number
}

const STORAGE_PREFIX = "breadboard:garden-highlights:v1:"
const ANSWER_STORAGE_PREFIX = "breadboard:garden-highlight-answers:v1:"
// How much text either side of a highlight is kept so it can be found again
// after the page around it changes.
const CONTEXT = 48
// Questions need enough of the page to disambiguate a tiny phrase. This is
// intentionally much wider than the relocation context above, which only has
// to find a mark after an edit.
const QUESTION_CONTEXT = 4_000
const MAX_NOTE_LENGTH = 4_000

const MATH_SELECTOR = "[data-bb-math-source], .katex"
// Equations are indexed as one source token, never as individual KaTeX glyphs.
const mathSource = (node: HTMLElement): string => {
  if (node.dataset.bbMathSource) return node.dataset.bbMathSource
  const source = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent
  return source ? mathAnnotationText(source, Boolean(node.closest('.katex-display'))) : ''
}
const mathElement = (node: Node): HTMLElement | null => {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>('[data-bb-math-source]') ?? element?.closest<HTMLElement>('.katex') ?? null
}
// Widgets and media own their DOM and stay outside text annotation offsets.
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

const answerStorageKey = () =>
  ANSWER_STORAGE_PREFIX + (document.body.dataset.slug ?? window.location.pathname)

function normalizeNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const note = value.trim().slice(0, MAX_NOTE_LENGTH)
  return note || undefined
}

function normalizeStored(parsed: unknown): StoredHighlight[] {
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []
    const entry = value as StoredHighlight
    if (
      typeof entry.id !== "string" ||
      typeof entry.text !== "string" ||
      !Number.isInteger(entry.start) || entry.start < 0 ||
      !Number.isInteger(entry.end) || entry.end <= entry.start ||
      typeof entry.prefix !== "string" || typeof entry.suffix !== "string" ||
      entry.text.length === 0 ||
      !isHighlightColor(entry.color)
    ) return []
    const note = normalizeNote(entry.note)
    const normalized = { ...entry }
    const chatLink = normalizeQuartzChatLink(entry.chatLink)
    if (chatLink) normalized.chatLink = chatLink
    else delete normalized.chatLink
    if (note) normalized.note = note
    else delete normalized.note
    if (note && entry.noteOnly === true) normalized.noteOnly = true
    else delete normalized.noteOnly
    return [normalized]
  })
}

function normalizeInlineAnswers(parsed: unknown): StoredInlineAnswer[] {
  try {
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry: StoredInlineAnswer) =>
        entry &&
        typeof entry.requestId === "string" &&
        typeof entry.highlightId === "string" &&
        typeof entry.question === "string" &&
        typeof entry.answer === "string" &&
        ["pending", "streaming", "complete", "error"].includes(entry.state),
    )
  } catch {
    return []
  }
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
function buildTextMap(root: HTMLElement, includeMath = true): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(MATH_SELECTOR)) return NodeFilter.FILTER_REJECT
      if (node instanceof Element) {
        if (node.matches(MATH_SELECTOR)) return includeMath && mathSource(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        return node.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
      }
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const entries: TextEntry[] = []
  const index = new Map<Node, TextEntry>()
  let text = ""

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node instanceof HTMLElement ? mathSource(node) : node.nodeValue ?? ""
    if (!value) continue
    const entry: TextEntry = {
      node: node as Text | HTMLElement,
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
function pointOffset(map: TextMap, container: Node, offset: number, end = false): number {
  const math = mathElement(container)
  const atom = math && map.index.get(math)
  if (atom) return end ? atom.end : atom.start
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
      const boundary = document.createRange()
      if (entry.node instanceof HTMLElement) boundary.selectNode(entry.node)
      else boundary.selectNodeContents(entry.node)
      if (point.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0) return entry.start
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
  let end = pointOffset(map, range.endContainer, range.endOffset, true)
  if (end < start) [start, end] = [end, start]

  // A sloppy drag usually grabs the whitespace at either end; painting it would
  // put colour in the gaps between blocks.
  while (start < end && /\s/.test(map.text[start])) start += 1
  while (end > start && /\s/.test(map.text[end - 1])) end -= 1

  return end > start ? { start, end } : null
}

/** Copy a rendered formula once, using its source instead of duplicated glyphs. */
function copyMathSelection(event: ClipboardEvent, root: HTMLElement) {
  const selection = window.getSelection()
  if (!event.clipboardData || !selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0).cloneRange()
  if (!root.contains(range.commonAncestorContainer)) return
  const first = mathElement(range.startContainer), last = mathElement(range.endContainer)
  if (first) range.setStartBefore(first)
  if (last) range.setEndAfter(last)
  const fragment = document.createElement('div')
  fragment.append(range.cloneContents())
  const equations = Array.from(fragment.querySelectorAll<HTMLElement>(MATH_SELECTOR))
    .filter(node => !node.parentElement?.closest(MATH_SELECTOR))
  if (!equations.some(node => mathSource(node))) return
  for (const equation of equations) {
    const source = mathSource(equation)
    if (source) equation.replaceWith(document.createTextNode(source))
  }
  fragment.querySelectorAll('.bb-object-tools').forEach(node => node.remove())
  const html = fragment.innerHTML
  fragment.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,.katex-display').forEach(node => node.append(document.createTextNode('\n\n')))
  fragment.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')))
  fragment.querySelectorAll('td,th').forEach(node => node.append(document.createTextNode('\t')))
  event.clipboardData.setData('text/plain', (fragment.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim())
  event.clipboardData.setData('text/html', html)
  event.preventDefault()
  event.stopImmediatePropagation()
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
  if (highlight.noteOnly) {
    next.noteOnly = true
    next.note = highlight.note
  }
  if (keepId) {
    next.id = highlight.id
    if (highlight.note) next.note = highlight.note
  }
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
      if (highlight.noteOnly || highlight.color !== color || !resolveHighlight(text, highlight)) continue
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

  const carriedNote = list.find((highlight) => {
    if (!highlight.note) return false
    const resolved = resolveHighlight(text, highlight)
    return Boolean(resolved && (highlight.noteOnly
      ? resolved.start < end && resolved.end > start
      : resolved.start >= start && resolved.end <= end))
  })?.note

  const kept: StoredHighlight[] = []
  for (const highlight of list) {
    if (!resolveHighlight(text, highlight) || highlight.end <= start || highlight.start >= end) {
      kept.push(highlight)
      continue
    }
    if (!highlight.noteOnly && highlight.color === color) continue // merged into the new span

    let idTaken = false
    if (highlight.start < start) {
      kept.push(clipHighlight(highlight, text, highlight.start, start, true))
      idTaken = true
    }
    if (highlight.end > end) {
      kept.push(clipHighlight(highlight, text, end, highlight.end, !idTaken))
    }
  }

  const added = makeHighlight(text, start, end, color)
  if (carriedNote) added.note = carriedNote
  kept.push(added)
  return sortHighlights(kept)
}

/** Erases a span, trimming or splitting whatever it crosses. */
function subtractSpan(list: StoredHighlight[], text: string, span: Span): StoredHighlight[] {
  const kept: StoredHighlight[] = []
  for (const highlight of list) {
    if (!resolveHighlight(text, highlight) || highlight.end <= span.start || highlight.start >= span.end) {
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
  for (const math of root.querySelectorAll<HTMLElement>('.bb-hl-math')) {
    math.classList.remove('bb-hl', 'bb-hl-math')
    for (const attr of [...math.attributes]) if (attr.name.startsWith('data-hl-')) math.removeAttribute(attr.name)
    math.removeAttribute('aria-describedby')
    math.removeAttribute('aria-label')
    math.removeAttribute('role')
    math.removeAttribute('tabindex')
  }
  const parents = new Set<Node>()
  for (const mark of Array.from(root.querySelectorAll("mark.bb-hl"))) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parents.add(parent)
  }
  // Only text split by our marks needs joining; never normalize a whole book.
  for (const parent of parents) parent.normalize()
}

function paint(map: TextMap, list: StoredHighlight[]) {
  const pieces: { node: Text | HTMLElement; from: number; to: number; highlight: StoredHighlight }[] = []
  for (const highlight of list) {
    let low = 0
    let high = map.entries.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (map.entries[middle].end <= highlight.start) low = middle + 1
      else high = middle
    }
    for (let index = low; index < map.entries.length; index += 1) {
      const entry = map.entries[index]
      if (entry.start >= highlight.end) break
      const from = Math.max(highlight.start, entry.start) - entry.start
      const to = Math.min(highlight.end, entry.end) - entry.start
      if (to <= from) continue
      // The whitespace between two blocks is part of the range but painting it
      // would leave coloured slivers hanging in the margin.
      if (!(entry.node instanceof HTMLElement) && !(entry.node.nodeValue ?? "").slice(from, to).trim()) continue
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
      const atomic = piece.node instanceof HTMLElement
      const mark = atomic ? piece.node as HTMLElement : document.createElement("mark")
      mark.classList.add("bb-hl")
      if (atomic) mark.classList.add("bb-hl-math")
      mark.dataset.hlId = piece.highlight.id
      mark.dataset.hlColor = piece.highlight.color
      if (piece.highlight.noteOnly) mark.dataset.hlNoteOnly = "true"
      if (piece.highlight.note) {
        mark.dataset.hlNote = "true"
        mark.dataset.hlNoteText = piece.highlight.note
        mark.tabIndex = 0
        mark.setAttribute("role", "button")
        mark.setAttribute("aria-label", "Open note options")
        mark.setAttribute("aria-describedby", "bb-highlight-note-tooltip")
      }
      if (!atomic) {
        range.setStart(piece.node, piece.from)
        range.setEnd(piece.node, piece.to)
        range.surroundContents(mark)
      }
    } catch {
      // A piece that will not wrap (an unbalanced range) is simply not painted.
    }
  }
}

/** Repaints the page from storage, healing anchors that moved. */
function documentEditor(): {
  renderHighlights: (entries: StoredHighlight[]) => StoredHighlight[];
  getHighlights: () => StoredHighlight[];
  setAnswerStates?: (entries: { highlightId: string; state: string }[]) => void;
} | undefined {
  return (window as unknown as { __quartzDocumentEditor?: ReturnType<typeof documentEditor> }).__quartzDocumentEditor
}

function render(root: HTMLElement, stored: StoredHighlight[]): StoredHighlight[] {
  const editor = documentEditor()
  if (editor) return editor.renderHighlights(stored)
  clearMarks(root)
  if (stored.length === 0) return []
  const map = buildTextMap(root)

  const resolved: StoredHighlight[] = []
  const unresolved: StoredHighlight[] = []
  let legacy: TextMap | undefined
  for (const highlight of stored) {
    let span = resolveHighlight(map.text, highlight)
    if (!span) {
      // Older annotations omitted equations from their quote. Preserve those
      // passages by translating their prose endpoints into the new index.
      legacy ??= buildTextMap(root, false)
      const old = resolveHighlight(legacy.text, highlight)
      if (old) {
        const first = legacy.entries.find(entry => entry.end > old.start)
        const last = legacy.entries.find(entry => entry.end >= old.end)
        if (first && last) span = {
          start: map.index.get(first.node)!.start + old.start - first.start,
          end: map.index.get(last.node)!.start + old.end - last.start,
        }
      }
    }
    if (!span) {
      // Loading, regeneration, or a temporary edit can hide the quote. Reading
      // a page must never delete the user's saved annotation.
      unresolved.push(highlight)
      continue
    }
    resolved.push({
      ...highlight,
      start: span.start,
      end: span.end,
      text: map.text.slice(span.start, span.end),
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
      if (highlight.end <= previous.end) continue
      disjoint.push(clipHighlight(highlight, map.text, previous.end, highlight.end, true))
      continue
    }
    disjoint.push(highlight)
  }

  paint(map, disjoint)
  return [...resolved, ...unresolved]
}

document.addEventListener("nav", () => {
  const container = document.querySelector<HTMLElement>(".bb-highlighter")
  const root = articleRoot()
  if (!container || !root || container.dataset.bound === "true") return
  container.dataset.bound = "true"
  const disposeNoteTooltip = installHighlightNoteTooltip(root)

  let repaintObserver: MutationObserver | undefined
  const repaint = (stored: StoredHighlight[]) => {
    // Local edits and storage updates also repaint. Mute those mutations just
    // like an external article refresh, rather than painting a second time.
    repaintObserver?.disconnect()
    try {
      return render(root, stored)
    } finally {
      repaintObserver?.observe(root, { childList: true, characterData: true, subtree: true })
    }
  }

  // The menu is positioned in page coordinates, so it has to hang off the body
  // rather than the column it was rendered into.
  if (container.parentElement !== document.body) document.body.appendChild(container)

  const menu = container.querySelector<HTMLElement>(".bb-highlight-menu")!
  const askButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[data-highlight-action="ask-chat"], [data-highlight-action="ask-inline"]',
    ),
  )
  const eraseButton = container.querySelector<HTMLElement>('[data-highlight-action="erase"]')!
  let noteButton = container.querySelector<HTMLButtonElement>('[data-highlight-action="note"]')
  if (!noteButton) {
    noteButton = document.createElement("button")
    noteButton.type = "button"
    noteButton.className = "bb-highlight-ask bb-highlight-note"
    noteButton.dataset.highlightAction = "note"
    noteButton.innerHTML = "<span>Add note</span>"
    menu.insertBefore(noteButton, askButtons[0] ?? null)
  }
  const noteButtonLabel = noteButton.querySelector<HTMLElement>("span")!
  let noteEditor = container.querySelector<HTMLElement>(".bb-highlight-note-editor")
  if (!noteEditor) {
    noteEditor = document.createElement("div")
    noteEditor.className = "bb-highlight-note-editor"
    noteEditor.hidden = true
    noteEditor.setAttribute("role", "group")
    noteEditor.setAttribute("aria-label", "Highlight note editor")
    noteEditor.innerHTML = `
      <textarea class="bb-highlight-note-input" rows="3" maxlength="4000" placeholder="Write a note about this highlight…" aria-label="Note about highlighted text"></textarea>
      <div class="bb-highlight-note-actions">
        <button type="button" data-highlight-action="remove-note" class="bb-highlight-note-remove" hidden>Remove note</button>
        <button type="button" data-highlight-action="cancel-note">Cancel</button>
        <button type="button" data-highlight-action="save-note" class="bb-highlight-note-save">Save note</button>
      </div>`
    container.appendChild(noteEditor)
  }
  const noteInput = container.querySelector<HTMLTextAreaElement>(".bb-highlight-note-input")!
  const noteRemove = container.querySelector<HTMLButtonElement>('[data-highlight-action="remove-note"]')!
  const noteSave = container.querySelector<HTMLButtonElement>('[data-highlight-action="save-note"]')!

  // Capture both keys at mount: late network replies must never save into the
  // slug of the next page after Quartz SPA navigation.
  const dashboard = generatedVisualDashboardBaseUrl(
    window.location.href, document.referrer, window.location.ancestorOrigins?.[0],
  )
  const endpoint = `${dashboard}/api/text-highlights`
  const highlightStore = openTextHighlights(storageKey(), endpoint)
  const answerStore = openTextHighlights(answerStorageKey(), endpoint)
  const writeStored = (list: StoredHighlight[]) => highlightStore.update(list)
  const writeInlineAnswers = (list: StoredInlineAnswer[]) => answerStore.update(list)
  let highlights = repaint(normalizeStored(highlightStore.getSnapshot()))
  let inlineAnswers = normalizeInlineAnswers(answerStore.getSnapshot())
  let openAnswerHighlightId: string | null = null
  let answerHostOrigin: string | null = null
  let noteTarget: { text: string; span: Span; highlightId?: string } | null = null
  let menuAnchor: DOMRect | null = null
  const autoOpenedAnswerRequests = new Set<string>()
  // Escape means "leave me alone with this selection": without it the next
  // keyup would put the menu straight back.
  let dismissed = false

  // Embedded Quartz delegates these actions to the Garden dashboard's sole
  // Assistant. A directly opened page can use its mounted page Assistant; pages
  // without garden context still hide actions that have no receiving composer.
  const hasPageAssistant = document.querySelector<HTMLElement>(".breadboard-ai") !== null
  for (const button of askButtons) {
    button.hidden = window.parent === window && !hasPageAssistant
  }

  const closeNoteEditor = () => {
    noteEditor.hidden = true
    noteTarget = null
    noteInput.value = ""
  }

  const hide = () => {
    closeNoteEditor()
    container.hidden = true
  }

  const answerPopover = document.createElement("section")
  answerPopover.className = "bb-highlight-answer"
  answerPopover.hidden = true
  answerPopover.setAttribute("role", "dialog")
  answerPopover.setAttribute("aria-label", "Answer about highlighted text")
  answerPopover.innerHTML = `
    <header class="bb-highlight-answer-header">
      <div class="bb-highlight-answer-question">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 5v5a4 4 0 0 0 4 4h11m-3-3 3 3-3 3"></path>
        </svg>
        <span class="bb-highlight-answer-question-text"></span>
      </div>
      <div class="bb-highlight-answer-tools">
        <button type="button" class="bb-highlight-answer-tool bb-highlight-answer-delete" data-answer-action="delete" aria-label="Delete highlight" title="Delete highlight">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7"></path>
          </svg>
        </button>
        <button type="button" class="bb-highlight-answer-tool bb-highlight-answer-run" data-answer-action="retry" aria-label="Ask this question again" title="Retry">
          <svg class="bb-highlight-answer-retry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20 6v5h-5M4 18v-5h5m9.7-3A7 7 0 0 0 6.1 7.1L4 11m16 2-2.1 3.9A7 7 0 0 1 5.3 14"></path>
          </svg>
          <span class="bb-highlight-answer-stop-icon" aria-hidden="true"></span>
        </button>
        <button type="button" class="bb-highlight-answer-tool" data-answer-action="close" aria-label="Close answer" title="Close answer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" d="m6 6 12 12M18 6 6 18"></path></svg>
        </button>
      </div>
    </header>
    <div class="bb-highlight-answer-status" aria-live="polite"></div>
    <div class="bb-highlight-answer-body"></div>
  `
  document.body.appendChild(answerPopover)
  const answerQuestion = answerPopover.querySelector<HTMLElement>(
    ".bb-highlight-answer-question-text",
  )!
  const answerStatus = answerPopover.querySelector<HTMLElement>(".bb-highlight-answer-status")!
  const answerBody = answerPopover.querySelector<HTMLElement>(".bb-highlight-answer-body")!
  const answerRun = answerPopover.querySelector<HTMLButtonElement>(".bb-highlight-answer-run")!

  const answerForHighlight = (highlightId: string) =>
    [...inlineAnswers].reverse().find((answer) => answer.highlightId === highlightId)

  const syncAnswerMarks = () => {
    const editor = documentEditor()
    if (editor?.setAnswerStates) {
      editor.setAnswerStates(inlineAnswers)
      return
    }
    const answered = new Map(inlineAnswers.map((answer) => [answer.highlightId, answer.state]))
    const chatLinks = new Map(highlights.map(item => [item.id, item.chatLink]))
    for (const mark of root.querySelectorAll<HTMLElement>(".bb-hl")) {
      const state = mark.dataset.hlId ? answered.get(mark.dataset.hlId) : undefined
      if (state) mark.dataset.hlAnswer = state
      else delete mark.dataset.hlAnswer
      const chatLink = mark.dataset.hlId ? chatLinks.get(mark.dataset.hlId) : undefined
      if (chatLink) {
        mark.dataset.hlChat = "true"
        mark.setAttribute("role", "button")
        mark.tabIndex = 0
        mark.setAttribute("aria-label", "Open question in chat")
      } else delete mark.dataset.hlChat
    }
  }

  const highlightRect = (highlightId: string): DOMRect | null => {
    const pieces = Array.from(
      root.querySelectorAll<HTMLElement>(`.bb-hl[data-hl-id="${CSS.escape(highlightId)}"]`),
    )
    if (pieces.length === 0) return null
    const range = document.createRange()
    range.setStartBefore(pieces[0])
    range.setEndAfter(pieces[pieces.length - 1])
    return range.getBoundingClientRect()
  }

  const closeAnswer = () => {
    openAnswerHighlightId = null
    answerPopover.hidden = true
    if (answerHostOrigin) window.parent.postMessage(
      { type: "second-brain:assistant-inline-popover", open: false }, answerHostOrigin,
    )
  }

  const placeAnswer = (rect: DOMRect) => {
    answerPopover.hidden = false
    answerPopover.style.visibility = "hidden"
    const width = Math.min(580, window.innerWidth - 32)
    answerPopover.style.width = `${width}px`
    const gap = 14
    let left = rect.left - 24
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16))
    answerPopover.style.maxHeight = `${Math.max(0, window.innerHeight - 32)}px`
    const height = answerPopover.offsetHeight
    let top = rect.bottom + gap
    if (top + height > window.innerHeight - 16) top = rect.top - height - gap
    top = Math.max(16, top)
    answerPopover.style.left = `${left + window.scrollX}px`
    answerPopover.style.top = `${top + window.scrollY}px`
    answerPopover.style.visibility = ""
  }

  const renderAnswer = (highlightId: string, open = false) => {
    const answer = answerForHighlight(highlightId)
    const rect = highlightRect(highlightId)
    if (!answer || !rect) {
      if (openAnswerHighlightId === highlightId) closeAnswer()
      return
    }
    if (open) openAnswerHighlightId = highlightId
    if (openAnswerHighlightId !== highlightId) return
    if (answerHostOrigin) {
      answerPopover.hidden = true
      window.parent.postMessage({
        type: "second-brain:assistant-inline-popover", open: true,
        ...answer, anchor: rect.toJSON(),
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      }, answerHostOrigin)
      return
    }
    answerQuestion.textContent = answer.question
    answerBody.textContent = answer.answer
    const pending = answer.state === "pending" || answer.state === "streaming"
    answerRun.dataset.answerAction = pending ? "stop" : "retry"
    answerRun.setAttribute("aria-label", pending ? "Stop this answer" : "Ask this question again")
    answerRun.title = pending ? "Stop" : "Retry"
    answerRun.dataset.pending = pending ? "true" : "false"
    answerRun.disabled = false
    answerRun.removeAttribute("aria-busy")
    answerStatus.textContent = pending
      ? (answer.answer ? "Answering…" : "Thinking…")
      : answer.state === "error"
        ? "Answer incomplete"
        : answer.responseDurationMs !== undefined
          ? `Thought for ${(answer.responseDurationMs / 1000).toFixed(1)}s`
          : ""
    answerStatus.hidden = !answerStatus.textContent
    answerBody.hidden = !answer.answer
    placeAnswer(rect)
  }

  syncAnswerMarks()

  const place = (rect: DOMRect) => {
    menuAnchor = rect
    container.hidden = false
    container.style.visibility = "hidden"
    const width = container.offsetWidth
    const height = container.offsetHeight
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
    if (documentEditor()) highlights = documentEditor()!.getHighlights()
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 ||
      !root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      hide()
      return
    }
    const map = buildTextMap(root)
    const span = selectionSpan(map, root)
    if (!span) {
      hide()
      return
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hide()
      return
    }

    const overlapping = highlights.find((h) => h.start < span.end && h.end > span.start)
    eraseButton.hidden = !overlapping
    noteButtonLabel.textContent = overlapping?.note ? "Edit note" : "Add note"
    noteButton.setAttribute("aria-label", overlapping?.note ? "Edit note" : "Add note")
    noteButton.title = overlapping?.note ? "Edit note" : "Add a note to this highlight"
    place(rect)
  }

  const currentSpan = (): { map: TextMap; span: Span } | null => {
    if (documentEditor()) highlights = documentEditor()!.getHighlights()
    const map = buildTextMap(root)
    const span = selectionSpan(map, root)
    return span ? { map, span } : null
  }

  const finish = () => {
    highlights = repaint(highlights)
    syncAnswerMarks()
    if (!documentEditor()) window.getSelection()?.removeAllRanges()
    hide()
  }

  const applyColor = (color: HighlightColor) => {
    const current = currentSpan()
    if (!current) return
    const existing = highlights.find((highlight) => {
      const span = resolveHighlight(current.map.text, highlight)
      return span?.start === current.span.start && span.end === current.span.end
    })
    highlights = addSpan(highlights, current.map.text, current.span, color)
    if (existing?.note) {
      const recolored = highlights.find(
        (highlight) => highlight.start <= current.span.start && highlight.end >= current.span.end,
      )
      if (recolored) recolored.note = existing.note
    }
    writeStored(highlights)
    finish()
  }

  const openNoteEditor = () => {
    const current = currentSpan()
    if (!current) return
    const highlight = highlights.find((candidate) => {
      const span = resolveHighlight(current.map.text, candidate)
      return Boolean(span && span.start < current.span.end && span.end > current.span.start)
    })
    noteTarget = {
      text: current.map.text,
      span: current.span,
      ...(highlight ? { highlightId: highlight.id } : {}),
    }
    noteInput.value = highlight?.note ?? ""
    noteRemove.hidden = !highlight?.note
    noteSave.disabled = !noteInput.value.trim()
    noteEditor.hidden = false
    const rect = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      : menuAnchor
    if (rect) place(rect)
    window.setTimeout(() => noteInput.focus(), 0)
  }

  const saveNote = () => {
    const target = noteTarget
    const note = normalizeNote(noteInput.value)
    if (!target || !note) return
    let highlight = target.highlightId
      ? highlights.find((candidate) => candidate.id === target.highlightId)
      : undefined
    if (!highlight) {
      highlight = makeHighlight(target.text, target.span.start, target.span.end, "blue")
      highlight.noteOnly = true
      highlights = sortHighlights([...highlights, highlight])
    }
    if (!highlight) return
    highlight.note = note
    writeStored(highlights)
    finish()
  }

  const removeNote = () => {
    if (!noteTarget?.highlightId) return
    highlights = highlights.filter((highlight) =>
      highlight.id !== noteTarget?.highlightId || !highlight.noteOnly,
    ).map((highlight) => {
      if (highlight.id !== noteTarget?.highlightId) return highlight
      const withoutNote = { ...highlight }
      delete withoutNote.note
      return withoutNote
    })
    writeStored(highlights)
    finish()
  }

  const askSelection = (
    mode: "chat" | "inline",
    supplied?: { map: TextMap; span: Span; highlightId?: string; question?: string; attachments?: unknown[] },
  ) => {
    const current = supplied ?? currentSpan()
    if (!current) return
    const text = current.map.text.slice(current.span.start, current.span.end).trim().slice(0, 4_000)
    if (!text) return

    // Asking is also a highlighting action. Keep the selected passage visibly
    // anchored while focus moves into the question editor.
    if (!supplied?.highlightId) {
      highlights = addSpan(highlights, current.map.text, current.span, DEFAULT_HIGHLIGHT_COLOR)
    }
    const painted =
      (supplied?.highlightId
        ? highlights.find((highlight) => highlight.id === supplied.highlightId)
        : undefined) ??
      highlights.find(
        (highlight) => highlight.start <= current.span.start && highlight.end >= current.span.end,
      )
    const requestId = newId()
    const highlightId = painted?.id ?? requestId
    const prefix = current.map.text.slice(
      Math.max(0, current.span.start - QUESTION_CONTEXT),
      current.span.start,
    )
    const suffix = current.map.text.slice(current.span.end, current.span.end + QUESTION_CONTEXT)
    writeStored(highlights)
    finish()
    // A new inline question starts at its mark. The host supplies the same
    // focused editor used by Reply; only submitting it dispatches a turn.
    if (mode === "inline" && !supplied?.question && window.parent !== window) {
      inlineAnswers = [
        ...inlineAnswers.filter(answer => answer.highlightId !== highlightId),
        { requestId, highlightId, question: "", answer: "", state: "complete", updatedAt: Date.now() },
      ]
      writeInlineAnswers(inlineAnswers)
      syncAnswerMarks()
      renderAnswer(highlightId, true)
      return
    }
    if (window.parent !== window) {
      window.parent.postMessage(
        {
          type: "second-brain:assistant-ask-here",
          requestId,
          highlightId,
          mode,
          text,
          prefix,
          suffix,
          ...(supplied?.question ? { question: supplied.question } : {}),
          ...(supplied?.attachments ? { attachments: supplied.attachments } : {}),
          pageSlug: document.body.dataset.slug ?? window.location.pathname,
        },
        "*",
      )
    } else {
      window.dispatchEvent(
        new CustomEvent("breadboard:assistant-ask-here", {
          detail: { requestId, highlightId, mode, text, prefix, suffix },
        }),
      )
    }
  }

  const eraseSelection = () => {
    const current = currentSpan()
    if (!current) return
    highlights = subtractSpan(highlights, current.map.text, current.span)
    writeStored(highlights)
    finish()
  }

  // Keep the selection alive while the menu is clicked.
  const onMenuMouseDown = (event: Event) => {
    if ((event.target as HTMLElement).closest("textarea")) return
    event.preventDefault()
  }
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
      case "ask-chat":
        askSelection("chat")
        break
      case "ask-inline":
        askSelection("inline")
        break
      case "erase":
        eraseSelection()
        break
      case "note":
        openNoteEditor()
        break
      case "save-note":
        saveNote()
        break
      case "remove-note":
        removeNote()
        break
      case "cancel-note":
        hide()
        break
    }
  }
  container.addEventListener("click", onMenuClick)
  const onNoteInput = () => { noteSave.disabled = !noteInput.value.trim() }
  const onNoteKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault()
      saveNote()
    }
  }
  noteInput.addEventListener("input", onNoteInput)
  noteInput.addEventListener("keydown", onNoteKeyDown)

  const onPointerUp = (event: PointerEvent) => {
    if (dismissed || container.contains(event.target as Node)) return
    // Let the browser settle the selection this click produced.
    window.setTimeout(showForSelection, 0)
  }
  document.addEventListener("pointerup", onPointerUp)

  const onPointerDown = (event: PointerEvent) => {
    const mark = (event.target as HTMLElement)?.closest<HTMLElement>(".bb-hl")
    if (event.button === 0 && mark) allowMarkTextSelection(mark)
    if (container.contains(event.target as Node) || answerPopover.contains(event.target as Node)) {
      return
    }
    dismissed = false
    hide()
    // Keep the open state until the mark's click handler can toggle it.
    if (mark?.dataset.hlId && answerForHighlight(mark.dataset.hlId)) return
    closeAnswer()
  }
  document.addEventListener("pointerdown", onPointerDown)

  // Keyboard selections (shift+arrows, ctrl+A) deserve the menu too, but the
  // text map is only worth building once something is actually selected.
  const onKeyUp = (event: KeyboardEvent) => {
    if (dismissed) return
    const target = event.target as HTMLElement | null
    if (target?.closest("input, textarea, select") || target?.closest("[contenteditable]") && !target.closest(".ProseMirror")) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    showForSelection()
  }
  document.addEventListener("keyup", onKeyUp)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    if (openAnswerHighlightId) {
      closeAnswer()
      return
    }
    if (container.hidden) return
    dismissed = true
    hide()
  }
  document.addEventListener("keydown", onKeyDown)

  const onSelectionChange = () => {
    // Any change of selection is a fresh intent, so a past Escape stops counting.
    dismissed = false
    if (!noteEditor.hidden) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) hide()
  }
  document.addEventListener("selectionchange", onSelectionChange)
  const onCopy = (event: ClipboardEvent) => copyMathSelection(event, root)
  document.addEventListener('copy', onCopy, true)

  const saveChatLink = (data: { highlightId?: unknown; pageSlug?: unknown; chatLink?: unknown }) => {
    const chatLink = normalizeQuartzChatLink(data.chatLink)
    if (!chatLink || typeof data.highlightId !== "string" ||
        (data.pageSlug && data.pageSlug !== (document.body.dataset.slug ?? window.location.pathname))) return
    let changed = false
    highlights = highlights.map(item => {
      if (item.id !== data.highlightId || JSON.stringify(item.chatLink) === JSON.stringify(chatLink)) return item
      changed = true
      return { ...item, chatLink }
    })
    if (changed) { writeStored(highlights); syncAnswerMarks() }
  }
  const onChatLink = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== dashboard || event.data?.type !== "second-brain:assistant-chat-link") return
    saveChatLink(event.data)
  }
  const onLocalChatLink = (event: Event) => saveChatLink((event as CustomEvent).detail ?? {})
  window.addEventListener("message", onChatLink)
  window.addEventListener("breadboard:assistant-chat-link", onLocalChatLink)

  const onInlineAnswer = (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const data = event.data as Record<string, unknown> | null
    if (!data || data.type !== "second-brain:assistant-inline-answer") return
    const requestId = typeof data.requestId === "string" ? data.requestId : ""
    const highlightId = typeof data.highlightId === "string" ? data.highlightId : ""
    const question = typeof data.question === "string" ? data.question.slice(0, 8_000) : ""
    const answer = typeof data.answer === "string" ? data.answer.slice(0, 100_000) : ""
    const state = data.state
    if (
      !requestId ||
      !highlightId ||
      !question.trim() ||
      !["pending", "streaming", "complete", "error"].includes(String(state))
    ) {
      return
    }
    const currentSlug = document.body.dataset.slug ?? window.location.pathname
    if (typeof data.pageSlug === "string" && data.pageSlug && data.pageSlug !== currentSlug) {
      return
    }
    const duration = Number(data.responseDurationMs)
    const next: StoredInlineAnswer = {
      requestId,
      highlightId,
      question,
      answer,
      thinking: typeof data.thinking === "string" ? data.thinking.slice(0, 100_000) : undefined,
      progressNotes: Array.isArray(data.progressNotes)
        ? data.progressNotes.filter((note): note is string => typeof note === "string").slice(-100)
        : undefined,
      state: state as StoredInlineAnswer["state"],
      ...(Number.isFinite(duration) && duration >= 0
        ? { responseDurationMs: Math.trunc(duration) }
        : {}),
      updatedAt: Date.now(),
    }
    inlineAnswers = [
      ...inlineAnswers.filter(
        (candidate) => candidate.requestId !== requestId && candidate.highlightId !== highlightId,
      ),
      next,
    ]
    writeInlineAnswers(inlineAnswers)
    syncAnswerMarks()
    // The first pending event follows submission from the question editor. Put the
    // working answer next to its passage immediately; closing it is respected
    // for the rest of the stream, and clicking the mark opens it again.
    const shouldOpen = state === "pending" && !autoOpenedAnswerRequests.has(requestId)
    if (shouldOpen) autoOpenedAnswerRequests.add(requestId)
    renderAnswer(highlightId, shouldOpen)
  }
  window.addEventListener("message", onInlineAnswer)

  const answerAction = (action: string, question?: string, attachments?: unknown[]) => {
    if (action === "close") {
      closeAnswer()
      return
    }
    const highlightId = openAnswerHighlightId
    if (!highlightId) return
    if (action === "delete") {
      highlights = highlights.filter((highlight) => highlight.id !== highlightId)
      inlineAnswers = inlineAnswers.filter((answer) => answer.highlightId !== highlightId)
      writeStored(highlights)
      writeInlineAnswers(inlineAnswers)
      closeAnswer()
      highlights = repaint(highlights)
      syncAnswerMarks()
      return
    }
    if (action === "stop") {
      const answer = answerForHighlight(highlightId)
      if (!answer) return
      answerRun.setAttribute("aria-label", "Stopping this answer")
      answerRun.setAttribute("aria-busy", "true")
      answerRun.setAttribute("title", "Stopping…")
      answerRun.disabled = true
      answerStatus.textContent = "Stopping…"
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: "second-brain:assistant-inline-stop",
            requestId: answer.requestId,
            highlightId,
            pageSlug: document.body.dataset.slug ?? window.location.pathname,
          },
          "*",
        )
      }
      return
    }
    if (action === "retry") {
      const highlight = highlights.find((candidate) => candidate.id === highlightId)
      if (!highlight) return
      const map = buildTextMap(root)
      const span = resolveHighlight(map.text, highlight)
      if (!span) return
      askSelection("inline", { map, span, highlightId, question: question ?? answerForHighlight(highlightId)?.question, attachments })
    }
  }
  const onAnswerClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button[data-answer-action]")
    if (target?.dataset.answerAction) answerAction(target.dataset.answerAction)
  }
  answerPopover.addEventListener("click", onAnswerClick)
  const onResize = () => {
    if (openAnswerHighlightId) renderAnswer(openAnswerHighlightId)
  }
  window.addEventListener("resize", onResize)
  const onAnswerHost = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent) return
    if (event.data?.type === "second-brain:assistant-inline-popover-host") {
      answerHostOrigin = event.origin
      onResize()
    }
    if (event.data?.type !== "second-brain:assistant-inline-popover-action" || event.origin !== answerHostOrigin) return
    const answer = openAnswerHighlightId ? answerForHighlight(openAnswerHighlightId) : undefined
    if (!answer || event.data.requestId !== answer.requestId || event.data.highlightId !== answer.highlightId) return
    answerAction(event.data.action, typeof event.data.question === "string" ? event.data.question.slice(0, 8_000) : undefined,
      Array.isArray(event.data.attachments) ? event.data.attachments.slice(0, 12) : undefined)
  }
  const onAnswerScroll = () => { if (answerHostOrigin) onResize() }
  window.addEventListener("message", onAnswerHost)
  window.addEventListener("scroll", onAnswerScroll, true)
  if (window.parent !== window) window.parent.postMessage(
    { type: "second-brain:assistant-inline-popover-ready" }, "*",
  )

  // Clicking a highlight selects it whole, so the menu can recolour or lift it.
  const onArticleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest("a, button")) return
    const mark = target.closest<HTMLElement>(".bb-hl")
    const id = mark?.dataset.hlId
    if (!id) return
    // A drag over a painted equation is a new selection, not a click on its mark.
    if (mark.classList.contains('bb-hl-math') && !window.getSelection()?.isCollapsed) return

    const chatLink = highlights.find(item => item.id === id)?.chatLink
    if (chatLink) {
      if (window.getSelection()?.toString().trim()) return
      event.preventDefault()
      event.stopPropagation()
      hide()
      closeAnswer()
      if (window.parent !== window) window.parent.postMessage(
        { type: "second-brain:assistant-open-chat", chatLink }, dashboard,
      )
      else window.dispatchEvent(new CustomEvent("breadboard:assistant-open-chat", { detail: { chatLink } }))
      return
    }

    if (answerForHighlight(id)) {
      if (window.getSelection()?.toString().trim()) return
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      hide()
      if (openAnswerHighlightId === id) closeAnswer()
      else renderAnswer(id, true)
      return
    }

    const pieces = Array.from(
      root.querySelectorAll<HTMLElement>(`.bb-hl[data-hl-id="${CSS.escape(id)}"]`),
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
  const onMarkKeyDown = (event: KeyboardEvent) => {
    const mark = (event.target as HTMLElement)?.closest<HTMLElement>(".bb-hl[data-hl-chat]")
    if (!mark || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    mark.click()
  }
  root.addEventListener("keydown", onMarkKeyDown)

  const saveStatus = document.createElement("div")
  saveStatus.setAttribute("role", "status")
  saveStatus.className = "bb-highlight-save-status"
  saveStatus.hidden = true
  const saveMessage = document.createElement("span")
  const retrySave = document.createElement("button")
  retrySave.type = "button"
  retrySave.textContent = "Retry saving"
  const onRetrySave = () => { void highlightStore.flush(); void answerStore.flush() }
  retrySave.addEventListener("click", onRetrySave)
  saveStatus.append(saveMessage, retrySave)
  document.body.appendChild(saveStatus)
  const saveErrors = new Map<string, string>()
  const showSaveError = (key: string, error: string | null) => {
    if (error) saveErrors.set(key, error)
    else saveErrors.delete(key)
    saveMessage.textContent = [...saveErrors.values()][0] ?? ""
    saveStatus.hidden = saveErrors.size === 0
  }
  let lastHighlightSnapshot = JSON.stringify(highlightStore.getSnapshot())
  const unsubscribeHighlights = highlightStore.subscribe((entries, error) => {
    const snapshot = JSON.stringify(entries)
    if (snapshot !== lastHighlightSnapshot) {
      lastHighlightSnapshot = snapshot
      highlights = repaint(normalizeStored(entries))
      syncAnswerMarks()
    }
    showSaveError("highlights", error)
  })
  const unsubscribeAnswers = answerStore.subscribe((entries, error) => {
    inlineAnswers = normalizeInlineAnswers(entries)
    syncAnswerMarks()
    if (openAnswerHighlightId) renderAnswer(openAnswerHighlightId)
    showSaveError("answers", error)
  })
  // A lesson may finish rendering after navigation. Retry anchors when its text
  // changes, without observing the <mark> wrappers created by our own repaint.
  const observer = new MutationObserver((changes) => {
    if (documentEditor() || highlights.length === 0) return
    // Reading controls are excluded from text anchors. Updating their save
    // status must not unwrap and repaint every highlight in a long lesson.
    if (changes.every(change => {
      const element = change.target instanceof Element ? change.target : change.target.parentElement
      return element?.closest("[data-no-highlight]") ||
        (change.type === "childList" && [...change.addedNodes, ...change.removedNodes].every(
          node => node instanceof Element && node.matches("[data-no-highlight]"),
        ))
    })) return
    highlights = repaint(highlights)
    syncAnswerMarks()
  })
  const onEditorReady = () => { highlights = repaint(highlights); syncAnswerMarks() }
  const stopMathRestore = restoreMathSources(root, dashboard, () => { highlights = repaint(highlights); syncAnswerMarks() })
  const onAnnotationList = (event: Event) => {
    const panel = (event as CustomEvent).detail?.root as HTMLElement | undefined
    if (!panel) return
    for (const answer of inlineAnswers) {
      const item = panel.querySelector(`[data-annotation-id="${CSS.escape(answer.highlightId)}"]`)
      if (!item) continue
      const question = document.createElement("strong"), content = document.createElement("p")
      question.textContent = answer.question
      content.textContent = answer.answer || (answer.state === "error" ? "Answer incomplete" : "Thinking…")
      item.append(question, content)
    }
  }
  document.addEventListener("bb:annotation-list", onAnnotationList)
  const onEditorSaved = (event: Event) => {
    const entries = (event as CustomEvent).detail?.highlights
    if (Array.isArray(entries)) { highlights = entries; writeStored(highlights); syncAnswerMarks() }
  }
  document.addEventListener("bb:editor-ready", onEditorReady)
  document.addEventListener("bb:editor-saved", onEditorSaved)
  repaintObserver = observer
  const observe = () => observer.observe(root, { childList: true, characterData: true, subtree: true })
  observe()

  window.addCleanup(() => {
    stopMathRestore()
    disposeNoteTooltip()
    closeAnswer()
    observer.disconnect()
    document.removeEventListener("bb:editor-ready", onEditorReady)
    document.removeEventListener("bb:annotation-list", onAnnotationList)
    document.removeEventListener("bb:editor-saved", onEditorSaved)
    unsubscribeHighlights()
    unsubscribeAnswers()
    retrySave.removeEventListener("click", onRetrySave)
    saveStatus.remove()
    container.removeEventListener("mousedown", onMenuMouseDown)
    container.removeEventListener("click", onMenuClick)
    noteInput.removeEventListener("input", onNoteInput)
    noteInput.removeEventListener("keydown", onNoteKeyDown)
    document.removeEventListener("pointerup", onPointerUp)
    document.removeEventListener("pointerdown", onPointerDown)
    document.removeEventListener("keyup", onKeyUp)
    document.removeEventListener("keydown", onKeyDown)
    document.removeEventListener("selectionchange", onSelectionChange)
    document.removeEventListener('copy', onCopy, true)
    window.removeEventListener("message", onInlineAnswer)
    window.removeEventListener("message", onChatLink)
    window.removeEventListener("breadboard:assistant-chat-link", onLocalChatLink)
    root.removeEventListener("keydown", onMarkKeyDown)
    window.removeEventListener("message", onAnswerHost)
    window.removeEventListener("scroll", onAnswerScroll, true)
    answerPopover.removeEventListener("click", onAnswerClick)
    window.removeEventListener("resize", onResize)
    answerPopover.remove()
    root.removeEventListener("click", onArticleClick)
    delete container.dataset.bound
  })
})
