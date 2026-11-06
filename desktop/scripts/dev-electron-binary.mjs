// A Breadboard-branded copy of the Electron binary for development launches.
//
// Windows Task Manager names an app by its executable's FileDescription and
// draws its icon, so dev runs of node_modules/electron/dist/electron.exe show
// up as "Electron". The packaged build gets Breadboard.exe from
// electron-builder; this gives dev runs the same identity. Every other file of
// the Electron distribution is hard-linked, so the copy costs one executable.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const STAMP_FORMAT = 1;
export const BRANDED_EXECUTABLE = "Breadboard.exe";

function stampFor(electronBinary, iconPath) {
  const exe = fs.statSync(electronBinary);
  const icon = fs.statSync(iconPath);
  const version = fs.readFileSync(path.join(path.dirname(electronBinary), "version"), "utf8").trim();
  return JSON.stringify({ format: STAMP_FORMAT, version, size: exe.size, mtime: exe.mtimeMs, icon: icon.mtimeMs });
}

function linkTree(source, target, skip) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === skip) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) linkTree(from, to, null);
    else {
      try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
    }
  }
}

/**
 * Path to the branded executable, built on first use and whenever Electron or
 * the icon changes. Anything that goes wrong returns the stock binary: the
 * name in Task Manager is not worth a failed launch.
 */
export async function devElectronBinary(electronBinary, {
  desktopRoot,
  platform = process.platform,
  log = (line) => process.stderr.write(`${line}\n`),
  editResources = editWithRcedit,
} = {}) {
  if (platform !== "win32") return electronBinary;
  const root = path.join(desktopRoot, ".dev-electron");
  const current = path.join(root, "current");
  const branded = path.join(current, BRANDED_EXECUTABLE);
  const iconPath = path.join(desktopRoot, "assets", "icon.ico");
  // Leftovers of an interrupted build; one still in use simply stays.
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (/^(staging|retired)-\d+$/.test(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true, maxRetries: 0 });
  }
  try {
    const stamp = stampFor(electronBinary, iconPath);
    const stampFile = path.join(current, "breadboard-stamp.json");
    if (fs.existsSync(branded) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return branded;
    // Build beside the live copy: a running dev app holds Breadboard.exe open.
    const staging = path.join(root, `staging-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    linkTree(path.dirname(electronBinary), staging, path.basename(electronBinary));
    const stagedExe = path.join(staging, BRANDED_EXECUTABLE);
    fs.copyFileSync(electronBinary, stagedExe);
    await editResources(stagedExe, iconPath);
    fs.writeFileSync(path.join(staging, "breadboard-stamp.json"), stamp);
    // Rename the old copy aside rather than deleting into it: a running
    // instance has its files open, so the rename fails whole and nothing it
    // uses goes missing. Its hard links still hold a consistent older Electron.
    const retired = path.join(root, `retired-${process.pid}`);
    try {
      if (fs.existsSync(current)) fs.renameSync(current, retired);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (!fs.existsSync(branded)) throw error;
      log(`[desktop] kept the existing ${BRANDED_EXECUTABLE}; a running instance holds it (${error.code ?? error.message})`);
      return branded;
    }
    fs.renameSync(staging, current);
    fs.rmSync(retired, { recursive: true, force: true });
    return branded;
  } catch (error) {
    log(`[desktop] using the stock Electron binary; could not prepare ${BRANDED_EXECUTABLE}: ${error.message}`);
    return electronBinary;
  }
}

async function editWithRcedit(exe, iconPath) {
  // electron-builder's own resource editor (the one that brands the packaged
  // Breadboard.exe); it fetches its tool bundle on first use on any machine.
  const require = createRequire(import.meta.url);
  const { executeAppBuilder } = require("builder-util");
  await executeAppBuilder(["rcedit", "--args", JSON.stringify([
    exe,
    "--set-version-string", "FileDescription", "Breadboard",
    "--set-version-string", "ProductName", "Breadboard",
    "--set-version-string", "InternalName", "Breadboard",
    "--set-version-string", "OriginalFilename", BRANDED_EXECUTABLE,
    "--set-icon", iconPath,
  ])], undefined, {}, 2);
}
