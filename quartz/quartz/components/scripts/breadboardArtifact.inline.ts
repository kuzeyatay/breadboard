import { artifactKindLabel, parseArtifactReference } from "../../util/artifactReference"

const PROTOCOL = "breadboard:interactive-visualizer:v1"
// srcdoc has no query string; the existing visualizer runtime uses this channel.
// Messages are also scoped to the exact child window, including duplicate embeds.
const PREVIEW_CHANNEL = "standalone"

document.addEventListener("nav", () => {
  for (const code of document.querySelectorAll<HTMLElement>("code.breadboard-artifact-block")) {
    const card = document.createElement("aside")
    card.className = "breadboard-artifact-card"
    card.dataset.artifactReference = code.dataset.artifactReference ?? ""
    ;(code.closest("pre") ?? code).replaceWith(card)
  }
  for (const card of document.querySelectorAll<HTMLElement>(".breadboard-artifact-card")) {
    const reference = parseArtifactReference(card.dataset.artifactReference ?? "")
    const header = document.createElement("div")
    header.className = "breadboard-artifact-header"
    const title = document.createElement("strong")
    title.textContent = reference?.title || "Artifact unavailable"
    const kind = document.createElement("span")
    kind.className = "breadboard-artifact-kind"
    kind.textContent = reference ? artifactKindLabel(reference) : "File"
    const status = document.createElement("span")
    status.className = "breadboard-artifact-status"
    status.setAttribute("aria-live", "polite")
    header.append(kind, title)
    card.replaceChildren(header, status)
    if (!reference) { status.textContent = "This artifact reference is invalid."; continue }

    const open = document.createElement("button")
    open.type = "button"
    open.textContent = "Open " + reference.kind
    header.append(open)
    const retry = document.createElement("button")
    retry.type = "button"
    retry.textContent = "Retry preview"
    retry.hidden = true
    card.append(retry)
    const slug = document.querySelector<HTMLElement>(".markdown-actions")?.dataset.noteSlug
    let openRequestId = "", previewRequestId = ""
    let openTimer: ReturnType<typeof setTimeout> | undefined
    let previewTimer: ReturnType<typeof setTimeout> | undefined
    let frame: HTMLIFrameElement | undefined
    let interactive = false
    const sendContext = () => {
      if (!interactive || !frame) return
      const theme = document.documentElement.getAttribute("saved-theme") || document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      for (const message of [{ type: "host-theme", theme }, { type: "host-presentation", presentation: "inline" }]) {
        frame.contentWindow?.postMessage({ protocol: PROTOCOL, channel: PREVIEW_CHANNEL, ...message }, "*")
      }
    }
    const finishOpen = (message: string) => {
      clearTimeout(openTimer)
      openRequestId = ""
      open.disabled = false
      status.textContent = message
    }
    const previewError = (message: string) => {
      clearTimeout(previewTimer)
      status.textContent = message
      retry.hidden = false
    }
    const loadPreview = () => {
      if (window.parent === window || !slug) return
      clearTimeout(previewTimer)
      previewRequestId = crypto.randomUUID()
      retry.hidden = true
      status.textContent = "Loading preview…"
      window.parent.postMessage({ type: "second-brain:preview-markdown-artifact", slug, requestId: previewRequestId, reference }, "*")
      previewTimer = setTimeout(() => {
        previewRequestId = ""
        previewError("Could not load the preview.")
      }, 20_000)
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (frame && interactive && event.source === frame.contentWindow && event.origin === "null" && data?.protocol === PROTOCOL && data.channel === PREVIEW_CHANNEL) {
        if (data.type === "ready") sendContext()
        if ((data.type === "ready" || data.type === "resize") && Number.isFinite(Number(data.height))) {
          frame.style.height = `${Math.max(280, Math.min(1200, Number(data.height)))}px`
        }
        return
      }
      if (event.source !== window.parent || data?.slug !== slug) return
      if (openRequestId && data.type === "second-brain:markdown-artifact-open-result" && data.requestId === openRequestId) {
        finishOpen(data.ok ? "" : data.error || "Could not open artifact. Try again.")
      }
      if (!previewRequestId || data.type !== "second-brain:markdown-artifact-preview-result" || data.requestId !== previewRequestId) return
      clearTimeout(previewTimer)
      if (!data.ok) { previewError(data.error || "Could not load the preview."); return }
      status.textContent = ""
      retry.hidden = true
      if (!data.inline || typeof data.html !== "string") return
      frame?.remove()
      interactive = data.interactive === true
      frame = document.createElement("iframe")
      frame.className = "breadboard-artifact-preview"
      frame.title = `${data.title || reference.title} preview`
      frame.setAttribute("sandbox", interactive ? "allow-scripts" : "")
      frame.setAttribute("allow", "")
      frame.referrerPolicy = "no-referrer"
      frame.style.height = interactive ? "420px" : "520px"
      frame.addEventListener("load", sendContext)
      frame.srcdoc = data.html
      card.append(frame)
      card.classList.add("has-preview")
    }
    window.addEventListener("message", onMessage)
    const observer = new MutationObserver(sendContext)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["saved-theme", "data-theme", "class"] })
    window.addCleanup(() => {
      clearTimeout(openTimer)
      clearTimeout(previewTimer)
      observer.disconnect()
      window.removeEventListener("message", onMessage)
      if (interactive) frame?.contentWindow?.postMessage({ protocol: PROTOCOL, type: "host-dispose", channel: PREVIEW_CHANNEL }, "*")
    })
    open.addEventListener("click", () => {
      if (window.parent === window || !slug) { finishOpen("Open this note from the dashboard to view its artifact."); return }
      openRequestId = crypto.randomUUID()
      open.disabled = true
      status.textContent = ""
      window.parent.postMessage({ type: "second-brain:open-markdown-artifact", slug, requestId: openRequestId, reference }, "*")
      openTimer = setTimeout(() => finishOpen("Could not open artifact. Try again."), 20_000)
    })
    retry.addEventListener("click", loadPreview)
    // Renderer identity is checked by the authenticated host before embedding.
    if (reference.kind === "html") loadPreview()
  }
})
