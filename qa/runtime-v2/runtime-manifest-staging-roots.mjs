import path from "node:path";

/**
 * Resolves one already-validated runtime-root manifest path against the same
 * split staging roots consumed by electron-builder and verify-package.
 * Native binaries under bin/ are produced in desktop/resources/bin; all
 * remaining runtime-root content is produced in desktop/build-resources.
 */
export function resolveStagedRuntimeProbePath(
  stagedRuntimeRoot,
  stagedBinRoot,
  relativePath,
) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    throw new TypeError("runtime-root probe path must be relative");
  }
  const segments = relativePath.split(/[\\/]/u);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError("runtime-root probe path must stay within its authority");
  }
  return segments[0] === "bin"
    ? path.join(stagedBinRoot, ...segments.slice(1))
    : path.join(stagedRuntimeRoot, ...segments);
}
