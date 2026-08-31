// Whiteboard cards.
//
// A ```penecho block in a note becomes a board: a framed drawing surface, hosted
// by the PenEcho canvas server, that keeps its ink and its viewport between
// visits. This script builds the frame; everything inside it belongs to PenEcho.
//
// The frame is mounted lazily and only ever once. A board is a whole canvas
// application, so a note with several of them mounts each as it scrolls into
// view, and never unmounts one — a mounted board may hold work that has not
// been written back yet, and re-parenting an iframe reloads it.

interface BoardReference {
  id: string
  title: string
  height: number
  server: string
}

const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i
const DEFAULT_PENECHO_PORT = "8092"
const VIEW_HEARTBEAT_MS = 20_000
const FRAME_READY_TIMEOUT_MS = 30_000
const FRAME_READY_MESSAGE = "penecho:board-ready"

interface ServerResolution {
  url: string | null
  error: string
  leaseAcknowledged: boolean
}

const activeBoardCleanups = new Set<() => void>()

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

/**
 * The dashboard, which is the only thing that can start a canvas server. Mirrors
 * how the rest of the garden's embedded surfaces find it: the garden is either a
 * `garden.` subdomain of the dashboard or a sibling port on the same host.
 */
function dashboardBaseUrl(): string {
  try {
    const current = new URL(window.location.href)
    if (/^garden\./i.test(current.hostname)) return current.origin.replace("//garden.", "//")
    if (LOCAL_HOST.test(current.hostname) || current.port === "8081") {
      return `${current.protocol}//${current.hostname}:3000`
    }
    return current.origin
  } catch {
    return ""
  }
}

/** Where the canvas server lives when the build did not name one. */
function derivedServerUrl(): string {
  try {
    const current = new URL(window.location.href)
    if (LOCAL_HOST.test(current.hostname) || current.port === "8081") {
      return `${current.protocol}//${current.hostname}:${DEFAULT_PENECHO_PORT}`
    }
    if (/^garden\./i.test(current.hostname)) {
      return current.origin.replace("//garden.", "//penecho.")
    }
    return `${current.protocol}//penecho.${current.host}`
  } catch {
    return ""
  }
}

function readBoard(code: HTMLElement): BoardReference | null {
  const id = code.dataset.boardId ?? ""
  if (!id) return null
  const height = Number(code.dataset.boardHeight)
  return {
    id,
    title: code.dataset.boardTitle || "Whiteboard",
    height: Number.isFinite(height) && height > 0 ? height : 520,
    server: code.dataset.boardServer || derivedServerUrl(),
  }
}

/**
 * Ask the dashboard for a running canvas server, starting one if needed.
 *
 * Returns the server to frame, or null when the dashboard answered that it has
 * none. An unreachable dashboard is not an answer: a garden can be read while
 * the dashboard is down, so the board is framed anyway and the server itself
 * gets to say whether it is there.
 */
async function resolveServer(fallback: string, viewId: string): Promise<ServerResolution> {
  const dashboard = dashboardBaseUrl()
  if (!dashboard) return { url: fallback || null, error: "", leaseAcknowledged: false }
  try {
    const response = await fetch(`${dashboard}/api/penecho/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewId }),
      cache: "no-store",
    })
    const body = (await response.json().catch(() => ({}))) as {
      running?: boolean
      baseUrl?: string
      available?: boolean
      error?: string
      viewId?: string
    }
    if (response.ok && body.running) {
      return {
        url: body.baseUrl || fallback,
        error: "",
        // An older dashboard can still serve the board, but only Runtime V2
        // acknowledges the opaque view hold that should be renewed/released.
        leaseAcknowledged: body.viewId === viewId,
      }
    }
    return {
      url: null,
      error:
        body.available === false
          ? "The whiteboard server is not installed next to this dashboard."
          : body.error || "The whiteboard server could not be started.",
      leaseAcknowledged: false,
    }
  } catch {
    return { url: fallback || null, error: "", leaseAcknowledged: false }
  }
}

async function renewViewLease(viewId: string): Promise<boolean> {
  const dashboard = dashboardBaseUrl()
  if (!dashboard) return false
  try {
    const response = await fetch(`${dashboard}/api/penecho/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewId }),
      cache: "no-store",
    })
    if (!response.ok) return false
    const body = (await response.json().catch(() => ({}))) as {
      running?: boolean
      viewId?: string
    }
    return body.running === true && body.viewId === viewId
  } catch {
    return false
  }
}

function releaseViewLease(viewId: string): void {
  const dashboard = dashboardBaseUrl()
  if (!dashboard) return
  void fetch(`${dashboard}/api/penecho/status`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewId }),
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined)
}

function boardUrl(server: string, board: BoardReference): string {
  const url = new URL(server)
  url.pathname = "/"
  url.searchParams.set("board", board.id)
  if (board.title) url.searchParams.set("title", board.title)
  return url.toString()
}

function buildPenechoCard(board: BoardReference): { card: HTMLElement; dispose: () => void } {
  const card = element("section", "penecho-board")
  card.classList.add("penecho-board--loading")
  card.dataset.boardId = board.id
  card.style.setProperty("--penecho-board-height", `${board.height}px`)
  const viewId = crypto.randomUUID()

  const header = element("header", "penecho-board-header")
  header.appendChild(element("h4", "penecho-board-title", board.title))

  const expand = element("button", "penecho-board-action", "Expand") as HTMLButtonElement
  expand.type = "button"
  expand.setAttribute("aria-expanded", "false")
  header.appendChild(expand)
  card.appendChild(header)

  const surface = element("div", "penecho-board-surface")
  surface.setAttribute("aria-busy", "true")
  const placeholder = element("div", "penecho-board-placeholder")
  placeholder.setAttribute("role", "status")
  placeholder.setAttribute("aria-live", "polite")
  const loadingIndicator = element("span", "penecho-board-loading-indicator")
  loadingIndicator.setAttribute("aria-hidden", "true")
  placeholder.appendChild(loadingIndicator)
  placeholder.appendChild(element("p", "penecho-board-placeholder-text", "Starting whiteboard…"))
  const retry = element("button", "penecho-board-action", "Try again") as HTMLButtonElement
  retry.type = "button"
  retry.hidden = true
  placeholder.appendChild(retry)
  surface.appendChild(placeholder)
  card.appendChild(surface)

  let frame: HTMLIFrameElement | null = null
  let disposed = false
  let leaseAcknowledged = false
  let heartbeat: number | null = null
  let heartbeatRequest: Promise<void> | null = null
  let mountPromise: Promise<void> | null = null
  let frameReadyTimeout: number | null = null
  let expectedFrameOrigin = ""
  const setMessage = (message: string, retryable: boolean, loading = false) => {
    placeholder.querySelector(".penecho-board-placeholder-text")!.textContent = message
    retry.hidden = !retryable
    loadingIndicator.hidden = !loading
    card.classList.toggle("penecho-board--loading", loading)
    card.classList.toggle("penecho-board--error", retryable)
    surface.setAttribute("aria-busy", String(loading))
  }
  const clearFrameReadyTimeout = () => {
    if (frameReadyTimeout === null) return
    window.clearTimeout(frameReadyTimeout)
    frameReadyTimeout = null
  }
  const markFrameReady = () => {
    if (!frame || disposed) return
    clearFrameReadyTimeout()
    card.classList.remove("penecho-board--loading", "penecho-board--error")
    card.classList.add("penecho-board--ready")
    surface.setAttribute("aria-busy", "false")
  }
  const failFrame = (message: string) => {
    if (disposed || card.classList.contains("penecho-board--ready")) return
    clearFrameReadyTimeout()
    frame?.remove()
    frame = null
    expectedFrameOrigin = ""
    card.classList.remove("penecho-board--mounted", "penecho-board--ready")
    setMessage(message, true)
  }
  const onFrameMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; boardId?: unknown } | null
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== expectedFrameOrigin ||
      data?.type !== FRAME_READY_MESSAGE ||
      data.boardId !== board.id
    )
      return
    markFrameReady()
  }
  window.addEventListener("message", onFrameMessage)

  const startHeartbeat = () => {
    if (heartbeat !== null || disposed) return
    heartbeat = window.setInterval(() => {
      if (disposed || heartbeatRequest) return
      heartbeatRequest = renewViewLease(viewId)
        .then((renewed) => {
          if (renewed) leaseAcknowledged = true
        })
        .finally(() => {
          heartbeatRequest = null
        })
    }, VIEW_HEARTBEAT_MS)
  }

  const mount = (): Promise<void> => {
    if (frame || disposed) return Promise.resolve()
    if (mountPromise) return mountPromise
    mountPromise = (async () => {
      setMessage("Starting whiteboard…", false, true)
      const resolution = await resolveServer(board.server, viewId)
      if (resolution.leaseAcknowledged) {
        if (disposed) {
          releaseViewLease(viewId)
          return
        }
        leaseAcknowledged = true
        startHeartbeat()
      }
      if (disposed) return
      if (!resolution.url) {
        setMessage(resolution.error || "The whiteboard server is not running.", true)
        return
      }

      let source: string
      try {
        source = boardUrl(resolution.url, board)
        expectedFrameOrigin = new URL(source).origin
      } catch {
        if (leaseAcknowledged) {
          leaseAcknowledged = false
          releaseViewLease(viewId)
        }
        setMessage("The whiteboard server address is invalid.", true)
        return
      }
      setMessage("Loading whiteboard…", false, true)
      const mountedFrame = element("iframe", "penecho-board-frame") as HTMLIFrameElement
      frame = mountedFrame
      mountedFrame.title = board.title
      mountedFrame.src = source
      mountedFrame.allow = "clipboard-read; clipboard-write"
      // Current managed PenEcho builds send a board-ready message after the
      // requested snapshot has been restored. The load event remains a
      // compatibility fallback for externally managed or older servers.
      if (!resolution.leaseAcknowledged)
        mountedFrame.addEventListener(
          "load",
          () => {
            if (frame === mountedFrame) markFrameReady()
          },
          { once: true },
        )
      mountedFrame.addEventListener(
        "error",
        () => {
          if (frame === mountedFrame) failFrame("The whiteboard could not be loaded.")
        },
        { once: true },
      )
      surface.appendChild(mountedFrame)
      card.classList.add("penecho-board--mounted")
      frameReadyTimeout = window.setTimeout(() => {
        if (frame === mountedFrame) failFrame("The whiteboard is taking too long to load.")
      }, FRAME_READY_TIMEOUT_MS)
    })().finally(() => {
      mountPromise = null
    })
    return mountPromise
  }
  const onRetry = () => void mount()
  retry.addEventListener("click", onRetry)

  // Expanding is a state of the card, not a different card: the frame stays put
  // and only its box changes, because moving an iframe in the document reloads
  // it and would throw away whatever is on the board.
  let spacer: HTMLElement | null = null
  const setExpanded = (expanded: boolean) => {
    if (expanded) {
      // Taking the card out of the flow would otherwise pull the rest of the
      // note up behind it, and drop the reader somewhere else on collapse.
      spacer = element("div", "penecho-board-spacer")
      spacer.style.height = `${card.offsetHeight}px`
      card.insertAdjacentElement("beforebegin", spacer)
    } else {
      spacer?.remove()
      spacer = null
    }
    card.classList.toggle("penecho-board--expanded", expanded)
    document.documentElement.classList.toggle("penecho-board-open", expanded)
    expand.textContent = expanded ? "Close" : "Expand"
    expand.setAttribute("aria-expanded", String(expanded))
    if (expanded) void mount()
  }
  const toggle = () => setExpanded(!card.classList.contains("penecho-board--expanded"))
  const onExpand = (event: MouseEvent) => {
    event.stopPropagation()
    toggle()
  }
  expand.addEventListener("click", onExpand)
  // The board itself is drawn on, so only its title bar is a click target.
  header.addEventListener("click", toggle)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && card.classList.contains("penecho-board--expanded"))
      setExpanded(false)
  }
  document.addEventListener("keydown", onKeyDown)

  // A board is a canvas application; mounting every one on a long note at once
  // would cost more than the page is worth. Mount the ones that are looked at.
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void mount()
    },
    { rootMargin: "200px" },
  )
  observer.observe(card)

  const dispose = () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    retry.removeEventListener("click", onRetry)
    expand.removeEventListener("click", onExpand)
    header.removeEventListener("click", toggle)
    document.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("message", onFrameMessage)
    clearFrameReadyTimeout()
    if (heartbeat !== null) window.clearInterval(heartbeat)
    heartbeat = null
    spacer?.remove()
    spacer = null
    card.classList.remove("penecho-board--expanded")
    document.documentElement.classList.remove("penecho-board-open")
    frame?.remove()
    frame = null
    if (leaseAcknowledged) {
      leaseAcknowledged = false
      releaseViewLease(viewId)
    }
    activeBoardCleanups.delete(dispose)
  }

  return { card, dispose }
}

function buildFallback(): HTMLElement {
  const fallback = element("aside", "penecho-board-fallback")
  fallback.setAttribute("role", "note")
  fallback.appendChild(element("strong", undefined, "Whiteboard unavailable"))
  fallback.appendChild(
    element("p", undefined, "This whiteboard reference is missing its board id."),
  )
  return fallback
}

function disposeActiveBoards(): void {
  for (const dispose of [...activeBoardCleanups]) dispose()
  activeBoardCleanups.clear()
}

window.addEventListener("pagehide", disposeActiveBoards)

document.addEventListener("nav", () => {
  disposeActiveBoards()
  const nodes = document.querySelectorAll("code.penecho-board-block") as NodeListOf<HTMLElement>
  for (const code of nodes) {
    const host = (code.closest("pre") as HTMLElement | null) ?? code
    if (host.dataset.penechoBound === "true") continue
    host.dataset.penechoBound = "true"
    const board = readBoard(code)
    if (!board) {
      host.replaceWith(buildFallback())
      continue
    }
    const built = buildPenechoCard(board)
    activeBoardCleanups.add(built.dispose)
    host.replaceWith(built.card)
  }
})
