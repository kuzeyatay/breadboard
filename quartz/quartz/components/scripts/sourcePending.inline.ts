// Inside Breadboard, a source note (garden/.../sources/<note>) is covered by its original: the PDF
// viewer, a player, or the Word view. This runs in <head>, before first paint, and keeps the note's
// text hidden until the dashboard opens that viewer or answers that there is none (a link source).
// It goes by the address, so pages built before this existed are covered too.
const root = document.documentElement
const embedded = window.parent !== window
if (embedded) root.classList.add("sb-embedded")
const isSourceNote = (path: string) => {
  const clean = decodeURIComponent(path).replace(/\.html$/, "").replace(/\/$/, "")
  return /\/sources\/[^/]+$/i.test(clean) && !/\/index$/i.test(clean)
}
const mark = (path: string) => root.classList.toggle("sb-source-pending", embedded && isSourceNote(path))
mark(location.pathname)
// Before the next page is swapped in, so its text never shows.
document.addEventListener("prenav", event => {
  const url = (event as CustomEvent<{ url?: string }>).detail?.url
  if (url) mark(new URL(url, location.href).pathname)
})
window.addEventListener("message", event => {
  if (event.source === window.parent && event.data?.type === "second-brain:source-none") root.classList.remove("sb-source-pending")
})
