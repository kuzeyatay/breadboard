export function registerEscapeHandler(
  outsideContainer: HTMLElement | null,
  cb: () => void,
  signal?: AbortSignal,
) {
  if (!outsideContainer) return
  function click(this: HTMLElement, e: HTMLElementEventMap["click"]) {
    if (e.target !== this) return
    e.preventDefault()
    e.stopPropagation()
    cb()
  }

  function esc(e: HTMLElementEventMap["keydown"]) {
    if (!e.key.startsWith("Esc")) return
    e.preventDefault()
    cb()
  }

  outsideContainer?.addEventListener("click", click, signal ? { signal } : undefined)
  document.addEventListener("keydown", esc, signal ? { signal } : undefined)
  if (!signal) {
    window.addCleanup(() => outsideContainer?.removeEventListener("click", click))
    window.addCleanup(() => document.removeEventListener("keydown", esc))
  }
}

export function removeAllChildren(node: HTMLElement) {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}

// AliasRedirect emits HTML redirects which also have the link[rel="canonical"]
// containing the URL it's redirecting to.
// Extracting it here with regex is _probably_ faster than parsing the entire HTML
// with a DOMParser effectively twice (here and later in the SPA code), even if
// way less robust - we only care about our own generated redirects after all.
const canonicalRegex = /<link rel="canonical" href="([^"]*)">/

export async function fetchCanonical(url: URL): Promise<{ response: Response; html?: string }> {
  const response = await fetch(`${url}`)
  if (!response.headers.get("content-type")?.startsWith("text/html")) {
    return { response }
  }

  const html = await response.text()
  const redirect = html.match(canonicalRegex)?.[1]
  return redirect ? { response: await fetch(new URL(redirect, url)) } : { response, html }
}
