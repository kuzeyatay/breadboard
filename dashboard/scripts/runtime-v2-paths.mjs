import path from "node:path";

// Keep native authority comparisons in their canonical namespace, but launch
// third-party tools with the ordinary spelling of a validated filesystem path.
// Python packages such as PyCryptodome append '..' to __file__; Windows does
// not resolve those segments under the extended-length \\?\ namespace.
export function runtimeProcessPath(value, platform = process.platform) {
  if (platform !== "win32") return value;
  if (/^\\\\\?\\[a-z]:\\/iu.test(value)) return value.slice(4);
  if (/^\\\\\?\\UNC\\/iu.test(value)) return `\\\\${value.slice(8)}`;
  return value;
}

// Rust canonicalizes Windows paths to \\?\C:\... (or \\?\UNC\...), while
// Node's native realpath can return the equivalent unprefixed path. Both
// identity and containment checks must use the same spelling. This is lexical
// normalization only: callers still lstat/realpath to reject redirected paths.
function comparablePath(value, platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = paths.resolve(value);
  return platform === "win32"
    ? paths.toNamespacedPath(resolved).toLowerCase()
    : resolved;
}

export function sameRuntimePath(left, right, platform = process.platform) {
  return comparablePath(left, platform) === comparablePath(right, platform);
}

export function runtimePathWithin(root, candidate, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const relative = paths.relative(
    comparablePath(root, platform),
    comparablePath(candidate, platform),
  );
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
}
