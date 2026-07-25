// Runs electron-builder with the release output on a plain local disk.
//
// The repository may live inside a OneDrive-synced folder; OneDrive holds
// locks on freshly written files while uploading, which breaks
// electron-builder's clean/copy cycle. Output therefore defaults to
// %LOCALAPPDATA%/breadboard-desktop-build/release (override with
// BREADBOARD_DESKTOP_RELEASE_DIR).

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function releaseDir() {
  const configured = process.env.BREADBOARD_DESKTOP_RELEASE_DIR?.trim();
  if (configured) return path.resolve(configured);
  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".cache");
  return path.join(base, "breadboard-desktop-build", "release");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const output = releaseDir();
  console.log(`[dist-win] building installer into ${output}`);
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["electron-builder", "--win", "--x64", `-c.directories.output=${output}`],
    {
      cwd: desktopRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        // electron-builder treats "normal" and "maximum" identically for the
        // NSIS 7z payload (-mx=9). The bundled runtime is large enough that
        // this can exceed CI/tool timeouts and leave an invalid installer
        // stub. Level 1 keeps the installer compressed while making the
        // release build bounded and reproducible.
        ELECTRON_BUILDER_COMPRESSION_LEVEL:
          process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL?.trim() || "1",
      },
    },
  );
  process.exit(result.status ?? 1);
}
