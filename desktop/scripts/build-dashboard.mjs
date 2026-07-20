// Runs the dashboard's desktop production build (Next standalone output into
// .next-desktop) with the right environment on any platform.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");

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
