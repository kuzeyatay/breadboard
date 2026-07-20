// Fails when the assembled build-resources (and, when present, the packaged
// win-unpacked output) are missing required binaries or contain data/secrets
// that must never ship. Run before and after electron-builder.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) problems.push(`missing ${label}: ${filePath}`);
}

function forbidMatches(root, matcher, label) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (matcher(entry.name)) problems.push(`${label}: ${full}`);
    }
  }
}

function checkResourcesRoot(resources, label) {
  requireFile(path.join(resources, "runtimes", "node", "node.exe"), `${label} bundled Node`);
  requireFile(path.join(resources, "runtimes", "bun", "bun.exe"), `${label} bundled Bun`);
  requireFile(path.join(resources, "runtimes", "python", "python.exe"), `${label} bundled Python`);
  requireFile(
    path.join(resources, "runtimes", "python", "Lib", "site-packages", "flask", "__init__.py"),
    `${label} ChatMock Python dependencies`,
  );
  requireFile(
    path.join(resources, "app-services", "dashboard-standalone", "dashboard", "server.js"),
    `${label} dashboard standalone server`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "dashboard-standalone",
      "dashboard",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
    `${label} better-sqlite3 native binary`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "dashboard-standalone",
      "dashboard",
      "node_modules",
      "bcrypt",
      "prebuilds",
      "win32-x64",
      "bcrypt.node",
    ),
    `${label} bcrypt native binary`,
  );
  requireFile(
    path.join(resources, "app-services", "chatmock", "chatmock.py"),
    `${label} ChatMock entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "openharness", "packages", "opencode", "src", "index.ts"),
    `${label} OpenHarness entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "openharness", "bun.lock"),
    `${label} OpenHarness lockfile`,
  );
  const bunCache = path.join(resources, "bun-cache");
  const cachePopulated =
    fs.existsSync(bunCache) &&
    fs.readdirSync(bunCache).some((name) => name.startsWith("hono@"));
  if (!cachePopulated) problems.push(`missing ${label} bundled bun package cache: ${bunCache}`);
  requireFile(
    path.join(resources, "app-services", "openharness-config", "opencode.json"),
    `${label} OpenHarness config`,
  );
  requireFile(
    path.join(resources, "app-services", "quartz-template", "quartz", "bootstrap-cli.mjs"),
    `${label} Quartz CLI`,
  );
  requireFile(
    path.join(resources, "app-services", "quartz-template", "node_modules", "preact", "package.json"),
    `${label} Quartz node_modules`,
  );
  forbidMatches(
    path.join(resources, "app-services"),
    (name) => /\.(db|db-shm|db-wal)$/.test(name),
    `${label} forbidden database file staged`,
  );
  forbidMatches(
    path.join(resources, "app-services"),
    (name) => /^\.env($|\.(?!example))/.test(name),
    `${label} forbidden env file staged`,
  );
}

checkResourcesRoot(path.join(desktopRoot, "build-resources"), "build-resources");

const localBase =
  process.env.BREADBOARD_DESKTOP_RELEASE_DIR?.trim() ||
  (process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "breadboard-desktop-build", "release")
    : path.join(desktopRoot, "release"));
const winUnpacked = fs.existsSync(path.join(localBase, "win-unpacked"))
  ? path.join(localBase, "win-unpacked")
  : path.join(desktopRoot, "release", "win-unpacked");
if (fs.existsSync(winUnpacked)) {
  requireFile(path.join(winUnpacked, "Breadboard.exe"), "packaged executable");
  checkResourcesRoot(path.join(winUnpacked, "resources"), "win-unpacked");
  requireFile(path.join(winUnpacked, "resources", "app.asar"), "packaged app.asar");
} else {
  console.log("[verify-package] release/win-unpacked not present; checked build-resources only");
}

if (problems.length > 0) {
  console.error("[verify-package] FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("[verify-package] OK");
