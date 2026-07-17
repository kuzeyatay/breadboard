// @ts-ignore -- Quartz's inline compiler resolves ?raw imports as source text.
import sandboxRuntime from "./generatedVisualSandbox.inline.js?raw"

type Dict = Record<string, unknown>

interface GeneratedManifestSummary {
  id: string
  version: number
  title: string
  description: string
  sourceAnchorIds?: string[]
  previousVersion?: number
}

const INIT = "breadboard-generated-visual:init"
const EVENT = "breadboard-generated-visual:event"

function isRecord(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function dashboardBaseUrl(): string {
  try {
    const current = new URL(window.location.href)
    if (/^garden\./i.test(current.hostname)) return current.origin.replace("//garden.", "//")
    if (/^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(current.hostname) || current.port === "8081") {
      return `${current.protocol}//${current.hostname}:3000`
    }
    return current.origin
  } catch {
    return ""
  }
}

function pageLocation(): { gardenId: string; pageSlug: string } {
  let pathname = window.location.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // Keep the raw URL if it contains malformed escapes.
  }
  const segments = pathname.split("/").map((segment) => segment.trim()).filter(Boolean)
  if (segments[0] === "garden") segments.shift()
  return { gardenId: segments[0] ?? "", pageSlug: segments.slice(1).join("/") }
}

function sandboxDocument(): string {
  const runtime = String(sandboxRuntime).replace(/<\/script/gi, "<\\/script")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"></head><body><div id="breadboard-generated-visual-root"></div><script>${runtime}<\/script></body></html>`
}

async function mutateVisual(
  manifest: GeneratedManifestSummary,
  action: "regenerate" | "rollback",
  status: HTMLElement,
  buttons: HTMLButtonElement[],
): Promise<void> {
  const base = dashboardBaseUrl()
  const { gardenId, pageSlug } = pageLocation()
  if (!base || !gardenId) {
    status.textContent = "Open this lesson from the dashboard to update the visualization."
    return
  }
  buttons.forEach((button) => { button.disabled = true })
  status.textContent = action === "regenerate" ? "Generating a validated replacement…" : "Restoring the previous version…"
  try {
    const response = await fetch(
      `${base}/api/gardens/${encodeURIComponent(gardenId)}/visualizations/${encodeURIComponent(manifest.id)}/${action}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageSlug,
          currentVersion: manifest.version,
          version: action === "rollback" ? manifest.previousVersion : undefined,
          reason: action === "regenerate" ? "Learner requested a clearer generated visualization" : undefined,
        }),
      },
    )
    const body = await response.json().catch(() => ({})) as Dict
    if (!response.ok || body.success !== true) {
      throw new Error(typeof body.error === "string" ? body.error : `Could not ${action} visualization`)
    }
    status.textContent = "Updated. Reloading the lesson…"
    window.setTimeout(() => window.location.reload(), 1200)
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false })
    status.textContent = error instanceof Error ? error.message : `Could not ${action} visualization`
  }
}

function buildFallback(message: string): HTMLElement {
  const fallback = element("aside", "breadboard-generated-visual-fallback")
  fallback.setAttribute("role", "note")
  fallback.appendChild(element("strong", undefined, "Interactive visualization unavailable"))
  fallback.appendChild(element("p", undefined, message))
  return fallback
}

function hydrate(code: HTMLElement): HTMLElement {
  if (code.classList.contains("breadboard-generated-visual-invalid")) {
    return buildFallback(code.dataset.generatedVisualError || "The generated artifact did not pass validation.")
  }

  let definition: unknown
  let manifest: GeneratedManifestSummary
  try {
    definition = JSON.parse(code.dataset.generatedVisualDefinition ?? "")
    manifest = JSON.parse(code.dataset.generatedVisualManifest ?? "") as GeneratedManifestSummary
    if (!isRecord(definition) || !manifest?.id || !Number.isInteger(manifest.version)) throw new Error("invalid data")
  } catch {
    return buildFallback("The generated artifact could not be decoded safely.")
  }

  const card = element("section", "breadboard-generated-visual-card")
  card.dataset.visualId = manifest.id
  const header = element("header", "bgv-header")
  const titleBox = element("div")
  titleBox.appendChild(element("p", "bgv-kicker", "Generated interactive visual"))
  titleBox.appendChild(element("h4", "bgv-title", manifest.title))
  if (manifest.description) titleBox.appendChild(element("p", "bgv-description", manifest.description))
  header.appendChild(titleBox)
  header.appendChild(element("span", "bgv-version", `v${manifest.version}`))
  card.appendChild(header)

  const frame = element("iframe", "bgv-frame") as HTMLIFrameElement
  frame.title = manifest.title
  frame.sandbox.add("allow-scripts")
  frame.referrerPolicy = "no-referrer"
  frame.loading = "lazy"
  frame.srcdoc = sandboxDocument()
  card.appendChild(frame)

  const anchors = Array.isArray(manifest.sourceAnchorIds) ? manifest.sourceAnchorIds.filter((item) => typeof item === "string") : []
  if (anchors.length > 0) card.appendChild(element("p", "bgv-sources", `Grounded in: ${anchors.slice(0, 8).join(", ")}`))

  const footer = element("footer", "bgv-footer")
  const regenerate = element("button", "bgv-action bgv-action-primary", "Regenerate") as HTMLButtonElement
  regenerate.type = "button"
  const buttons = [regenerate]
  footer.appendChild(regenerate)
  if (Number.isInteger(manifest.previousVersion) && Number(manifest.previousVersion) > 0) {
    const rollback = element("button", "bgv-action", `Restore v${manifest.previousVersion}`) as HTMLButtonElement
    rollback.type = "button"
    buttons.push(rollback)
    rollback.addEventListener("click", () => void mutateVisual(manifest, "rollback", status, buttons))
    footer.appendChild(rollback)
  }
  const status = element("span", "bgv-status")
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  footer.appendChild(status)
  regenerate.addEventListener("click", () => void mutateVisual(manifest, "regenerate", status, buttons))
  card.appendChild(footer)

  const listener = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || !isRecord(event.data) || event.data.type !== EVENT) return
    if (event.data.event === "ready") {
      const height = typeof event.data.height === "number" ? event.data.height : 480
      frame.style.height = `${Math.max(300, Math.min(4800, height + 4))}px`
    } else if (event.data.event === "runtime-error") {
      status.textContent = "The visualization stopped safely after a runtime error."
      frame.hidden = true
      frame.insertAdjacentElement("afterend", buildFallback("Its source lesson remains available below."))
    }
  }
  window.addEventListener("message", listener)
  frame.addEventListener("load", () => {
    const theme = document.documentElement.getAttribute("saved-theme") === "dark" ? "dark" : "light"
    frame.contentWindow?.postMessage({ type: INIT, definition, theme }, "*")
  }, { once: true })
  return card
}

document.addEventListener("nav", () => {
  const nodes = document.querySelectorAll("code.breadboard-generated-visual-block") as NodeListOf<HTMLElement>
  for (const code of nodes) {
    const host = (code.closest("pre") as HTMLElement | null) ?? code
    if (host.dataset.bgvBound === "true") continue
    host.dataset.bgvBound = "true"
    host.replaceWith(hydrate(code))
  }
})
