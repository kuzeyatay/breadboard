// Client logic for the Breadboard Quartz page AI panel.
//
// Talks ONLY to the Breadboard dashboard API (never OpenHarness). Streams the
// answer over SSE, supports abort, page-scoped session continuity (persisted in
// sessionStorage), and clear error/reconnect states. No secrets, no OpenHarness
// URL — everything sensitive stays server-side.

interface SessionState {
  sessionId: number | null
  clientToken: string | null
}

function setupPanel(root: HTMLElement) {
  const dashboard = root.dataset.dashboard || "http://localhost:3000"
  const gardenId = root.dataset.garden || ""
  const pageSlug = root.dataset.page || ""
  const pageTitle = root.dataset.title || pageSlug

  const toggle = root.querySelector<HTMLButtonElement>(".breadboard-ai-toggle")
  const panel = root.querySelector<HTMLElement>(".breadboard-ai-panel")
  const closeBtn = root.querySelector<HTMLButtonElement>(".breadboard-ai-close")
  const messages = root.querySelector<HTMLElement>(".breadboard-ai-messages")
  const form = root.querySelector<HTMLFormElement>(".breadboard-ai-composer")
  const input = root.querySelector<HTMLTextAreaElement>(".breadboard-ai-input")
  const sendBtn = root.querySelector<HTMLButtonElement>(".breadboard-ai-send")
  const stopBtn = root.querySelector<HTMLButtonElement>(".breadboard-ai-stop")
  const errorBox = root.querySelector<HTMLElement>(".breadboard-ai-error")
  const pageName = root.querySelector<HTMLElement>(".breadboard-ai-page-name")
  if (!toggle || !panel || !messages || !form || !input || !sendBtn || !stopBtn || !errorBox) return

  if (pageName) pageName.textContent = pageTitle

  const storageKey = `breadboard-ai:${gardenId}:${pageSlug}`
  const state: SessionState = loadState()
  let abortController: AbortController | null = null

  function loadState(): SessionState {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw) as SessionState
    } catch {
      /* ignore */
    }
    return { sessionId: null, clientToken: null }
  }
  function saveState() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }

  function openPanel() {
    panel!.hidden = false
    toggle!.setAttribute("aria-expanded", "true")
    input!.focus()
  }
  function closePanel() {
    panel!.hidden = true
    toggle!.setAttribute("aria-expanded", "false")
  }
  toggle.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()))
  closeBtn?.addEventListener("click", closePanel)

  function addMessage(role: "user" | "assistant", text: string): HTMLElement {
    const el = document.createElement("div")
    el.className = `breadboard-ai-message breadboard-ai-${role}`
    el.textContent = text
    messages!.appendChild(el)
    messages!.scrollTop = messages!.scrollHeight
    return el
  }

  function showError(message: string) {
    errorBox!.textContent = message
    errorBox!.hidden = false
  }
  function clearError() {
    errorBox!.hidden = true
  }

  function setBusy(busy: boolean) {
    sendBtn!.disabled = busy
    stopBtn!.hidden = !busy
  }

  async function streamEvents(sessionId: number, assistantEl: HTMLElement) {
    abortController = new AbortController()
    const params = new URLSearchParams({ sessionId: String(sessionId) })
    if (state.clientToken) params.set("clientToken", state.clientToken)
    const response = await fetch(`${dashboard}/api/quartz-ai/events?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      credentials: "include",
      signal: abortController.signal,
    })
    if (!response.ok || !response.body) throw new Error("Could not open the AI stream.")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let text = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() || ""
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
        if (!data) continue
        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event.type === "assistant.delta") {
          text += event.payload?.text ?? ""
          assistantEl.textContent = text
          messages!.scrollTop = messages!.scrollHeight
        } else if (event.type === "error") {
          showError(String(event.payload?.message ?? "The assistant reported an error."))
        } else if (event.type === "done") {
          return
        }
      }
    }
  }

  async function send(promptText: string) {
    const trimmed = promptText.trim()
    if (!trimmed) return
    clearError()
    addMessage("user", trimmed)
    const assistantEl = addMessage("assistant", "…")
    setBusy(true)
    try {
      const response = await fetch(`${dashboard}/api/quartz-ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: trimmed,
          sessionId: state.sessionId,
          clientToken: state.clientToken,
          context: {
            gardenId,
            pageSlug,
            pageTitle,
            selectedText: (window.getSelection()?.toString() || "").slice(0, 2000),
          },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "The assistant is unavailable.")
      state.sessionId = data.sessionId ?? state.sessionId
      if (data.clientToken) state.clientToken = data.clientToken
      saveState()
      assistantEl.textContent = ""
      await streamEvents(state.sessionId!, assistantEl)
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        assistantEl.textContent = assistantEl.textContent || "(stopped)"
      } else {
        showError(error instanceof Error ? error.message : "The assistant is unavailable.")
        assistantEl.remove()
      }
    } finally {
      setBusy(false)
      abortController = null
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const value = input.value
    input.value = ""
    void send(value)
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      const value = input.value
      input.value = ""
      void send(value)
    }
  })
  stopBtn.addEventListener("click", () => abortController?.abort())

  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>(".breadboard-ai-actions button"))) {
    btn.addEventListener("click", () => {
      if (panel.hidden) openPanel()
      void send(btn.dataset.prompt || btn.textContent || "")
    })
  }
}

document.addEventListener("nav", () => {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(".breadboard-ai"))) {
    if (root.dataset.wired === "1") continue
    root.dataset.wired = "1"
    setupPanel(root)
  }
})
