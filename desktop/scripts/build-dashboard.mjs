// Runs the dashboard's desktop production build (Next standalone output into
// .next-desktop) with the right environment on any platform.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginDashboardBuild,
  completeDashboardBuild,
  recoverInterruptedDashboardBuild,
  refreshStandaloneDashboardAssets,
  writeDashboardBuildManifest,
} from "./dashboard-build-cache.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");
const traceGuard = path.join(repoRoot, "desktop", "scripts", "next-trace-guard.cjs");

// The vendored mem0 engine has to exist before the build, not after: file
// tracing can only follow `import("mem0ai/oss")` into the package if the clone
// is built, and an unbuilt one is traced as nothing at all — the packaged app
// would then ship without semantic recall and no build step would have failed.
// `--if-needed` is a no-op once it is there.
const mem0 = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "setup-mem0.mjs"), "--if-needed"],
  { cwd: repoRoot, stdio: "inherit" },
);
if (mem0.status !== 0) {
  console.warn(
    "[desktop] mem0 provisioning failed; the packaged app will fall back to lexical memory recall.",
  );
}

// GenOffice Docs is deliberately a static iframe bundle, outside Next's route
// graph, so opening a document cannot compile a new route and refresh the chat.
// Rebuild it before every desktop dashboard build instead of trusting a stale
// generated public directory from the checkout.
const genofficeEditor = spawnSync(
  process.execPath,
  [path.join(dashboardDir, "scripts", "build-genoffice-editor.mjs")],
  { cwd: dashboardDir, stdio: "inherit" },
);
if (genofficeEditor.status !== 0) process.exit(genofficeEditor.status ?? 1);

// The 518-route production graph needs more than V8's default ~4 GiB heap, but
// this allowance exists only for the one-time transactional build. The lean
// runtime keeps its independently bounded heap, and dev-fast's commit monitor
// still terminates this exact tree before it consumes the Windows reserve.
const dashboardBuildHeapMb = 8_192;
beginDashboardBuild(repoRoot);
const result = spawnSync(process.execPath, [
  `--max-old-space-size=${dashboardBuildHeapMb}`,
  "--require",
  traceGuard,
  nextBin,
  "build",
  "--webpack",
], {
  cwd: dashboardDir,
  stdio: "inherit",
  env: {
    ...process.env,
    BREADBOARD_DESKTOP_BUILD: "1",
    BREADBOARD_NEXT_DIST_DIR: ".next-desktop",
  },
});
if (result.status !== 0) {
  recoverInterruptedDashboardBuild(repoRoot);
  process.exit(result.status ?? 1);
}

// Next intentionally leaves static/public assets beside standalone output.
// Complete the runnable tree here so every caller (lean dev, QA, packaging)
// gets the same production-like artifact rather than each copying a subset.
try {
  refreshStandaloneDashboardAssets(repoRoot);
  writeDashboardBuildManifest(repoRoot);
  completeDashboardBuild(repoRoot);
} catch (error) {
  recoverInterruptedDashboardBuild(repoRoot);
  throw error;
}
