/** Desktop ports change on each launch; embedded lessons know their host. */
export function generatedVisualDashboardBaseUrl(href: string, referrer: string, ancestorOrigin = ""): string {
  try {
    const current = new URL(href)
    // The dashboard serves the Learning Map preview itself, so it is already
    // the dashboard; guessing a port sent its requests to :3000.
    if (current.pathname.startsWith("/api/quartz-graph-preview")) return current.origin
    // A full navigation inside the iframe replaces document.referrer with a
    // Quartz URL. Its embedding origin still identifies this dashboard launch.
    for (const candidate of [ancestorOrigin, referrer]) {
      if (!candidate) continue
      let host: URL
      try { host = new URL(candidate) } catch { continue }
      if (
        /^https?:$/.test(host.protocol) &&
        host.protocol === current.protocol &&
        host.hostname === current.hostname &&
        host.origin !== current.origin
      )
        return host.origin
    }
    if (/^garden\./i.test(current.hostname)) return current.origin.replace("//garden.", "//")
    if (
      /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(current.hostname) ||
      current.port === "8081"
    )
      return `${current.protocol}//${current.hostname}:3000`
    return current.origin
  } catch {
    return ""
  }
}
