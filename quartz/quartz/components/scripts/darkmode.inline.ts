const userPref = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
const requestedTheme = new URLSearchParams(window.location.search).get("theme")
const currentTheme =
  requestedTheme === "light" || requestedTheme === "dark"
    ? requestedTheme
    : (localStorage.getItem("theme") ?? userPref)
document.documentElement.setAttribute("saved-theme", currentTheme)

// The dashboard seeds an embedded Quartz page with `?theme=...` so its first
// paint matches the surrounding app. Internal Markdown links do not carry that
// query parameter, so remember a valid launch hint for the next full-page
// navigation as well. Storage can be unavailable in a restricted iframe; the
// correctly themed first paint should still survive in that case.
if (requestedTheme === "light" || requestedTheme === "dark") {
  try {
    localStorage.setItem("theme", requestedTheme)
  } catch {}
}

const emitThemeChangeEvent = (theme: "light" | "dark") => {
  const event: CustomEventMap["themechange"] = new CustomEvent("themechange", {
    detail: { theme },
  })
  document.dispatchEvent(event)
}

const applyTheme = (theme: "light" | "dark") => {
  document.documentElement.setAttribute("saved-theme", theme)
  localStorage.setItem("theme", theme)
  emitThemeChangeEvent(theme)
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return
  const message = event.data as { type?: unknown; theme?: unknown } | null
  if (
    message?.type !== "breadboard:theme" ||
    (message.theme !== "light" && message.theme !== "dark")
  ) {
    return
  }
  applyTheme(message.theme)
})

document.addEventListener("nav", () => {
  const switchTheme = () => {
    const newTheme =
      document.documentElement.getAttribute("saved-theme") === "dark" ? "light" : "dark"
    applyTheme(newTheme)
  }

  const themeChange = (e: MediaQueryListEvent) => {
    const newTheme = e.matches ? "dark" : "light"
    applyTheme(newTheme)
  }

  for (const darkmodeButton of document.getElementsByClassName("darkmode")) {
    darkmodeButton.addEventListener("click", switchTheme)
    window.addCleanup(() => darkmodeButton.removeEventListener("click", switchTheme))
  }

  // Listen for changes in prefers-color-scheme
  const colorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
  colorSchemeMediaQuery.addEventListener("change", themeChange)
  window.addCleanup(() => colorSchemeMediaQuery.removeEventListener("change", themeChange))
})
