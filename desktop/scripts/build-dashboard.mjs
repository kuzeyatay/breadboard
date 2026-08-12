// Runs the dashboard's desktop production build (Next standalone output into
// .next-desktop) with the right environment on any platform.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");

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

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: dashboardDir,
  stdio: "inherit",
  env: {
    ...process.env,
    BREADBOARD_DESKTOP_BUILD: "1",
    BREADBOARD_NEXT_DIST_DIR: ".next-desktop",
  },
});
process.exit(result.status ?? 1);
