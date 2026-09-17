interface WidgetMessage {
  content: string
  uiResources: unknown[]
  conversationPublicId?: string | null
}

/** Keep Quartz's static bundle small while using the dashboard's real widgets. */
export function createAssistantWidgetHost(dashboard: string, onSend: (text: string) => void, scrollContainer?: HTMLElement) {
  const origin = new URL(dashboard, location.href).origin
  const frames = new Map<HTMLElement, { frame: HTMLIFrameElement; message: WidgetMessage }>()
  const post = (entry: { frame: HTMLIFrameElement; message: WidgetMessage }) => {
    entry.frame.contentWindow?.postMessage({
      type: "breadboard:widgets-render",
      ...entry.message,
      theme: document.documentElement.getAttribute("saved-theme") || document.documentElement.dataset.theme,
    }, origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.origin !== origin) return
    for (const [element, entry] of frames) {
      if (!element.isConnected) { frames.delete(element); continue }
      if (event.source !== entry.frame.contentWindow) continue
      if (event.data?.type === "breadboard:widgets-ready") post(entry)
      if (event.data?.type === "breadboard:widgets-resize" && Number.isFinite(event.data.height)) {
        const atBottom = scrollContainer && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 80
        entry.frame.style.height = `${Math.max(80, Math.min(1600, event.data.height))}px`
        if (atBottom) scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
      if (event.data?.type === "breadboard:widgets-send" && typeof event.data.text === "string") {
        onSend(event.data.text.slice(0, 4000))
      }
    }
  }
  window.addEventListener("message", receive)
  const themeObserver = new MutationObserver(() => { for (const entry of frames.values()) post(entry) })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["saved-theme", "data-theme"] })
  return {
    render(element: HTMLElement, message: WidgetMessage): boolean {
      for (const prior of frames.keys()) if (!prior.isConnected) frames.delete(prior)
      // Includes incomplete fences: raw display JSON must stay hidden while streaming.
      const rich = message.uiResources.length > 0 || /^\s*(?:`{3,}|~{3,})(?:image-results|weather-results)\b/im.test(message.content)
      if (!rich) { frames.delete(element); return false }
      let entry = frames.get(element)
      if (!entry) {
        const frame = document.createElement("iframe")
        frame.title = "Assistant widgets"
        frame.className = "breadboard-ai-widgets"
        frame.src = `${dashboard}/assistant-widgets/index.html?parentOrigin=${encodeURIComponent(location.origin)}`
        frame.style.cssText = "display:block;width:100%;height:120px;border:0;min-width:0;background:transparent"
        entry = { frame, message }
        frames.set(element, entry)
        element.replaceChildren(frame)
      } else {
        entry.message = message
        post(entry)
      }
      return true
    },
    dispose() {
      window.removeEventListener("message", receive)
      themeObserver.disconnect()
      frames.clear()
    },
  }
}
