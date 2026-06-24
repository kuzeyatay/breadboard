import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

const PageTitle: QuartzComponent = ({ cfg, displayClass }: QuartzComponentProps) => {
  const title = cfg?.pageTitle ?? i18n(cfg.locale).propertyDefaults.title
  const dashboardBaseUrl = (
    process.env.DASHBOARD_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    ""
  ).replace(/\/+$/, "")
  const dashboardHref = `${dashboardBaseUrl || ""}/dashboard`
  return (
    <h2 class={classNames(displayClass, "page-title")}>
      <a
        href={dashboardHref}
        class="page-title-link"
        data-dashboard-base-url={dashboardBaseUrl}
        data-dashboard-href={dashboardHref}
      >
        {title}
      </a>
    </h2>
  )
}

PageTitle.css = `
.page-title {
  color: var(--dark);
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0;
  font-family: var(--titleFont);
}
.page-title-link {
  color: inherit;
  cursor: pointer;
  font-weight: inherit;
}
`

PageTitle.afterDOMLoaded = `
document.querySelectorAll(".page-title-link").forEach(function(el) {
  const resolveDashboardBaseUrl = (fallback) => {
    const trimmed = (fallback || "").replace(/\\/+$/, "");
    if (trimmed && !/^https?:\\/\\/(?:localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)(?::\\d+)?$/i.test(trimmed)) {
      return trimmed;
    }
    try {
      if (trimmed) {
        const fallbackUrl = new URL(trimmed);
        if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(fallbackUrl.hostname)) {
          return fallbackUrl.protocol + "//" + fallbackUrl.hostname + ":3000";
        }
      }
    } catch {}
    try {
      if (document.referrer) {
        const ref = new URL(document.referrer);
        if (!/^garden\\./i.test(ref.hostname)) {
          return ref.origin.replace(/\\/+$/, "");
        }
      }
    } catch {}
    try {
      const current = new URL(window.location.href);
      if (/^garden\\./i.test(current.hostname)) {
        return current.origin.replace("//garden.", "//");
      }
      if (/^(localhost|127(?:\\.\\d+){3}|0\\.0\\.0\\.0)$/i.test(current.hostname) || current.port === "8081") {
        return current.protocol + "//" + current.hostname + ":3000";
      }
      return current.origin.replace(/\\/+$/, "");
    } catch {}
    return trimmed;
  };

  const href = resolveDashboardBaseUrl(el.getAttribute("data-dashboard-base-url")) + "/dashboard";
  el.setAttribute("data-dashboard-href", href);
  el.setAttribute("href", href);
  el.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    var href = el.getAttribute("data-dashboard-href");
    if (window.top) {
      window.top.location.href = href;
    } else {
      window.location.href = href;
    }
  });
});
`

export default (() => PageTitle) satisfies QuartzComponentConstructor
