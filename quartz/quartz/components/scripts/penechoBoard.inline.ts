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
async function resolveServer(fallback: string): Promise<{ url: string | null; error: string }> {
  const dashboard = dashboardBaseUrl()
  if (!dashboard) return { url: fallback || null, error: "" }
  try {
    const response = await fetch(`${dashboard}/api/penecho/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    const body = (await response.json().catch(() => ({}))) as {
      running?: boolean
      baseUrl?: string
      available?: boolean
      error?: string
    }
    if (response.ok && body.running) return { url: body.baseUrl || fallback, error: "" }
    return {
      url: null,
      error:
        body.available === false
          ? "The whiteboard server is not installed next to this dashboard."
          : body.error || "The whiteboard server could not be started.",
    }
  } catch {
    return { url: fallback || null, error: "" }
  }
}

function boardUrl(server: string, board: BoardReference): string {
  const url = new URL(server)
  url.pathname = "/"
  url.searchParams.set("board", board.id)
  if (board.title) url.searchParams.set("title", board.title)
  return url.toString()
}

function buildCard(board: BoardReference): HTMLElement {
  const card = element("section", "penecho-board")
  card.dataset.boardId = board.id
  card.style.setProperty("--penecho-board-height", `${board.height}px`)

  const header = element("header", "penecho-board-header")
  const heading = element("div", "penecho-board-heading")
  heading.appendChild(element("p", "penecho-board-kicker", "Whiteboard"))
  heading.appendChild(element("h4", "penecho-board-title", board.title))
  header.appendChild(heading)

  const expand = element("button", "penecho-board-action", "Expand") as HTMLButtonElement
  expand.type = "button"
  expand.setAttribute("aria-expanded", "false")
  header.appendChild(expand)
  card.appendChild(header)

  const surface = element("div", "penecho-board-surface")
  const placeholder = element("div", "penecho-board-placeholder")
  placeholder.appendChild(element("p", "penecho-board-placeholder-text", "Opening the board…"))
  const retry = element("button", "penecho-board-action", "Try again") as HTMLButtonElement
  retry.type = "button"
  retry.hidden = true
  placeholder.appendChild(retry)
  surface.appendChild(placeholder)
  card.appendChild(surface)

  let frame: HTMLIFrameElement | null = null
  const setMessage = (message: string, retryable: boolean) => {
    placeholder.querySelector(".penecho-board-placeholder-text")!.textContent = message
    retry.hidden = !retryable
  }

  const mount = async () => {
    if (frame) return
    retry.hidden = true
    setMessage("Opening the board…", false)
    const { url, error } = await resolveServer(board.server)
    if (!url) {
      setMessage(error || "The whiteboard server is not running.", true)
      return
    }
    frame = element("iframe", "penecho-board-frame") as HTMLIFrameElement
    frame.title = board.title
    frame.src = boardUrl(url, board)
    frame.allow = "clipboard-read; clipboard-write"
    surface.appendChild(frame)
    card.classList.add("penecho-board--mounted")
  }
  retry.addEventListener("click", () => void mount())

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
  expand.addEventListener("click", (event) => {
    event.stopPropagation()
    toggle()
  })
  // The board itself is drawn on, so only its title bar is a click target.
  header.addEventListener("click", toggle)
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && card.classList.contains("penecho-board--expanded")) setExpanded(false)
  })

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

  return card
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

document.addEventListener("nav", () => {
  const nodes = document.querySelectorAll("code.penecho-board-block") as NodeListOf<HTMLElement>
  for (const code of nodes) {
    const host = (code.closest("pre") as HTMLElement | null) ?? code
    if (host.dataset.penechoBound === "true") continue
    host.dataset.penechoBound = "true"
    const board = readBoard(code)
    host.replaceWith(board ? buildCard(board) : buildFallback())
  }
})
