import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileWithLockRetry } from "./copy-file-with-retry.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
if (process.platform !== "win32") process.exit(0);

const stagedBinDir = path.join(desktopRoot, "resources", "bin");
const manifest = path.join(repoRoot, "native", "Cargo.toml");
const targetDir = path.join(repoRoot, "native", "target");
const lookup = spawnSync("where.exe", ["cargo.exe"], { encoding: "utf8", windowsHide: true });
const cargo = lookup.status === 0
  ? lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  : null;
if (!cargo) {
  console.error(
    "[native-runtime] Cargo is required; refusing to retain or package unverified stale runtime binaries.",
  );
  process.exit(1);
}
const build = spawnSync(cargo, [
  "build",
  "--release",
  "--locked",
  // Lean startup must use the already provisioned Cargo dependency cache.
  // This also prevents index refreshes from stalling an offline launch.
  ...(process.env.BREADBOARD_DESKTOP_DASHBOARD_MODE === "standalone" ? ["--offline"] : []),
  "--manifest-path",
  manifest,
  "--package",
  "breadboard-runtime-supervisor",
  "--package",
  "breadboard-runtime-cli",
  "--target-dir",
  targetDir,
], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
});
if (build.status !== 0) {
  if (process.env.BREADBOARD_DESKTOP_DASHBOARD_MODE === "standalone") {
    console.error(
      "[native-runtime] Lean builds use cached Rust dependencies. If Cargo reports a missing dependency, " +
      "run npm --prefix desktop run prepare:native-runtime once while online, then retry desktop:dev:lean.",
    );
  }
  process.exit(build.status ?? 1);
}
const artifacts = [
  {
    built: path.join(targetDir, "release", "runtime-supervisor.exe"),
    staged: path.join(stagedBinDir, "runtime-supervisor.exe"),
    label: "transitional containment helper",
  },
  {
    built: path.join(targetDir, "release", "breadboard-runtime.exe"),
    staged: path.join(stagedBinDir, "breadboard-runtime.exe"),
    label: "Runtime V2 authority",
  },
];
fs.mkdirSync(stagedBinDir, { recursive: true });
for (const artifact of artifacts) {
  if (!fs.existsSync(artifact.built)) {
    throw new Error(`Cargo produced no ${artifact.label} at ${artifact.built}`);
  }
  await copyFileWithLockRetry(artifact.built, artifact.staged, {
    onRetry: () => {
      console.warn(
        `[native-runtime] waiting for a previous Breadboard process to release ${artifact.staged}`,
      );
    },
  });
  console.log(`[native-runtime] staged ${artifact.label}: ${artifact.staged}`);
}
