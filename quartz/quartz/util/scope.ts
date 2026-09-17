import { toPosixPath } from "./glob"

/**
 * A scoped build renders only the content folders named by `--scope` (posix
 * paths relative to the content directory, e.g. `math-1`). Link resolution
 * still sees every file in the garden, while site-wide artifacts that would be
 * wrong when derived from a subset (tag pages, sitemap, RSS) are skipped so the
 * publisher can carry them over from the previous publication.
 */
export type BuildScope = readonly string[]

const SCOPE_SEGMENT = /^[^\\/\0]+$/

export function normalizeBuildScope(raw: unknown): BuildScope {
  if (raw === undefined || raw === null) return []
  const values = Array.isArray(raw) ? raw : [raw]
  const scope = new Set<string>()
  for (const value of values) {
    if (typeof value !== "string") throw new Error("A build scope must be a string.")
    const normalized = toPosixPath(value.trim()).replace(/^\/+|\/+$/g, "")
    if (normalized === "") continue
    const segments = normalized.split("/")
    for (const segment of segments) {
      if (!SCOPE_SEGMENT.test(segment) || segment === "." || segment === "..") {
        throw new Error(`Invalid build scope: ${value}`)
      }
    }
    scope.add(segments.join("/"))
  }
  return [...scope]
}

export function isScopedBuild(scope: BuildScope | undefined): boolean {
  return Array.isArray(scope) && scope.length > 0
}

/** Whether a content-relative posix path lives inside one of the scope roots. */
export function pathWithinScope(relativePath: string, scope: BuildScope | undefined): boolean {
  if (!scope || !isScopedBuild(scope)) return true
  const normalized = toPosixPath(relativePath).replace(/^\.\//, "").replace(/^\/+/, "")
  return scope.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}
