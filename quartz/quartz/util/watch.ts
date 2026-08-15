const learnPromotionDirectoryPattern = /^\.[^/]+\.(?:incoming|previous)-[^/]*$/

/**
 * Paths that are implementation details rather than Quartz content.
 *
 * This predicate is used by chokidar itself so these directories are pruned
 * before it subscribes to them. In particular, keeping watcher handles out of
 * Learn's atomic promotion directories lets Windows rename those directories.
 */
export function isQuartzInternalWatchPath(fp: string): boolean {
  const segments = fp.replaceAll("\\", "/").split("/")

  return segments.some(
    (segment) => segment === ".breadboard" || learnPromotionDirectoryPattern.test(segment),
  )
}
