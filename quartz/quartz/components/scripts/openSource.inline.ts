import { generatedVisualDashboardBaseUrl } from "./generatedVisualHost"

// "Open document" points at a dashboard viewer whose port changes each launch,
// so the address is resolved when clicked. The blank target lets the desktop
// shell open it in a new, selected tab.
const openSourceWindow = window as Window & { __quartzOpenSource?: boolean }
if (!openSourceWindow.__quartzOpenSource) {
  openSourceWindow.__quartzOpenSource = true
  const resolve = (event: Event) => {
    // Inside Breadboard a source's original opens right here, over its page, not in a new tab.
    const open = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a.markdown-open-source")
    if (open && event.type === "click" && document.documentElement.classList.contains("sb-source-pending")) {
      event.preventDefault(); event.stopImmediatePropagation()
      window.parent.postMessage({ type: "second-brain:source-view", open: true }, "*")
      return
    }
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-source-path]")
    if (!link) return
    const base = generatedVisualDashboardBaseUrl(location.href, document.referrer, location.ancestorOrigins?.[0])
    link.href = `${base}${link.dataset.sourcePath}`
  }
  document.addEventListener("click", resolve, true)
  document.addEventListener("auxclick", resolve, true)
  document.addEventListener("contextmenu", resolve, true)
}
