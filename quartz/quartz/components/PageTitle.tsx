import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

const PageTitle: QuartzComponent = ({ cfg, displayClass }: QuartzComponentProps) => {
  const title = cfg?.pageTitle ?? i18n(cfg.locale).propertyDefaults.title
  const dashboardBaseUrl = (
    process.env.DASHBOARD_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "")
  const dashboardHref = `${dashboardBaseUrl}/dashboard`
  return (
    <h2 class={classNames(displayClass, "page-title")}>
      <a href={dashboardHref} class="page-title-link" data-dashboard-href={dashboardHref}>{title}</a>
    </h2>
  )
}

PageTitle.css = `
.page-title {
  font-size: 1.75rem;
  margin: 0;
  font-family: var(--titleFont);
}
.page-title-link {
  cursor: pointer;
}
`

PageTitle.afterDOMLoaded = `
document.querySelectorAll(".page-title-link").forEach(function(el) {
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
