let isReaderMode = false

const notifyReaderMode = (targetOrigin = "*") => {
  if (window.parent === window) return
  window.parent.postMessage(
    { type: "second-brain:reader-mode", enabled: isReaderMode },
    targetOrigin,
  )
}

const emitReaderModeChangeEvent = (mode: "on" | "off") => {
  const event: CustomEventMap["readermodechange"] = new CustomEvent("readermodechange", {
    detail: { mode },
  })
  document.dispatchEvent(event)
  for (const button of document.getElementsByClassName("readermode")) {
    button.setAttribute("aria-pressed", String(mode === "on"))
  }
  notifyReaderMode()
}

// Answer again after host hydration or a full iframe load, when the initial
// navigation announcement may have preceded the dashboard's listener.
window.addEventListener("message", (event: MessageEvent) => {
  if (window.parent === window || event.source !== window.parent) return
  if (event.data?.type === "second-brain:reader-mode-request") notifyReaderMode(event.origin)
})

document.addEventListener("nav", () => {
  const switchReaderMode = () => {
    isReaderMode = !isReaderMode
    const newMode = isReaderMode ? "on" : "off"
    document.documentElement.setAttribute("reader-mode", newMode)
    emitReaderModeChangeEvent(newMode)
  }

  for (const readerModeButton of document.getElementsByClassName("readermode")) {
    readerModeButton.addEventListener("click", switchReaderMode)
    window.addCleanup(() => readerModeButton.removeEventListener("click", switchReaderMode))
  }

  // Set initial state
  document.documentElement.setAttribute("reader-mode", isReaderMode ? "on" : "off")
  emitReaderModeChangeEvent(isReaderMode ? "on" : "off")
})
