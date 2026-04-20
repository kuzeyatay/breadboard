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
      "http://localhost:3000"
    ).replace(/\/+$/, "")
    const slug = clusterSlug(fileData.slug)
    const href = slug ? `${dashboardBaseUrl}/clusters/${encodeURIComponent(slug)}` : `${dashboardBaseUrl}/dashboard`
    const label = slug ? "Back to cluster" : "Back to dashboard"

    return (
      <a class={`${displayClass ?? ""} dashboard-back-link`} href={href} target="_top">
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

  return DashboardBackLink
}) satisfies QuartzComponentConstructor<Options | undefined>
