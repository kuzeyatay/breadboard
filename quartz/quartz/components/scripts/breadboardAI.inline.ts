// Client logic for the Breadboard Quartz page AI panel.
//
// Talks ONLY to the Breadboard dashboard API (never OpenHarness). Streams the
// answer over SSE, supports abort, page-scoped session continuity (persisted in
// sessionStorage), and clear error/reconnect states. No secrets, no OpenHarness
// URL — everything sensitive stays server-side.

interface SessionState {
  sessionId: string | number | null
  clientToken: string | null
  model: string | null
  effort: string | null
}

interface QuartzSessionItem {
  id: string | number
  title: string
  updatedAt: string
  messages: Array<{ role?: unknown; content?: unknown }>
}

interface QuartzCommandItem {
  id: string
  kind: "skill" | "mcp" | "prompt"
  slug: string
  token: string
  name: string
  description: string
  enabled?: boolean
  healthy?: boolean
  unavailableReason?: string
}

// Mirrors the dashboard's slash-command token grammar: one or more leading
// "/token" selectors, each followed by whitespace or end of text.
const LEADING_COMMAND_RUN = /^(?:\/[a-z0-9][a-z0-9_.:-]*(?:\s+|$))+/i
const ASSISTANT_MODEL_STORAGE_KEY = "breadboard:assistant-model"
const ASSISTANT_EFFORT_STORAGE_KEY = "breadboard:assistant-reasoning-effort"

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
  const commandClose = root.querySelector<HTMLButtonElement>(".breadboard-ai-command-close")
  const commandTabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-command-tab]"))
  const activity = root.querySelector<HTMLElement>(".breadboard-ai-activity")
  const activityTitle = root.querySelector<HTMLElement>(".breadboard-ai-activity-title")
  const activityToggle = root.querySelector<HTMLButtonElement>(".breadboard-ai-activity-toggle")
  const activityList = root.querySelector<HTMLOListElement>(".breadboard-ai-activity-list")
  const permissionBox = root.querySelector<HTMLElement>(".breadboard-ai-permission")
  const evidenceBox = root.querySelector<HTMLDetailsElement>(".breadboard-ai-evidence")
  const evidenceBody = root.querySelector<HTMLElement>(".breadboard-ai-evidence-body")
  const pageName = root.querySelector<HTMLElement>(".breadboard-ai-page-name")
  const newChatBtn = root.querySelector<HTMLButtonElement>(".breadboard-ai-new")
  const historyToggle = root.querySelector<HTMLButtonElement>(".breadboard-ai-history-toggle")
  const historyBox = root.querySelector<HTMLElement>(".breadboard-ai-history")
  const historyStatus = root.querySelector<HTMLElement>(".breadboard-ai-history-status")
  const historyList = root.querySelector<HTMLUListElement>(".breadboard-ai-history-list")
  const intelligence = root.querySelector<HTMLElement>(".breadboard-ai-intelligence")
  const modelSelect = root.querySelector<HTMLSelectElement>(".breadboard-ai-model")
  const effortSelect = root.querySelector<HTMLSelectElement>(".breadboard-ai-effort")
  if (!toggle || !panel || !messages || !form || !input || !sendBtn || !stopBtn || !errorBox) return

  if (pageName) pageName.textContent = pageTitle

  const storageKey = `breadboard-ai:${gardenId}:${pageSlug}`
  const state: SessionState = loadState()
  let abortController: AbortController | null = null
  let commandItems: QuartzCommandItem[] = []
  let activeCommandIndex = 0
  let activeCommandTab: QuartzCommandItem["kind"] = "skill"
  let intelligenceLoaded = false
  const activityEntries = new Map<string, { label: string; detail?: string; status: string }>()

  function loadState(): SessionState {
    const defaults: SessionState = { sessionId: null, clientToken: null, model: null, effort: null }
    let restored = defaults
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) restored = { ...defaults, ...(JSON.parse(raw) as Partial<SessionState>) }
    } catch {
      /* ignore */
    }
    try {
      restored.model = localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || restored.model
      restored.effort = localStorage.getItem(ASSISTANT_EFFORT_STORAGE_KEY) || restored.effort
    } catch {
      /* ignore */
    }
    return restored
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
    if (!intelligenceLoaded) {
      intelligenceLoaded = true
      void loadIntelligence()
    }
    input!.focus()
  }
  function closePanel() {
    panel!.hidden = true
    toggle!.setAttribute("aria-expanded", "false")
  }
  toggle.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()))
  closeBtn?.addEventListener("click", closePanel)

  function formatModelName(modelId: string): string {
    if (modelId === "gpt-5.6-sol" || modelId === "gpt-5.6") return "GPT-5.6 Sol"
    if (modelId === "gpt-5.6-terra") return "GPT-5.6 Terra"
    if (modelId === "gpt-5.6-luna") return "GPT-5.6 Luna"
    return modelId.replace(/^gpt-/i, "GPT-")
  }

  function effortLabel(effort: string): string {
    const labels: Record<string, string> = {
      low: "Light",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Ultra",
    }
    return labels[effort] ?? effort
  }

  // Populate the same intelligence picker (model + reasoning effort) the
  // dashboard terminal offers. If the runtime is off or unreachable the picker
  // stays hidden and the server's defaults apply.
  async function loadIntelligence() {
    if (!intelligence || !modelSelect || !effortSelect) return
    try {
      const [response, preferenceResponse] = await Promise.all([
        fetch(`${dashboard}/api/quartz-ai/models`, { credentials: "include" }),
        fetch(`${dashboard}/api/assistant-preferences`, {
          credentials: "include",
          cache: "no-store",
        }).catch(() => null),
      ])
      if (!response.ok) return
      const data = (await response.json()) as {
        models?: unknown
        defaultModel?: unknown
        reasoningEfforts?: unknown
        defaultReasoningEffort?: unknown
      }
      const models = Array.isArray(data.models)
        ? data.models.filter((value): value is string => typeof value === "string")
        : []
      const efforts = Array.isArray(data.reasoningEfforts)
        ? data.reasoningEfforts.filter((value): value is string => typeof value === "string")
        : []
      if (!models.length || !efforts.length) return
      const option = (value: string, label: string) => {
        const el = document.createElement("option")
        el.value = value
        el.textContent = label
        return el
      }
      modelSelect.replaceChildren(...models.map((id) => option(id, formatModelName(id))))
      effortSelect.replaceChildren(...efforts.map((id) => option(id, effortLabel(id))))
      const defaultModel = typeof data.defaultModel === "string" ? data.defaultModel : models[0]
      const defaultEffort =
        typeof data.defaultReasoningEffort === "string" ? data.defaultReasoningEffort : efforts[0]
      if (preferenceResponse?.ok) {
        const preference = (await preferenceResponse.json()) as {
          model?: unknown
          reasoningEffort?: unknown
          userPreference?: unknown
        }
        if (preference.userPreference === true) {
          if (typeof preference.model === "string") state.model = preference.model
          if (typeof preference.reasoningEffort === "string") {
            state.effort = preference.reasoningEffort
          }
        }
      }
      modelSelect.value =
        state.model && models.includes(state.model)
          ? state.model
          : models.includes(defaultModel)
            ? defaultModel
            : models[0]
      effortSelect.value =
        state.effort && efforts.includes(state.effort)
          ? state.effort
          : efforts.includes(defaultEffort)
            ? defaultEffort
            : efforts[0]
      state.model = modelSelect.value
      state.effort = effortSelect.value
      try {
        localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, state.model)
        localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, state.effort)
      } catch {
        /* ignore */
      }
      saveState()
      intelligence.hidden = false
    } catch {
      /* picker stays hidden; server defaults apply */
    }
  }

  function saveIntelligencePreference(value: { model?: string; reasoningEffort?: string }) {
    void fetch(`${dashboard}/api/assistant-preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(value),
    }).catch(() => undefined)
  }

  modelSelect?.addEventListener("change", () => {
    state.model = modelSelect.value
    try {
      localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, state.model)
    } catch {
      /* ignore */
    }
    saveState()
    saveIntelligencePreference({ model: state.model })
  })
  effortSelect?.addEventListener("change", () => {
    state.effort = effortSelect.value
    try {
      localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, state.effort)
    } catch {
      /* ignore */
    }
    saveState()
    saveIntelligencePreference({ reasoningEffort: state.effort })
  })

  function filteredCommands(): QuartzCommandItem[] {
    const query = commandSearch?.value.trim().toLowerCase() || ""
    const tabItems = commandItems.filter((item) => item.kind === activeCommandTab)
    return query
      ? tabItems.filter((item) =>
          `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(query),
        )
      : tabItems
  }

  function insertCommand(item: QuartzCommandItem) {
    if (item.enabled === false || item.healthy === false) return
    const start = input!.selectionStart
    const token = `/${item.token} `
    const replaceInitialSlash = input!.value === "/"
    input!.value = replaceInitialSlash
      ? token
      : `${token}${input!.value}`
    const cursor = replaceInitialSlash ? token.length : token.length + start
    closeCommands()
    input!.focus()
    input!.setSelectionRange(cursor, cursor)
    syncCommandTint()
  }

  function syncCommandTint() {
    // Tint only while the draft is nothing but command tokens; once arguments
    // follow, the single-color input goes back to normal ink (the transcript
    // still tints the full submitted invocation).
    const run = input!.value.match(LEADING_COMMAND_RUN)?.[0]
    input!.classList.toggle("breadboard-ai-input-command", Boolean(run) && run!.length === input!.value.length)
  }

  function renderCommands() {
    if (!commandResults) return
    commandResults.replaceChildren()
    const items = filteredCommands()
    if (!items.length) {
      const empty = document.createElement("p")
      empty.className = "breadboard-ai-command-empty"
      empty.textContent = "No capabilities match this search."
      commandResults.appendChild(empty)
      return
    }
    activeCommandIndex = Math.min(activeCommandIndex, items.length - 1)
    for (const kind of [activeCommandTab] as const) {
      const group = items.filter((item) => item.kind === kind)
      if (!group.length) continue
      const heading = document.createElement("h4")
      heading.textContent =
        kind === "mcp" ? "Connections" : `${kind[0].toUpperCase()}${kind.slice(1)}s`
      commandResults.appendChild(heading)
      for (const item of group) {
        const button = document.createElement("button")
        const index = items.indexOf(item)
        button.type = "button"
        button.className = `breadboard-ai-command-item${index === activeCommandIndex ? " active" : ""}`
        button.disabled = item.enabled === false || item.healthy === false
        button.dataset.commandIndex = String(index)
        const title = document.createElement("span")
        title.textContent = item.name
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
    commandStatus.textContent = "Loading capabilities…"
    commandSearch.focus()
    try {
      const response = await fetch(`${dashboard}/api/quartz-ai/commands`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Capabilities are unavailable.")
      const payload = (await response.json()) as { groups?: Record<string, QuartzCommandItem[]> }
      commandItems = [
        ...(payload.groups?.skills || []),
        ...(payload.groups?.mcp || []),
        ...(payload.groups?.prompts || []),
      ]
      commandStatus.textContent = ""
      activeCommandIndex = 0
      renderCommands()
    } catch (error) {
      commandStatus.textContent =
        error instanceof Error ? error.message : "Capabilities are unavailable."
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
  commandClose?.addEventListener("click", () => {
    closeCommands()
    input!.focus()
  })
  for (const tab of commandTabs) {
    tab.addEventListener("click", () => {
      const value = tab.dataset.commandTab
      if (value !== "skill" && value !== "mcp" && value !== "prompt") return
      activeCommandTab = value
      activeCommandIndex = 0
      for (const candidate of commandTabs) {
        candidate.setAttribute("aria-selected", String(candidate === tab))
      }
      renderCommands()
    })
  }
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
    // A command invocation tints the whole message, arguments included.
    if (role === "user" && LEADING_COMMAND_RUN.test(text)) {
      el.classList.add("breadboard-ai-command-text")
    }
    el.textContent = text
    messages!.appendChild(el)
    messages!.scrollTop = messages!.scrollHeight
    return el
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  }

  function inlineMarkdown(value: string): string {
    return value
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
  }

  // Minimal, safe markdown for assistant answers (the dashboard surfaces render
  // full markdown; this mirrors the common cases). The input is fully
  // HTML-escaped before any tags are introduced, so the only markup in the
  // output is generated below.
  function markdownToHtml(text: string): string {
    return escapeHtml(text)
      .split(/^```.*$/m)
      .map((segment, index) => {
        if (index % 2 === 1) {
          return `<pre><code>${segment.replace(/^\n|\n$/g, "")}</code></pre>`
        }
        return segment
          .split(/\n{2,}/)
          .map((block) => {
            const trimmed = block.trim()
            if (!trimmed) return ""
            const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
            if (heading && !trimmed.includes("\n")) {
              return `<p class="breadboard-ai-md-heading">${inlineMarkdown(heading[2])}</p>`
            }
            const lines = trimmed.split("\n")
            if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
              const items = lines
                .map((line) => `<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`)
                .join("")
              return `<ul>${items}</ul>`
            }
            if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
              const items = lines
                .map((line) => `<li>${inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`)
                .join("")
              return `<ol>${items}</ol>`
            }
            return `<p>${inlineMarkdown(trimmed).replace(/\n/g, "<br>")}</p>`
          })
          .join("")
      })
      .join("")
  }

  function renderAssistantContent(el: HTMLElement, text: string) {
    el.classList.add("breadboard-ai-markdown")
    el.innerHTML = markdownToHtml(text)
  }

  function renderTranscript(entries: Array<{ role?: unknown; content?: unknown }>) {
    messages!.replaceChildren()
    for (const entry of entries) {
      const role = entry.role === "user" ? "user" : "assistant"
      const content = typeof entry.content === "string" ? entry.content : ""
      if (!content) continue
      const el = addMessage(role, content)
      if (role === "assistant") renderAssistantContent(el, content)
    }
    messages!.scrollTop = messages!.scrollHeight
  }

  function sessionQuery(): string {
    const params = new URLSearchParams({ gardenId, pageSlug })
    if (state.sessionId) params.set("sessionId", String(state.sessionId))
    if (state.clientToken) params.set("clientToken", state.clientToken)
    return params.toString()
  }

  async function fetchSessions(): Promise<QuartzSessionItem[]> {
    const response = await fetch(`${dashboard}/api/quartz-ai/sessions?${sessionQuery()}`, {
      credentials: "include",
    })
    if (!response.ok) throw new Error("History is unavailable.")
    const data = (await response.json()) as { sessions?: unknown }
    return (Array.isArray(data.sessions) ? data.sessions : []).flatMap((item) => {
      const record = (item ?? {}) as Record<string, unknown>
      return Number.isInteger(record.id) || (typeof record.id === "string" && record.id.startsWith("conv_"))
        ? [
            {
              id: record.id as string | number,
              title: typeof record.title === "string" ? record.title : "New chat",
              updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
              messages: Array.isArray(record.messages)
                ? (record.messages as QuartzSessionItem["messages"])
                : [],
            },
          ]
        : []
    })
  }

  // Terminal-style session continuity: after a reload the persisted transcript
  // for the page session comes back from the dashboard.
  async function restoreTranscript() {
    if (!state.sessionId) return
    try {
      const sessions = await fetchSessions()
      const current = sessions.find((item) => item.id === state.sessionId)
      if (current && current.messages.length) renderTranscript(current.messages)
    } catch {
      /* keep the empty view */
    }
  }

  function closeHistory() {
    if (!historyBox || !historyToggle) return
    historyBox.hidden = true
    historyToggle.setAttribute("aria-expanded", "false")
  }

  async function openHistory() {
    if (!historyBox || !historyToggle || !historyList || !historyStatus) return
    historyBox.hidden = false
    historyToggle.setAttribute("aria-expanded", "true")
    historyStatus.textContent = "Loading history…"
    historyList.replaceChildren()
    try {
      const sessions = await fetchSessions()
      if (!sessions.length) {
        historyStatus.textContent = "No past chats on this page."
        return
      }
      historyStatus.textContent = ""
      for (const item of sessions) {
        const entry = document.createElement("li")
        const button = document.createElement("button")
        button.type = "button"
        const title = document.createElement("span")
        title.textContent = item.title
        const when = document.createElement("small")
        const date = new Date(item.updatedAt)
        when.textContent = Number.isNaN(date.getTime())
          ? ""
          : date.toLocaleDateString([], { month: "short", day: "numeric" })
        button.append(title, when)
        button.addEventListener("click", () => {
          state.sessionId = item.id
          saveState()
          renderTranscript(item.messages)
          clearError()
          closeHistory()
        })
        entry.appendChild(button)
        historyList.appendChild(entry)
      }
    } catch (error) {
      historyStatus.textContent = error instanceof Error ? error.message : "History is unavailable."
    }
  }

  function startNewChat() {
    state.sessionId = null
    state.clientToken = null
    saveState()
    messages!.replaceChildren()
    clearError()
    if (activity) activity.hidden = true
    closeHistory()
  }

  newChatBtn?.addEventListener("click", startNewChat)
  historyToggle?.addEventListener("click", () =>
    historyBox?.hidden ? void openHistory() : closeHistory(),
  )

  function showError(message: string, onRetry?: () => void) {
    errorBox!.replaceChildren(document.createTextNode(message))
    if (onRetry) {
      const retry = document.createElement("button")
      retry.type = "button"
      retry.className = "breadboard-ai-retry"
      retry.textContent = "Retry"
      retry.addEventListener("click", () => {
        clearError()
        onRetry()
      })
      errorBox!.appendChild(retry)
    }
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
      delete activityTitle.dataset.usage
      activityEntries.clear()
      activityEntries.set("reasoning", { label: "Thinking", status: "running" })
      if (permissionBox) permissionBox.hidden = true
      if (evidenceBox) evidenceBox.hidden = true
      renderActivity()
    } else if (!abortController?.signal.aborted) {
      const usageNote = activityTitle.dataset.usage
      activityTitle.textContent =
        activityTitle.textContent === "Stopped with an error"
          ? activityTitle.textContent
          : usageNote
            ? `Completed · ${usageNote}`
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

  function lowerFirst(value: string): string {
    return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
  }

  function activityStatusSentence(entry: { label: string; status: string }): string {
    const rawLabel = entry.label.trim().replace(/[.!?]+$/, "")
    const phrase = rawLabel === "Writing answer" ? "Writing the answer" : rawLabel || "Working"

    if (entry.status === "permission_required") return "Permission is required."
    if (entry.status === "denied") return "Permission was denied."
    if (entry.status === "failed") return `${phrase} failed.`
    if (entry.status === "cancelled") return `${phrase} was cancelled.`
    if (entry.status === "running") return `${phrase}.`
    if (phrase === "Thinking") return "Done thinking."
    if (phrase === "Writing the answer") return "Finished writing the answer."
    if (phrase === "Requesting permission") return "Permission was granted."
    return `Finished ${lowerFirst(phrase)}.`
  }

  function renderActivity() {
    if (!activityList) return
    activityList.replaceChildren()
    for (const entry of activityEntries.values()) {
      const item = document.createElement("li")
      const text = document.createElement("span")
      text.textContent = entry.detail
        ? `${activityStatusSentence(entry)} ${entry.detail}`
        : activityStatusSentence(entry)
      item.appendChild(text)
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
        if (entry) entry.status = decision.value === "reject" ? "denied" : "completed"
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
    sessionId: string | number,
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
          renderAssistantContent(assistantEl, text)
          messages!.scrollTop = messages!.scrollHeight
        } else if (event.type === "assistant.completed") {
          const usage = event.payload?.usage
          const total = Number(usage?.totalTokens ?? usage?.total_tokens)
          if (activityTitle && Number.isFinite(total) && total > 0) {
            activityTitle.dataset.usage = `${Math.trunc(total)} tokens`
          }
        } else if (event.type === "reasoning.status") {
          const entry = activityEntries.get("reasoning")
          if (entry && entry.status === "running") {
            entry.label = String(event.payload?.label ?? "Thinking")
            renderActivity()
          }
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

  async function send(promptText: string, clientMessageId = crypto.randomUUID(), retry = false) {
    const trimmed = promptText.trim()
    if (!trimmed) return
    clearError()
    addMessage("user", trimmed)
    const assistantEl = addMessage("assistant", "…")
    setBusy(true)
    try {
      const turn = {
        clientMessageId,
        text: trimmed,
        sessionId: state.sessionId,
        clientToken: state.clientToken,
        model: state.model || undefined,
        reasoningEffort: state.effort || undefined,
        retry,
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
        showError(
          error instanceof Error ? error.message : "The assistant is unavailable.",
          () => void send(trimmed, clientMessageId, true),
        )
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
    syncCommandTint()
    void send(value)
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      if (sendBtn.disabled) return
      const value = input.value
      if (!value.trim()) return
      input.value = ""
      syncCommandTint()
      void send(value)
    }
  })
  input.addEventListener("input", () => {
    if (input.value === "/") void openCommands()
    syncCommandTint()
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

  // Restore the persisted transcript of the page session after a reload.
  if (state.sessionId) void restoreTranscript()
}

document.addEventListener("nav", () => {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>(".breadboard-ai"))) {
    if (root.dataset.wired === "1") continue
    root.dataset.wired = "1"
    setupPanel(root)
  }
})
