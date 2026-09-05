const WINDOWS_VERBATIM_PREFIX = "\\\\?\\";
const WINDOWS_VERBATIM_UNC_PREFIX = "\\\\?\\UNC\\";
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:\\/u;

/**
 * Present a trusted absolute path in the spelling Windows language runtimes
 * consistently accept. Runtime keeps the verbatim path for its own canonical
 * containment checks; only the child-facing copy is changed here.
 */
export function childProcessPath(value, platform = process.platform) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Child process path must be a non-empty string.");
  }
  if (platform !== "win32") return value;

  if (value.toUpperCase().startsWith(WINDOWS_VERBATIM_UNC_PREFIX.toUpperCase())) {
    const networkPath = value.slice(WINDOWS_VERBATIM_UNC_PREFIX.length);
    const [server, share] = networkPath.split("\\");
    if (!server || !share) {
      throw new TypeError("Windows verbatim UNC path has no server and share.");
    }
    return `\\\\${networkPath}`;
  }
  if (value.startsWith(WINDOWS_VERBATIM_PREFIX)) {
    const drivePath = value.slice(WINDOWS_VERBATIM_PREFIX.length);
    if (WINDOWS_DRIVE_ABSOLUTE.test(drivePath)) return drivePath;
    throw new TypeError("Windows verbatim path has no supported child-process spelling.");
  }
  return value;
}
