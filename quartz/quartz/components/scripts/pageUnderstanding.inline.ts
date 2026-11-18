import { generatedVisualDashboardBaseUrl } from "./generatedVisualHost"
import { pageFlagColor, type PageUnderstanding } from "../../../../dashboard/src/lib/page-understanding-types"

document.addEventListener("nav", () => {
  const fullSlug = document.body.dataset.slug ?? ""
  const [gardenSlug, ...parts] = fullSlug.split("/")
  if (!gardenSlug || ["index", "tags", "404", "static"].includes(gardenSlug)) return
  const pageSlug = parts.join("/") || "index"
  const dashboard = generatedVisualDashboardBaseUrl(
    window.location.href, document.referrer, window.location.ancestorOrigins?.[0],
  )
  const controller = new AbortController()
  let pages: PageUnderstanding[] = []
  let bySlug = new Map<string, PageUnderstanding>()
  let loaded = false
  let saving = false
  let refreshing = false
  let failure = ""
  let signedOut = false
  let disposed = false
  let retryValue: boolean | undefined
  let pendingValue: boolean | undefined
  let editVersion = 0
  let saved = false
  const boundControls = new WeakSet<Element>()

  const displayedValue = () => pendingValue ?? (bySlug.get(pageSlug)?.understood === true)

  function paintFlags() {
    for (const flag of document.querySelectorAll<HTMLButtonElement>("[data-understanding-page]")) {
      const slug = flag.dataset.understandingPage ?? ""
      if (!slug.startsWith(`${gardenSlug}/`)) continue
      const relativeSlug = slug.slice(gardenSlug.length + 1)
      const understood = relativeSlug === pageSlug ? displayedValue() : bySlug.get(relativeSlug)?.understood === true
      const color = pageFlagColor(flag.dataset.manualFlagColor ?? "", understood)
      const swatch = flag.querySelector<HTMLElement>(".explorer-flag-swatch")
      if (swatch) swatch.style.backgroundColor = color || "transparent"
      flag.disabled = understood
      flag.title = understood ? "Understood — uncheck at the end of the page to change" : color ? `Flagged ${color}` : "Choose flag color"
      flag.setAttribute("aria-label", understood ? "Page understood" : "Flag note")
      if (understood) flag.parentElement?.classList.remove("open")
    }
  }

  function render() {
    if (disposed) return
    const article = document.querySelector<HTMLElement>("article.popover-hint")
    if (!article) return
    let footer = article.querySelector<HTMLElement>(".bb-page-understanding")
    if (!footer) {
      footer = document.createElement("div")
      footer.className = "bb-page-understanding"
      footer.dataset.noHighlight = "true"
      const label = document.createElement("label")
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      label.append(checkbox, document.createTextNode("I understand this"))
      const status = document.createElement("span")
      status.className = "bb-page-understanding-status"
      status.setAttribute("role", "status")
      status.setAttribute("aria-live", "polite")
      const retry = document.createElement("button")
      retry.type = "button"
      retry.textContent = "Retry"
      footer.append(label, status, retry)
      article.append(footer)
    }
    const checkbox = footer.querySelector<HTMLInputElement>("input")!
    const retry = footer.querySelector<HTMLButtonElement>("button")!
    if (!boundControls.has(checkbox)) {
      checkbox.addEventListener("change", () => save(checkbox.checked), { signal: controller.signal })
      retry.addEventListener("click", () => {
        if (retryValue === undefined) void refresh()
        else save(retryValue)
      }, { signal: controller.signal })
      boundControls.add(checkbox)
    }
    const understood = displayedValue()
    checkbox.checked = understood
    // Refreshing on window focus must not disable the control before a click
    // reaches it. Further clicks during a save replace the queued intent.
    checkbox.disabled = !loaded || signedOut
    footer.dataset.understood = String(understood)
    const status = failure || (saving || pendingValue !== undefined ? "Saving…" : !loaded ? "Loading…" : saved ? "Saved" : "")
    const message = footer.querySelector<HTMLElement>('[role="status"]')!
    if (message.textContent !== status) message.textContent = status
    message.hidden = !status
    retry.hidden = !failure || signedOut || saving
    paintFlags()
  }

  async function request(understood?: boolean) {
    const response = await fetch(`${dashboard}/api/page-understanding`, {
      method: "POST", credentials: "include", cache: "no-store",
      // Navigation cancels obsolete reads, but a click already made still saves
      // against its captured page even if the reader moves to another page.
      ...(understood === undefined ? { signal: controller.signal } : { keepalive: true }),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gardenSlug, ...(understood === undefined ? {} : { pageSlug, understood }) }),
    })
    const body = await response.json()
    if (!response.ok) throw Object.assign(
      new Error(response.status === 401 ? "Sign in to save your understanding." : body.error || "Could not save understanding."),
      { status: response.status },
    )
    if (!Array.isArray(body.pages)) throw new Error("Could not load understanding.")
    return body.pages as PageUnderstanding[]
  }

  function accept(next: PageUnderstanding[]) {
    pages = next
    bySlug = new Map(pages.map(page => [page.pageSlug, page]))
    loaded = true
    signedOut = false
  }

  function reportError(error: unknown) {
    signedOut = (error as { status?: number })?.status === 401
    if (signedOut) { pages = []; bySlug.clear(); loaded = false }
    failure = error instanceof Error ? error.message : "Could not save understanding."
  }

  async function refresh() {
    if (refreshing || saving || pendingValue !== undefined || retryValue !== undefined || disposed) return
    refreshing = true
    const version = editVersion
    failure = ""
    render()
    try {
      const next = await request()
      if (!disposed && editVersion === version) accept(next)
    } catch (error) {
      if (!disposed && editVersion === version) reportError(error)
    } finally {
      refreshing = false
      render()
    }
  }

  function save(understood: boolean) {
    editVersion++
    pendingValue = understood
    retryValue = undefined
    failure = ""
    saved = false
    render()
    void flush()
  }

  async function flush() {
    if (saving) return
    saving = true
    try {
      while (pendingValue !== undefined) {
        const value = pendingValue
        try {
          accept(await request(value))
          if (pendingValue === value) pendingValue = undefined
          saved = true
          if (window.parent !== window) {
            window.parent.postMessage({ type: "second-brain:understanding-changed", gardenSlug }, dashboard)
          }
        } catch (error) {
          // A failed older request must not discard a newer click.
          if (pendingValue !== value && (error as { status?: number })?.status !== 401) continue
          retryValue = pendingValue
          pendingValue = undefined
          reportError(error)
        }
        render()
      }
    } finally {
      saving = false
      render()
    }
  }

  // Canonical page refreshes replace article children without a full page load.
  // Explorer rows also mount asynchronously. Keep both tied to the saved state.
  const observer = new MutationObserver((changes) => {
    if (changes.some(change => {
      if ((change.target as Element).closest?.(".bb-page-understanding")) return false
      return [...change.addedNodes, ...change.removedNodes].some(node => node instanceof Element &&
        (node.matches("article.popover-hint, .bb-page-understanding, [data-understanding-page]") ||
          node.querySelector("article.popover-hint, [data-understanding-page]")))
    })) render()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const focus = () => { void refresh() }
  window.addEventListener("focus", focus)
  window.addCleanup(() => {
    disposed = true
    controller.abort()
    observer.disconnect()
    window.removeEventListener("focus", focus)
  })
  render()
  void refresh()
})
