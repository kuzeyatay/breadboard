// Fails when the assembled build-resources (and, when present, the packaged
// win-unpacked output) are missing required binaries or contain data/secrets
// that must never ship. Run before and after electron-builder.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const node = path.join(resources, "runtimes", "node", "node.exe");
  const python = path.join(resources, "runtimes", "python", "python.exe");
  const dashboard = path.join(resources, "app-services", "dashboard-standalone", "dashboard");
  requireFile(node, `${label} bundled Node`);
  requireFile(path.join(resources, "runtimes", "bun", "bun.exe"), `${label} bundled Bun`);
  requireFile(python, `${label} bundled Python`);
  requireFile(
    path.join(resources, "runtimes", "python", "Lib", "site-packages", "flask", "__init__.py"),
    `${label} ChatMock Python dependencies`,
  );
  requireFile(
    path.join(dashboard, "server.js"),
    `${label} dashboard standalone server`,
  );
  requireFile(
    path.join(
      dashboard,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "dist",
      "esm",
      "client",
      "index.js",
    ),
    `${label} dashboard MCP proxy SDK`,
  );
  if (fs.existsSync(node) && fs.existsSync(dashboard)) {
    const mcpSdkImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        [
          "await import('@modelcontextprotocol/sdk/client/index.js')",
          "await import('@modelcontextprotocol/sdk/client/stdio.js')",
          "await import('@modelcontextprotocol/sdk/client/streamableHttp.js')",
        ].join(";"),
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (mcpSdkImport.status !== 0) {
      const output = `${mcpSdkImport.stderr ?? ""}\n${mcpSdkImport.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot load MCP proxy runtime: ${output || "unknown error"}`);
    }

    const pdfParseImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        "const value = await import('pdf-parse'); if (typeof value.PDFParse !== 'function') process.exit(2)",
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (pdfParseImport.status !== 0) {
      const output = `${pdfParseImport.stderr ?? ""}\n${pdfParseImport.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot load PDF ingestion runtime: ${output || "unknown error"}`);
    }
  }
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
    path.join(resources, "app-services", "chatmock", "chatmock", "cli.py"),
    `${label} ChatMock package`,
  );
  if (fs.existsSync(python)) {
    const chatMockImport = spawnSync(python, ["-c", "import chatmock; import chatmock.cli"], {
      cwd: path.join(resources, "app-services", "chatmock"),
      encoding: "utf8",
      windowsHide: true,
    });
    if (chatMockImport.status !== 0) {
      const output = `${chatMockImport.stderr ?? ""}\n${chatMockImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import ChatMock: ${output || "unknown error"}`);
    }
  }
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
    path.join(resources, "runtimes", "python", "hermes-upstream-commit.txt"),
    `${label} Hermes runtime pin`,
  );
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "hermes_cli", "main.py"),
    `${label} Hermes entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    `${label} Breadboard Hermes plugin manifest`,
  );
  requireFile(
    path.join(resources, "app-services", "hermes-agent", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} staged Hermes commit pin`,
  );
  if (fs.existsSync(python)) {
    const hermesImport = spawnSync(
      python,
      ["-c", "import hermes_cli.main; import plugins.breadboard; import tui_gateway.server"],
      {
        cwd: path.join(resources, "app-services", "hermes-agent"),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (hermesImport.status !== 0) {
      const output = `${hermesImport.stderr ?? ""}\n${hermesImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import Hermes: ${output || "unknown error"}`);
    }
  }
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

if (fs.existsSync(localBase)) {
  for (const name of fs.readdirSync(localBase)) {
    if (!/^Breadboard-Setup-.*-x64\.exe$/.test(name)) continue;
    const installer = path.join(localBase, name);
    if (fs.statSync(installer).size < 10 * 1024 * 1024) {
      problems.push(`incomplete NSIS installer (under 10 MB): ${installer}`);
    }
  }
}

if (problems.length > 0) {
  console.error("[verify-package] FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("[verify-package] OK");
