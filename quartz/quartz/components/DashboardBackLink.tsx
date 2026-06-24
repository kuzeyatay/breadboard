import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface Options {
  dashboardBaseUrl?: string
}

function clusterSlug(fileSlug?: string): string | undefined {
  const firstSegment = fileSlug?.split("/").filter(Boolean)[0]
  if (!firstSegment || firstSegment === "index" || firstSegment === "tags") return undefined
  return firstSegment
}

export default ((opts?: Options) => {
  const DashboardBackLink: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const dashboardBaseUrl = (
      opts?.dashboardBaseUrl ??
      process.env.DASHBOARD_URL ??
      process.env.NEXT_PUBLIC_DASHBOARD_URL ??
      ""
    ).replace(/\/+$/, "")
    const slug = clusterSlug(fileData.slug)
    const href = slug ? `${dashboardBaseUrl || ""}/clusters/${encodeURIComponent(slug)}` : `${dashboardBaseUrl || ""}/dashboard`
    const label = slug ? "Back to cluster" : "Back to dashboard"

    return (
      <a
        class={`${displayClass ?? ""} dashboard-back-link`}
        href={href}
        target="_top"
        data-dashboard-base-url={dashboardBaseUrl}
        data-cluster-slug={slug ?? ""}
      >
        {label}
      </a>
    )
  }

  DashboardBackLink.css = `
.dashboard-back-link {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.75rem;
  color: var(--secondary);
  font-size: 0.95rem;
  font-weight: 600;
}

.dashboard-back-link::before {
  content: "";
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-left: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
}

.dashboard-back-link:hover {
  color: var(--tertiary);
}
`

  DashboardBackLink.afterDOMLoaded = `
function resolveDashboardBaseUrl(fallback) {
  const trimmed = (fallback || "").replace(/\\/+$/, "")
  if (trimmed && !/^https?:\\/\\/(?:localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)(?::\\d+)?$/i.test(trimmed)) {
    return trimmed
  }
  try {
    if (trimmed) {
      const fallbackUrl = new URL(trimmed)
      if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(fallbackUrl.hostname)) {
        return fallbackUrl.protocol + "//" + fallbackUrl.hostname + ":3000"
      }
    }
  } catch {}
  try {
    if (document.referrer) {
      const ref = new URL(document.referrer)
      if (!/^garden\\./i.test(ref.hostname)) {
        return ref.origin.replace(/\\/+$/, "")
      }
    }
  } catch {}
  try {
    const current = new URL(window.location.href)
    if (/^garden\\./i.test(current.hostname)) {
      return current.origin.replace("//garden.", "//")
    }
    if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(current.hostname) || current.port === "8081") {
      return current.protocol + "//" + current.hostname + ":3000"
    }
    return current.origin.replace(/\\/+$/, "")
  } catch {}
  return trimmed
}

function patchDashboardBackLinks() {
  document.querySelectorAll(".dashboard-back-link").forEach(function(el) {
    const base = resolveDashboardBaseUrl(el.getAttribute("data-dashboard-base-url"))
    const slug = el.getAttribute("data-cluster-slug") || ""
    const href = slug ? base + "/clusters/" + encodeURIComponent(slug) : base + "/dashboard"
    if (href) el.setAttribute("href", href)
  })
}

patchDashboardBackLinks()
document.addEventListener("nav", patchDashboardBackLinks)
`

  return DashboardBackLink
}) satisfies QuartzComponentConstructor<Options | undefined>
