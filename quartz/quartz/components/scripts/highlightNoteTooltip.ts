const NOTE_SELECTOR = ".bb-hl[data-hl-note-text]"
const GAP = 8
const INSET = 12
const MAX_WIDTH = 416

/** One body-level bubble for both static marks and live editor decorations. */
export function installHighlightNoteTooltip(root: HTMLElement): () => void {
  let anchor: HTMLElement | null = null
  let bubble: HTMLDivElement | null = null
  // Marks declare this relationship when painted. Mutating ProseMirror's
  // decoration attributes on hover would make the editor redraw the mark.
  const id = "bb-highlight-note-tooltip"

  const dismiss = () => {
    observer.disconnect()
    anchor = null
    bubble?.remove()
    bubble = null
  }

  const noteAt = (target: EventTarget | null): HTMLElement | null => {
    const mark = target instanceof Element ? target.closest<HTMLElement>(NOTE_SELECTOR) : null
    return mark && root.contains(mark) ? mark : null
  }

  const show = (mark: HTMLElement) => {
    const note = mark.dataset.hlNoteText?.trim()
    if (!note || (anchor === mark && bubble?.textContent === note)) return
    dismiss()
    anchor = mark
    bubble = document.createElement("div")
    bubble.id = id
    bubble.className = "bb-chat-note bb-highlight-note-bubble"
    bubble.setAttribute("role", "tooltip")
    bubble.setAttribute("data-selection-exclude", "")
    bubble.textContent = note
    bubble.style.maxWidth = `${Math.max(0, Math.min(MAX_WIDTH, window.innerWidth - INSET * 2))}px`
    document.body.appendChild(bubble)

    const rect = mark.getBoundingClientRect()
    const { width, height } = bubble.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - GAP - INSET
    const above = rect.top - GAP - INSET
    const flip = height > below && above > below
    const left = Math.max(INSET, Math.min(rect.left, window.innerWidth - width - INSET))
    const top = flip ? rect.top - height - GAP : rect.bottom + GAP
    bubble.dataset.placement = flip ? "above" : "below"
    bubble.style.left = `${left}px`
    bubble.style.top = `${Math.max(INSET, Math.min(top, window.innerHeight - height - INSET))}px`
    bubble.style.setProperty(
      "--bb-chat-note-tail",
      `${Math.max(10, Math.min(rect.left - left + 6, width - 20))}px`,
    )
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-hl-note-text"],
    })
  }

  // Delegation survives highlight repainting and ProseMirror transactions.
  const onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    const mark = noteAt(event.target)
    if (mark) show(mark)
  }
  const onOut = (event: PointerEvent) => {
    if (anchor && (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget)))
      dismiss()
  }
  const onFocus = (event: FocusEvent) => {
    const mark = noteAt(event.target)
    if (mark) show(mark)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss()
    if (event.key !== "Enter" && event.key !== " ") return
    const mark = noteAt(event.target)
    if (mark && document.activeElement === mark) {
      event.preventDefault()
      event.stopPropagation()
      dismiss()
      mark.click()
    }
  }
  const observer = new MutationObserver(dismiss)
  root.addEventListener("pointerover", onOver)
  root.addEventListener("pointerout", onOut)
  root.addEventListener("focusin", onFocus)
  root.addEventListener("focusout", dismiss)
  document.addEventListener("pointerdown", dismiss, true)
  document.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("scroll", dismiss, { capture: true, passive: true })
  window.addEventListener("resize", dismiss, { passive: true })

  return () => {
    dismiss()
    root.removeEventListener("pointerover", onOver)
    root.removeEventListener("pointerout", onOut)
    root.removeEventListener("focusin", onFocus)
    root.removeEventListener("focusout", dismiss)
    document.removeEventListener("pointerdown", dismiss, true)
    document.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("scroll", dismiss, true)
    window.removeEventListener("resize", dismiss)
  }
}
