import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
if (process.platform !== "win32") process.exit(0);

const target = path.join(desktopRoot, "resources", "bin", "runtime-supervisor.exe");
const manifest = path.join(repoRoot, "native", "runtime-supervisor", "Cargo.toml");
const lookup = spawnSync("where.exe", ["cargo.exe"], { encoding: "utf8", windowsHide: true });
const cargo = lookup.status === 0
  ? lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  : null;
if (!cargo) {
  if (fs.existsSync(target)) {
    console.warn("[runtime-supervisor] Cargo unavailable; retaining the previously verified binary.");
    process.exit(0);
  }
  console.error("[runtime-supervisor] Cargo is required to build the Windows Job Object helper.");
  process.exit(1);
}
const build = spawnSync(cargo, ["build", "--release", "--manifest-path", manifest], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
});
if (build.status !== 0) process.exit(build.status ?? 1);
const built = path.join(repoRoot, "native", "runtime-supervisor", "target", "release", "runtime-supervisor.exe");
if (!fs.existsSync(built)) throw new Error(`Cargo produced no helper at ${built}`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(built, target);
console.log(`[runtime-supervisor] staged ${target}`);
