import fs from "node:fs";
import path from "node:path";

const DATABASE_SUFFIX = /(?:\.db|\.sqlite|\.sqlite3)(?:-(?:shm|wal))?$/i;
const SECRET_SUFFIX = /\.(?:key|pem|p12|pfx)$/i;
const TEMPORARY_FILE = /^(?:\.tmp|tmp)[-_]|\.log$|\.tsbuildinfo$/i;
const WORKER_ONLY_DEPENDENCIES = new Set([
  "@embedpdf/pdfium",
  "esbuild",
  "three",
  "typescript",
]);

function workerOnlyDependency(segments) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "node_modules") continue;
    const first = segments[index + 1];
    if (first === "@esbuild") return "@esbuild";
    const packageName = first?.startsWith("@") && segments[index + 2]
      ? `${first}/${segments[index + 2]}`
      : first;
    if (WORKER_ONLY_DEPENDENCIES.has(packageName)) return packageName;
  }
  return null;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function traceManifests(root, current = root) {
  if (!fs.existsSync(current)) return [];
  const manifests = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) manifests.push(...traceManifests(root, absolute));
    else if (entry.isFile() && entry.name.endsWith(".nft.json")) manifests.push(absolute);
  }
  return manifests;
}

function protectedRoots(repoRoot) {
  const dashboard = path.join(repoRoot, "dashboard");
  return [
    path.join(repoRoot, ".git"),
    path.join(repoRoot, ".runtime"),
    path.join(repoRoot, ".agents"),
    path.join(repoRoot, "quartz", "content"),
    path.join(repoRoot, "quartz", "public"),
    path.join(repoRoot, "quartz", ".quartz-cache"),
    path.join(repoRoot, "qa"),
    path.join(repoRoot, "desktop", "tests"),
    path.join(dashboard, "db"),
    path.join(dashboard, "database"),
    path.join(dashboard, "artifacts"),
    path.join(dashboard, ".claude"),
    path.join(dashboard, ".runtime"),
    path.join(dashboard, ".vercel"),
    path.join(dashboard, "tests"),
    path.join(dashboard, "test-results"),
    path.join(dashboard, "neumorphic-before"),
    path.join(dashboard, "neumorphic-after"),
    path.join(dashboard, "cad-projects"),
    path.join(dashboard, "chat-documents"),
    path.join(dashboard, "chat-videos"),
    path.join(dashboard, "goal-mode"),
    path.join(dashboard, "hyperframes-cli"),
    path.join(dashboard, "hyperframes-runs"),
    path.join(dashboard, "loopx-goals"),
    path.join(dashboard, "openscience-cli"),
    path.join(dashboard, "openwork-state"),
    path.join(dashboard, "openwork-workspace"),
    path.join(dashboard, "openwork-runtime"),
    path.join(dashboard, "openscience-state"),
    path.join(dashboard, "openscience-workspace"),
    path.join(dashboard, "postiz"),
    path.join(dashboard, "video-use"),
    path.join(dashboard, "undefined"),
  ];
}

function unsafeReason(repoRoot, candidate) {
  const dashboard = path.join(repoRoot, "dashboard");
  if (!isInside(repoRoot, candidate)) return "escapes the repository trace root";

  const protectedRoot = protectedRoots(repoRoot).find((root) => isInside(root, candidate));
  if (protectedRoot) {
    return `enters protected root ${path.relative(repoRoot, protectedRoot).replaceAll(path.sep, "/")}`;
  }

  const relative = path.relative(repoRoot, candidate);
  const segments = relative.split(path.sep);
  const inDependency = segments.includes("node_modules");
  const workerDependency = workerOnlyDependency(segments);
  if (workerDependency) {
    return `enters worker-only dependency ${workerDependency}`;
  }
  const dashboardRelative = path.relative(dashboard, candidate);
  const dashboardTopLevel = dashboardRelative.split(path.sep)[0];
  if (
    isInside(dashboard, candidate) &&
    dashboardTopLevel.startsWith(".next") &&
    dashboardTopLevel !== ".next-desktop"
  ) {
    return `enters stale build output dashboard/${dashboardTopLevel}`;
  }
  const basename = path.basename(candidate);
  if (!inDependency && (basename === ".env" || basename.startsWith(".env."))) {
    return "contains a local environment file";
  }
  if (!inDependency && DATABASE_SUFFIX.test(basename)) {
    return "contains a mutable database file";
  }
  if (!inDependency && SECRET_SUFFIX.test(basename)) {
    return "contains a local key or certificate";
  }
  if (isInside(dashboard, candidate) && !inDependency && TEMPORARY_FILE.test(basename)) {
    return "contains dashboard temporary/build output";
  }

  const allowedRoots = [
    path.join(dashboard, ".next-desktop"),
    path.join(dashboard, "src"),
    path.join(dashboard, "node_modules"),
    path.join(dashboard, "public"),
    path.join(repoRoot, "node_modules"),
  ];
  const allowedFiles = new Set([path.join(dashboard, "package.json")]);
  if (
    allowedFiles.has(path.resolve(candidate)) ||
    allowedRoots.some((root) => isInside(root, candidate))
  ) {
    return null;
  }
  return "is outside the approved standalone program roots";
}

function displayPath(repoRoot, candidate) {
  const relative = path.relative(repoRoot, candidate);
  return relative && !relative.startsWith("..")
    ? relative.replaceAll(path.sep, "/")
    : path.resolve(candidate);
}

function unsafeTraceError(repoRoot, violations, violationCount, manifestCounts) {
  const displayed = violations.map(({ manifest, candidate, reason }) =>
    `Unsafe dashboard trace ${displayPath(repoRoot, candidate)} from ${displayPath(repoRoot, manifest)}: ${reason}`,
  );
  const affectedManifests = [...manifestCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const manifestSummary = affectedManifests.slice(0, 25).map(([manifest, count]) =>
    `- ${displayPath(repoRoot, manifest)}: ${count} unsafe trace${count === 1 ? "" : "s"}`,
  );
  const omitted = violationCount - displayed.length;
  const error = new Error(
    `Dashboard trace safety rejected ${violationCount} entr${violationCount === 1 ? "y" : "ies"} across ${affectedManifests.length} manifest${affectedManifests.length === 1 ? "" : "s"}.` +
      `${manifestSummary.length > 0 ? `\nMost affected manifests:\n${manifestSummary.join("\n")}` : ""}` +
      `${displayed.length > 0 ? `\nSamples:\n${displayed.join("\n")}` : ""}` +
      `${omitted > 0 ? `\n... ${omitted} additional unsafe dashboard traces omitted` : ""}`,
  );
  error.code = "BREADBOARD_UNSAFE_DASHBOARD_TRACE";
  error.violationCount = violationCount;
  Object.defineProperty(error, "violations", { value: violations });
  Object.defineProperty(error, "manifestCounts", { value: affectedManifests });
  return error;
}

/**
 * Fail closed before a standalone artifact is marked complete. Turbopack owns
 * its route NFT manifests and skips Next's JavaScript exclude post-pass; Next
 * 16 applies configured outputFileTracingExcludes natively while emitting the
 * manifests. Every remaining path is still checked independently here.
 * Nothing is silently filtered: an unsafe trace rejects the build and lets the
 * transactional build wrapper restore its last good output.
 */
export function assertSafeDashboardTraces(repoRoot) {
  const output = path.join(repoRoot, "dashboard", ".next-desktop");
  const manifests = traceManifests(output).sort();
  if (manifests.length === 0) {
    const error = new Error(`Dashboard build produced no NFT manifests under ${output}`);
    error.code = "BREADBOARD_MISSING_DASHBOARD_TRACES";
    throw error;
  }

  let tracedFiles = 0;
  const violations = [];
  let violationCount = 0;
  const manifestCounts = new Map();
  const lexicalReasons = new Map();
  const canonicalPaths = new Map();
  const recordViolation = (violation) => {
    violationCount += 1;
    manifestCounts.set(violation.manifest, (manifestCounts.get(violation.manifest) ?? 0) + 1);
    if (violations.length < 100) violations.push(violation);
  };
  for (const manifest of manifests) {
    let trace;
    try {
      trace = JSON.parse(fs.readFileSync(manifest, "utf8"));
    } catch (cause) {
      const error = new Error(`Dashboard trace manifest is unreadable: ${displayPath(repoRoot, manifest)}`, { cause });
      error.code = "BREADBOARD_INVALID_DASHBOARD_TRACE";
      throw error;
    }
    if (!trace || !Array.isArray(trace.files)) {
      const error = new Error(`Dashboard trace manifest has no files array: ${displayPath(repoRoot, manifest)}`);
      error.code = "BREADBOARD_INVALID_DASHBOARD_TRACE";
      throw error;
    }

    for (const entry of trace.files) {
      if (typeof entry !== "string" || entry.includes("\0") || path.isAbsolute(entry)) {
        recordViolation({
          manifest,
          candidate: String(entry),
          reason: "is not a valid relative NFT path",
        });
        continue;
      }
      tracedFiles += 1;
      const candidate = path.resolve(path.dirname(manifest), entry);
      let lexicalReason = lexicalReasons.get(candidate);
      if (lexicalReason === undefined) {
        lexicalReason = unsafeReason(repoRoot, candidate) ?? false;
        lexicalReasons.set(candidate, lexicalReason);
      }
      if (lexicalReason) {
        recordViolation({ manifest, candidate, reason: lexicalReason });
        continue;
      }

      let realCandidate = canonicalPaths.get(candidate);
      if (realCandidate === undefined) {
        realCandidate = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : false;
        canonicalPaths.set(candidate, realCandidate);
      }
      if (realCandidate) {
        let realReason = lexicalReasons.get(realCandidate);
        if (realReason === undefined) {
          realReason = unsafeReason(repoRoot, realCandidate) ?? false;
          lexicalReasons.set(realCandidate, realReason);
        }
        if (realReason) recordViolation({ manifest, candidate: realCandidate, reason: realReason });
      }
    }
  }
  if (violationCount > 0) {
    throw unsafeTraceError(repoRoot, violations, violationCount, manifestCounts);
  }
  return { manifests: manifests.length, tracedFiles };
}
