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

interface QuartzCommandItem {
  id: string
  kind: "skill" | "mcp" | "prompt"
  slug: string
  name: string
  description: string
  enabled?: boolean
  healthy?: boolean
  unavailableReason?: string
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
  const commandButton = root.querySelector<HTMLButtonElement>(".breadboard-ai-command-button")
  const commandHub = root.querySelector<HTMLElement>(".breadboard-ai-command-hub")
  const commandSearch = root.querySelector<HTMLInputElement>(".breadboard-ai-command-search")
  const commandResults = root.querySelector<HTMLElement>(".breadboard-ai-command-results")
  const commandStatus = root.querySelector<HTMLElement>(".breadboard-ai-command-status")
  const activity = root.querySelector<HTMLElement>(".breadboard-ai-activity")
  const activityTitle = root.querySelector<HTMLElement>(".breadboard-ai-activity-title")
  const activityToggle = root.querySelector<HTMLButtonElement>(".breadboard-ai-activity-toggle")
  const activityList = root.querySelector<HTMLOListElement>(".breadboard-ai-activity-list")
  const permissionBox = root.querySelector<HTMLElement>(".breadboard-ai-permission")
  const evidenceBox = root.querySelector<HTMLDetailsElement>(".breadboard-ai-evidence")
  const evidenceBody = root.querySelector<HTMLElement>(".breadboard-ai-evidence-body")
  const pageName = root.querySelector<HTMLElement>(".breadboard-ai-page-name")
  if (!toggle || !panel || !messages || !form || !input || !sendBtn || !stopBtn || !errorBox) return

  if (pageName) pageName.textContent = pageTitle

  const storageKey = `breadboard-ai:${gardenId}:${pageSlug}`
  const state: SessionState = loadState()
  let abortController: AbortController | null = null
  let commandItems: QuartzCommandItem[] = []
  let activeCommandIndex = 0
  const activityEntries = new Map<string, { label: string; detail?: string; status: string }>()

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

  function filteredCommands(): QuartzCommandItem[] {
    const query = commandSearch?.value.trim().toLowerCase() || ""
    return query
      ? commandItems.filter((item) =>
          `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(query),
        )
      : commandItems
  }

  function insertCommand(item: QuartzCommandItem) {
    if (item.enabled === false || item.healthy === false) return
    const start = input!.selectionStart
    const end = input!.selectionEnd
    const token = `/${item.kind}:${item.slug} `
    const replaceInitialSlash = input!.value === "/"
    input!.value = replaceInitialSlash
      ? token
      : `${input!.value.slice(0, start)}${token}${input!.value.slice(end)}`
    const cursor = replaceInitialSlash ? token.length : start + token.length
    closeCommands()
    input!.focus()
    input!.setSelectionRange(cursor, cursor)
  }

  function renderCommands() {
    if (!commandResults) return
    commandResults.replaceChildren()
    const items = filteredCommands()
    if (!items.length) {
      const empty = document.createElement("p")
      empty.className = "breadboard-ai-command-empty"
      empty.textContent = "No commands match this search."
      commandResults.appendChild(empty)
      return
    }
    activeCommandIndex = Math.min(activeCommandIndex, items.length - 1)
    for (const kind of ["skill", "mcp", "prompt"] as const) {
      const group = items.filter((item) => item.kind === kind)
      if (!group.length) continue
      const heading = document.createElement("h4")
      heading.textContent =
        kind === "mcp" ? "MCP connections" : `${kind[0].toUpperCase()}${kind.slice(1)}s`
      commandResults.appendChild(heading)
      for (const item of group) {
        const button = document.createElement("button")
        const index = items.indexOf(item)
        button.type = "button"
        button.className = `breadboard-ai-command-item${index === activeCommandIndex ? " active" : ""}`
        button.disabled = item.enabled === false || item.healthy === false
        button.dataset.commandIndex = String(index)
        const title = document.createElement("span")
        title.textContent = `${item.name}  /${item.kind}:${item.slug}`
        const description = document.createElement("small")
        description.textContent = button.disabled
          ? item.unavailableReason || "Unavailable"
          : item.description
        button.append(title, description)
        button.addEventListener("mouseenter", () => {
          activeCommandIndex = index
          for (const candidate of commandResults!.querySelectorAll<HTMLElement>(
            ".breadboard-ai-command-item",
          )) {
            candidate.classList.toggle("active", candidate.dataset.commandIndex === String(index))
          }
        })
        button.addEventListener("click", () => insertCommand(item))
        commandResults.appendChild(button)
      }
    }
  }

  async function openCommands() {
    if (!commandHub || !commandButton || !commandSearch || !commandStatus) return
    commandHub.hidden = false
    commandButton.setAttribute("aria-expanded", "true")
    commandStatus.textContent = "Loading commands…"
    commandSearch.focus()
    try {
      const response = await fetch(`${dashboard}/api/quartz-ai/commands`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Commands are unavailable.")
      const payload = (await response.json()) as { groups?: Record<string, QuartzCommandItem[]> }
      commandItems = [
        ...(payload.groups?.skills || []),
        ...(payload.groups?.mcp || []),
        ...(payload.groups?.prompts || []),
      ]
      commandStatus.textContent = "Select inserts a token; it does not send."
      activeCommandIndex = 0
      renderCommands()
    } catch (error) {
      commandStatus.textContent =
        error instanceof Error ? error.message : "Commands are unavailable."
    }
  }

  function closeCommands() {
    if (!commandHub || !commandButton) return
    commandHub.hidden = true
    commandButton.setAttribute("aria-expanded", "false")
  }

  commandButton?.addEventListener("click", () =>
    commandHub?.hidden ? void openCommands() : closeCommands(),
  )
  commandSearch?.addEventListener("input", () => {
    activeCommandIndex = 0
    renderCommands()
  })
  commandSearch?.addEventListener("keydown", (event) => {
    const items = filteredCommands()
    if (event.key === "Escape") {
      event.preventDefault()
      closeCommands()
      input!.focus()
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      activeCommandIndex = items.length
        ? (activeCommandIndex + direction + items.length) % items.length
        : 0
      renderCommands()
    } else if (event.key === "Enter" && items[activeCommandIndex]) {
      event.preventDefault()
      insertCommand(items[activeCommandIndex])
    }
  })

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
    if (activityTitle) activityTitle.textContent = "Stopped with an error"
  }
  function clearError() {
    errorBox!.hidden = true
  }

  function setBusy(busy: boolean) {
    sendBtn!.disabled = busy
    stopBtn!.hidden = !busy
    if (!activity || !activityTitle || !activityList) return
    if (busy) {
      activity.hidden = false
      activity.classList.remove("collapsed")
      activityTitle.textContent = "Working"
      activityEntries.clear()
      activityEntries.set("reasoning", { label: "Thinking", status: "running" })
      if (permissionBox) permissionBox.hidden = true
      if (evidenceBox) evidenceBox.hidden = true
      renderActivity()
    } else if (!abortController?.signal.aborted) {
      activityTitle.textContent =
        activityTitle.textContent === "Stopped with an error"
          ? activityTitle.textContent
          : "Completed"
      for (const entry of activityEntries.values())
        if (entry.status === "running") entry.status = "completed"
      renderActivity()
      window.setTimeout(() => {
        activity.classList.add("collapsed")
        if (activityToggle) activityToggle.textContent = "View activity"
      }, 900)
    }
  }

  function renderActivity() {
    if (!activityList) return
    activityList.replaceChildren()
    for (const entry of activityEntries.values()) {
      const item = document.createElement("li")
      const glyph =
        entry.status === "completed"
          ? "âœ“"
          : entry.status === "failed"
            ? "Ã—"
            : entry.status === "cancelled"
              ? "â– "
              : entry.status === "permission_required"
                ? "!"
                : "â€¢"
      const marker = document.createElement("span")
      marker.textContent = glyph
      const text = document.createElement("span")
      text.textContent = entry.detail ? `${entry.label} â€” ${entry.detail}` : entry.label
      item.append(marker, text)
      activityList.appendChild(item)
    }
  }

  activityToggle?.addEventListener("click", () => {
    if (!activity) return
    const collapsed = activity.classList.toggle("collapsed")
    activityToggle.textContent = collapsed ? "View activity" : "Hide activity"
  })

  function renderPermission(payload: Record<string, unknown>) {
    if (!permissionBox) return
    permissionBox.replaceChildren()
    permissionBox.hidden = false
    const requestId = typeof payload.requestId === "string" ? payload.requestId : ""
    const description = document.createElement("p")
    description.textContent =
      typeof payload.description === "string"
        ? payload.description
        : "The agent requested permission."
    permissionBox.appendChild(description)
    if (typeof payload.command === "string") {
      const command = document.createElement("code")
      command.textContent = payload.command
      permissionBox.appendChild(command)
    }
    const paths = Array.isArray(payload.affectedPaths)
      ? payload.affectedPaths.filter((value): value is string => typeof value === "string")
      : []
    if (paths.length) {
      const list = document.createElement("ul")
      for (const value of paths) {
        const item = document.createElement("li")
        item.textContent = value
        list.appendChild(item)
      }
      permissionBox.appendChild(list)
    }
    const actions = document.createElement("div")
    const decisions: Array<{ value: "once" | "always" | "reject"; label: string }> = [
      { value: "once", label: "Allow once" },
      ...(payload.allowSession === true
        ? [{ value: "always" as const, label: "Allow similar for session" }]
        : []),
      { value: "reject", label: "Deny" },
    ]
    for (const decision of decisions) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = decision.label
      button.addEventListener("click", async () => {
        button.disabled = true
        const response = await fetch(
          `${dashboard}/api/openharness/permissions/${encodeURIComponent(requestId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ sessionId: state.sessionId, decision: decision.value }),
          },
        )
        if (!response.ok) {
          showError(
            response.status === 401
              ? "Sign in to approve this action."
              : "The permission response failed.",
          )
          button.disabled = false
          return
        }
        permissionBox.hidden = true
        const entry = activityEntries.get(`permission-${requestId}`)
        if (entry) entry.status = decision.value === "reject" ? "failed" : "completed"
        renderActivity()
      })
      actions.appendChild(button)
    }
    permissionBox.appendChild(actions)
  }

  function renderEvidence(payload: Record<string, unknown>) {
    if (!evidenceBox || !evidenceBody) return
    evidenceBody.replaceChildren()
    evidenceBox.hidden = false
    const stateLabel = document.createElement("p")
    stateLabel.textContent = `Verification: ${String(payload.state || "unverified").replaceAll("_", " ")}`
    evidenceBody.appendChild(stateLabel)
    const records = Array.isArray(payload.evidence) ? payload.evidence : []
    if (records.length) {
      const list = document.createElement("ul")
      for (const record of records) {
        if (!record || typeof record !== "object") continue
        const item = document.createElement("li")
        const location =
          typeof (record as any).location === "string" ? ` · ${(record as any).location}` : ""
        item.textContent = `${String((record as any).title || "Tool evidence")}${location} — ${(record as any).success === false ? "failed" : "succeeded"}`
        list.appendChild(item)
      }
      evidenceBody.appendChild(list)
    }
    const unsupported = Array.isArray(payload.unsupportedClaims) ? payload.unsupportedClaims : []
    for (const claim of unsupported) {
      const item = document.createElement("p")
      item.textContent = String(claim)
      item.className = "breadboard-ai-evidence-warning"
      evidenceBody.appendChild(item)
    }
  }

  async function streamEvents(
    sessionId: number,
    assistantEl: HTMLElement,
    dispatch: () => Promise<void>,
  ) {
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
    let dispatched = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() || ""
      for (const frame of frames) {
        if (frame.split("\n").some((line) => line.trim() === ": connected")) {
          if (!dispatched) {
            dispatched = true
            try {
              await dispatch()
            } catch (error) {
              abortController?.abort()
              throw error
            }
          }
          continue
        }
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
        } else if (event.type === "tool.started" || event.type === "tool.completed") {
          const payload = event.payload || {}
          const id = String(payload.toolCallId || payload.toolName || activityEntries.size)
          activityEntries.set(`tool-${id}`, {
            label: String(payload.summary || payload.toolName || "Using tool"),
            detail: String(payload.toolName || ""),
            status:
              event.type === "tool.started"
                ? "running"
                : payload.success === false
                  ? "failed"
                  : "completed",
          })
          renderActivity()
        } else if (event.type === "permission.requested") {
          const payload = event.payload || {}
          const requestId = String(payload.requestId || "permission")
          activityEntries.set(`permission-${requestId}`, {
            label: String(payload.description || "Permission required"),
            status: "permission_required",
          })
          renderPermission(payload)
          renderActivity()
        } else if (event.type === "verification.updated") {
          renderEvidence(event.payload || {})
        } else if (event.type === "cancelled") {
          if (activityTitle) activityTitle.textContent = "Cancelled"
          for (const entry of activityEntries.values())
            if (entry.status === "running" || entry.status === "permission_required")
              entry.status = "cancelled"
          renderActivity()
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
      const turn = {
        text: trimmed,
        sessionId: state.sessionId,
        clientToken: state.clientToken,
        context: {
          gardenId,
          pageSlug,
          pageTitle,
          visiblePageContent: (document.querySelector("article")?.textContent || "").slice(
            0,
            12000,
          ),
          selectedText: (window.getSelection()?.toString() || "").slice(0, 2000),
          graph: (window as Window & { __breadboardGraphContext?: unknown })
            .__breadboardGraphContext,
        },
      }
      const response = await fetch(`${dashboard}/api/quartz-ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...turn, prepareOnly: true }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "The assistant is unavailable.")
      state.sessionId = data.sessionId ?? state.sessionId
      if (data.clientToken) state.clientToken = data.clientToken
      saveState()
      assistantEl.textContent = ""
      await streamEvents(state.sessionId!, assistantEl, async () => {
        const dispatchResponse = await fetch(`${dashboard}/api/quartz-ai/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ...turn,
            sessionId: state.sessionId,
            clientToken: state.clientToken,
          }),
        })
        if (!dispatchResponse.ok) {
          const dispatchData = await dispatchResponse.json().catch(() => ({}))
          throw new Error(dispatchData.error || "The assistant could not accept the message.")
        }
      })
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
  input.addEventListener("input", () => {
    if (input.value === "/") void openCommands()
  })
  stopBtn.addEventListener("click", () => {
    abortController?.abort()
    if (activityTitle) activityTitle.textContent = "Cancelled"
    for (const entry of activityEntries.values()) {
      if (entry.status === "running" || entry.status === "permission_required")
        entry.status = "cancelled"
    }
    renderActivity()
    if (!state.sessionId) return
    void fetch(`${dashboard}/api/quartz-ai/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sessionId: state.sessionId, clientToken: state.clientToken }),
    }).catch(() => undefined)
  })

  for (const btn of Array.from(
    root.querySelectorAll<HTMLButtonElement>(".breadboard-ai-actions button"),
  )) {
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
