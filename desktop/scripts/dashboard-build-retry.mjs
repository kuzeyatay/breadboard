const transientFilesystemCodePattern = /\b(?:EBUSY|ENOENT|EPERM)\b/u;
const windowsMissingPathPattern =
  /(?:the system cannot find the path specified[^\n]*\bos error 3\b|\bos error 3\b)/iu;
const managedOutputPattern = /\.next-desktop(?:-last-good)?/u;
const transientOperationPattern =
  /(?:\.tmp(?:[.\/]|\b)|\brename\b|\brmdir\b|\bunlink\b|\bfailed to write\b)/u;

/**
 * Next occasionally loses or retains one of its own temporary output files on
 * Windows. Retrying those bounded, output-local failures is safe after the
 * build-cache rollback; compile, type, and application errors stay terminal.
 */
export function isTransientDashboardBuildFailure(output) {
  const normalized = String(output ?? "").replaceAll("\\", "/");
  return (
    (transientFilesystemCodePattern.test(normalized) ||
      windowsMissingPathPattern.test(normalized)) &&
    managedOutputPattern.test(normalized) &&
    transientOperationPattern.test(normalized)
  );
}
