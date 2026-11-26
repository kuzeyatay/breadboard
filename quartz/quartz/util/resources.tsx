import { createHash, randomUUID } from "crypto"
import { JSX } from "preact/jsx-runtime"
import { QuartzPluginData } from "../plugins/vfile"

export type JSResource = {
  loadTime: "beforeDOMReady" | "afterDOMReady"
  moduleType?: "module"
  spaPreserve?: boolean
} & (
  | {
      src: string
      contentType: "external"
    }
  | {
      script: string
      contentType: "inline"
    }
)

export type CSSResource = {
  content: string
  inline?: boolean
  spaPreserve?: boolean
}

export function JSResourceToScriptElement(resource: JSResource, preserve?: boolean): JSX.Element {
  const scriptType = resource.moduleType ?? "application/javascript"
  const spaPreserve = preserve ?? resource.spaPreserve

  if (resource.contentType === "external") {
    return (
      <script key={resource.src} src={resource.src} type={scriptType} data-persist={spaPreserve} />
    )
  } else {
    const content = resource.script
    return (
      <script
        key={randomUUID()}
        type={scriptType}
        data-persist={spaPreserve}
        dangerouslySetInnerHTML={{ __html: content }}
      ></script>
    )
  }
}

export function CSSResourceToStyleElement(resource: CSSResource, preserve?: boolean): JSX.Element {
  const spaPreserve = preserve ?? resource.spaPreserve
  if (resource.inline ?? false) {
    return <style>{resource.content}</style>
  } else {
    return (
      <link
        key={resource.content}
        href={resource.content}
        rel="stylesheet"
        type="text/css"
        data-persist={spaPreserve}
      />
    )
  }
}

/**
 * Plugin scripts and styles are identical on every page, yet were inlined into
 * each one: ~270 KB per page, about 3 GB across one real 11,625-page garden.
 * They are written once, content-addressed, and every page links the same
 * file. Pages render every resource with data-persist, so SPA navigation keeps
 * the element (and its resolved URL) exactly as it kept the inline copy.
 * Module scripts stay inline: their relative imports resolve against the page.
 */
export const SHARED_RESOURCE_MIN_BYTES = 1024

export type SharedResourceFile = { slug: string; ext: ".js" | ".css"; content: string }

function sharedSlug(content: string): string {
  return `static/shared/${createHash("sha256").update(content).digest("hex").slice(0, 20)}`
}

function shareableScript(
  resource: JSResource,
): resource is JSResource & { contentType: "inline"; script: string } {
  return (
    resource.contentType === "inline" &&
    resource.moduleType !== "module" &&
    resource.script.length >= SHARED_RESOURCE_MIN_BYTES
  )
}

function shareableStyle(resource: CSSResource): boolean {
  return (resource.inline ?? false) && resource.content.length >= SHARED_RESOURCE_MIN_BYTES
}

/** The files a build must emit for the links produced by `linkSharedResources`. */
export function sharedResourceFiles(
  resources: Pick<StaticResources, "css" | "js">,
): SharedResourceFile[] {
  const files = new Map<string, SharedResourceFile>()
  for (const resource of resources.js)
    if (shareableScript(resource))
      files.set(`${sharedSlug(resource.script)}.js`, {
        slug: sharedSlug(resource.script),
        ext: ".js",
        content: resource.script,
      })
  for (const resource of resources.css)
    if (shareableStyle(resource))
      files.set(`${sharedSlug(resource.content)}.css`, {
        slug: sharedSlug(resource.content),
        ext: ".css",
        content: resource.content,
      })
  return [...files.values()]
}

/** Replace large inline resources with links to their shared files, in place and order. */
export function linkSharedResources(
  resources: Pick<StaticResources, "css" | "js">,
  join: (path: string) => string,
): Pick<StaticResources, "css" | "js"> {
  return {
    js: resources.js.map((resource) =>
      shareableScript(resource)
        ? {
            src: join(`${sharedSlug(resource.script)}.js`),
            contentType: "external" as const,
            loadTime: resource.loadTime,
            spaPreserve: resource.spaPreserve,
          }
        : resource,
    ),
    css: resources.css.map((resource) =>
      shareableStyle(resource)
        ? {
            content: join(`${sharedSlug(resource.content)}.css`),
            spaPreserve: resource.spaPreserve,
          }
        : resource,
    ),
  }
}

export interface StaticResources {
  css: CSSResource[]
  js: JSResource[]
  additionalHead: (JSX.Element | ((pageData: QuartzPluginData) => JSX.Element))[]
}

export type StringResource = string | string[] | undefined
export function concatenateResources(...resources: StringResource[]): StringResource {
  return resources
    .filter((resource): resource is string | string[] => resource !== undefined)
    .flat()
}
