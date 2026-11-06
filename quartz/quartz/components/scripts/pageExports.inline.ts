import { copyMarkdown, exportMarkdownPage } from "../../../../dashboard/src/lib/markdown-page-export"
import { generatedVisualDashboardBaseUrl } from "./generatedVisualHost"

const exportWindow = window as Window & { __quartzPageExports?: boolean; __quartzDocumentEditor?: { flush(): Promise<void> } }

if (!exportWindow.__quartzPageExports) {
  exportWindow.__quartzPageExports = true
  const styles = `
    .markdown-page-exports{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;margin:1.5rem 0 2rem;padding-top:1rem;border-top:1px solid var(--lightgray)}
    .bb-page-understanding .markdown-page-exports{margin:0 0 0 auto;padding:0;border:0}
    .markdown-page-exports button{display:inline-flex;align-items:center;gap:.45rem;min-height:2.5rem;padding:.45rem .75rem;border:1px solid var(--lightgray);border-radius:8px;background:var(--light);color:var(--secondary);font:inherit;font-size:.85rem;cursor:pointer}
    .markdown-page-exports button:hover{background:var(--highlight)}
    .markdown-page-exports button:focus-visible{outline:2px solid var(--secondary);outline-offset:3px}
    .markdown-page-exports button:disabled{opacity:.6;cursor:wait}
    .markdown-page-export-status{flex-basis:100%;font-size:.85rem;color:var(--darkgray)}
    .markdown-page-export-status:empty{display:none}
    @media print{.markdown-page-exports{display:none}}
  `
  let disposePage = () => {}

  function bind() {
    disposePage()
    const actions = document.querySelector<HTMLElement>(".markdown-actions")
    const article = document.querySelector<HTMLElement>("article.popover-hint")
    const slug = actions?.dataset.noteSlug
    if (!article || !slug || slug === "index" || slug.endsWith("/index") || slug.startsWith("tags/")) return
    if (!document.querySelector('style[data-persist="page-exports"]')) {
      const style = document.createElement("style")
      style.dataset.persist = "page-exports"
      style.textContent = styles
      document.head.append(style)
    }
    // Share the understanding row when it is mounted; editing can replace it.
    document.querySelector(".markdown-page-exports")?.remove()
    const footer = document.createElement("div")
    footer.className = "markdown-page-exports"
    footer.dataset.noHighlight = "true"
    footer.setAttribute("role", "group")
    footer.setAttribute("aria-label", "Copy or download this page")
    const status = document.createElement("span")
    status.className = "markdown-page-export-status"
    status.setAttribute("role", "status")
    status.setAttribute("aria-live", "polite")
    const controller = new AbortController()
    let pending = false
    const parentOrigin = window.parent !== window
      ? new URL(window.location.ancestorOrigins?.[0] || document.referrer || location.href).origin : ""
    const sessionId = crypto.randomUUID()
    const request = (action: string, payload?: object) => new Promise<{ content?: string; message?: string }>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const clean = () => {
        window.clearTimeout(timer)
        window.removeEventListener("message", receive)
        controller.signal.removeEventListener("abort", abort)
      }
      const receive = (event: MessageEvent) => {
        const data = event.data
        if (event.source !== window.parent || event.origin !== parentOrigin || data?.type !== "second-brain:document-editor-result" ||
          data.slug !== slug || data.sessionId !== sessionId || data.requestId !== requestId) return
        clean()
        if (data.ok) resolve(data)
        else reject(new Error(data.error || "Could not export this page. Try again."))
      }
      const abort = () => { clean(); reject(new DOMException("Page changed", "AbortError")) }
      const timer = window.setTimeout(() => { clean(); reject(new Error("Export timed out. Try again.")) }, 300_000)
      window.addEventListener("message", receive)
      controller.signal.addEventListener("abort", abort, { once: true })
      window.parent.postMessage({ type: "second-brain:document-editor", action, payload, slug, sessionId, requestId }, parentOrigin)
    })
    const buttons: HTMLButtonElement[] = []
    for (const [action, label] of [["copy", "Copy Markdown"], ["markdown", "Download .md"], ["pdf", "Download PDF"]] as const) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = label
      button.dataset.exportAction = action
      button.addEventListener("click", async () => {
        if (pending) return
        pending = true
        buttons.forEach(control => { control.disabled = true })
        status.textContent = action === "copy" ? "Copying…" : "Preparing download…"
        try {
          await exportWindow.__quartzDocumentEditor?.flush()
          if (controller.signal.aborted) return
          let message: string
          if (parentOrigin) {
            if (action === "copy") {
              const note = await request("get")
              if (typeof note.content !== "string") throw new Error("Could not read Markdown. Try again.")
              message = await copyMarkdown(note.content)
            } else {
              const result = await request("export", { format: action })
              message = result.message || "Download started."
            }
          } else {
            const [clusterSlug, ...parts] = slug.split("/")
            message = await exportMarkdownPage({ clusterSlug, slug: parts.join("/"), action,
              apiBase: actions?.dataset.dashboardUrl || generatedVisualDashboardBaseUrl(location.href, document.referrer), signal: controller.signal })
          }
          if (!controller.signal.aborted) status.textContent = message
        } catch (error) {
          if (!controller.signal.aborted) status.textContent = error instanceof Error ? error.message : "Could not export this page. Try again."
        } finally {
          pending = false
          buttons.forEach(control => { control.disabled = false })
        }
      }, { signal: controller.signal })
      buttons.push(button)
      footer.append(button)
    }
    footer.append(status)
    const placeFooter = () => {
      const understanding = article.querySelector(".bb-page-understanding")
      if (understanding) {
        if (footer.parentElement !== understanding) understanding.append(footer)
      } else if (article.nextElementSibling !== footer) {
        article.after(footer)
      }
    }
    placeFooter()
    const observer = new MutationObserver(placeFooter)
    observer.observe(article, { childList: true })
    disposePage = () => { controller.abort(); observer.disconnect(); footer.remove() }
    window.addCleanup?.(disposePage)
  }
  document.addEventListener("nav", bind)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true })
  else bind()
}
