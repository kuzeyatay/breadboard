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

function checkTranscriptionRuntime(binDir, label) {
  for (const executable of ["scriberr.exe", "ffmpeg.exe", "ffprobe.exe", "yt-dlp.exe", "uv.exe"]) {
    requireFile(path.join(binDir, executable), `${label} ${executable}`);
  }
  requireFile(
    path.join(binDir, "transcription-runtime.json"),
    `${label} pinned runtime manifest`,
  );
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
    path.join(resources, "bin", "codex.exe"),
    `${label} Codex coding-agent binary`,
  );
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
  requireFile(
    path.join(dashboard, "node_modules", "pdfkit", "js", "pdfkit.js"),
    `${label} dashboard PDFKit runtime`,
  );
  requireFile(
    path.join(dashboard, "node_modules", "pdfkit", "js", "data", "Helvetica.afm"),
    `${label} dashboard PDFKit Helvetica font metrics`,
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

    const pdfKitRender = spawnSync(
      node,
      [
        "-e",
        [
          "const PDFDocument = require('pdfkit')",
          "const { PassThrough } = require('node:stream')",
          "const sink = new PassThrough(); sink.resume()",
          "const doc = new PDFDocument({ size: 'A4' }); doc.pipe(sink)",
          "doc.font('Helvetica').fontSize(11).text('Breadboard PDF runtime check.'); doc.end()",
        ].join(";"),
      ],
      { cwd: dashboard, encoding: "utf8", windowsHide: true },
    );
    if (pdfKitRender.status !== 0) {
      const output = `${pdfKitRender.stderr ?? ""}\n${pdfKitRender.stdout ?? ""}`.trim();
      problems.push(`${label} dashboard cannot render PDFs: ${output || "unknown error"}`);
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
    path.join(resources, "app-services", "agency-agents", "divisions.json"),
    `${label} Agency Agents division catalog`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "agency-agents",
      "engineering",
      "engineering-backend-architect.md",
    ),
    `${label} Agency Agents persona files`,
  );
  requireFile(
    path.join(resources, "app-services", "agency-agents", "LICENSE"),
    `${label} Agency Agents license`,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "start-postiz-supervisor.mjs"),
    `${label} Postiz supervisor entrypoint`,
  );
  requireFile(
    path.join(resources, "app-services", "scripts", "ifixai-background-runner.py"),
    `${label} iFixAi background bridge`,
  );
  requireFile(
    path.join(resources, "app-services", "ifixai", "LICENSE"),
    `${label} iFixAi upstream license`,
  );
  requireFile(
    path.join(resources, "app-services", "ifixai", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} staged iFixAi commit pin`,
  );
  requireFile(
    path.join(resources, "runtimes", "python", "ifixai-upstream-commit.txt"),
    `${label} bundled iFixAi commit pin`,
  );
  requireFile(
    path.join(resources, "runtimes", "python", "Lib", "site-packages", "ifixai", "__init__.py"),
    `${label} bundled iFixAi package`,
  );
  if (fs.existsSync(python)) {
    const ifixAiImport = spawnSync(
      python,
      ["-c", "import ifixai; from ifixai.api import run_selected; print(ifixai.__version__)"],
      { encoding: "utf8", windowsHide: true },
    );
    if (ifixAiImport.status !== 0) {
      const output = `${ifixAiImport.stderr ?? ""}\n${ifixAiImport.stdout ?? ""}`.trim();
      problems.push(`${label} bundled Python cannot import iFixAi: ${output || "unknown error"}`);
    }
  }
  requireFile(
    path.join(resources, "app-services", "postiz-app", "docker-compose.yaml"),
    `${label} Postiz Compose definition`,
  );
  for (const moduleName of ["api-client.ts", "bootstrap.ts", "config.ts", "docker.ts", "stack.ts"]) {
    requireFile(
      path.join(resources, "app-services", "dashboard", "src", "lib", "socials-manager", moduleName),
      `${label} Postiz supervisor module ${moduleName}`,
    );
  }
  requireFile(
    path.join(resources, "app-services", "dashboard", "src", "lib", "runtime-paths.ts"),
    `${label} Postiz supervisor runtime paths module`,
  );
  requireFile(
    path.join(resources, "app-services", "postiz-app", "dynamicconfig", "development-sql.yaml"),
    `${label} Postiz Temporal dynamic configuration`,
  );
  const uiTarsAdapter = path.join(resources, "app-services", "ui-tars-adapter");
  requireFile(
    path.join(uiTarsAdapter, "src", "server.ts"),
    `${label} Agent TARS adapter entrypoint`,
  );
  requireFile(
    path.join(uiTarsAdapter, "node_modules", "@ui-tars", "sdk", "package.json"),
    `${label} Agent TARS desktop SDK`,
  );
  requireFile(
    path.join(
      uiTarsAdapter,
      "node_modules",
      "@computer-use",
      "libnut-win32",
      "build",
      "Release",
      "libnut.node",
    ),
    `${label} Agent TARS Windows desktop native module`,
  );
  if (fs.existsSync(node) && fs.existsSync(uiTarsAdapter)) {
    const desktopOperatorImport = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        "const [{GUIAgent},{NutJSOperator}] = await Promise.all([import('@ui-tars/sdk'), import('@ui-tars/operator-nut-js')]); if (typeof GUIAgent !== 'function' || typeof NutJSOperator !== 'function') process.exit(2)",
      ],
      { cwd: uiTarsAdapter, encoding: "utf8", windowsHide: true },
    );
    if (desktopOperatorImport.status !== 0) {
      const output = `${desktopOperatorImport.stderr ?? ""}\n${desktopOperatorImport.stdout ?? ""}`.trim();
      problems.push(`${label} cannot load the Agent TARS desktop runtime: ${output || "unknown error"}`);
    }
  }
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
    path.join(resources, "app-services", "hermes-config", "system", "main-assistant.md"),
    `${label} Hermes system prompt`,
  );
    requireFile(
      path.join(
        resources,
        "app-services",
        "nango",
        "packages",
        "providers",
        "providers.yaml",
      ),
      `${label} connected-app provider catalog`,
    );
  requireFile(
    path.join(resources, "app-services", "scientific-agent-skills", "skills", "scientific-writing", "SKILL.md"),
    `${label} scientific skills catalog`,
  );
  requireFile(
    path.join(resources, "app-services", "scientific-agent-skills", "BREADBOARD_UPSTREAM_COMMIT"),
    `${label} scientific skills commit pin`,
  );
  requireFile(
    path.join(
      resources,
      "app-services",
      "hermes-skills",
      "prebuilt",
      "interactive-visualizer",
      "SKILL.md",
    ),
    `${label} first-party interactive visualizer skill`,
  );
  requireFile(
    path.join(dashboard, "node_modules", "three", "build", "three.module.js"),
    `${label} pinned local Three.js runtime`,
  );
  requireFile(
    path.join(
      dashboard,
      "node_modules",
      "@esbuild",
      "win32-x64",
      "esbuild.exe",
    ),
    `${label} deterministic visualizer bundler`,
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
  // The WhatsApp bridge is spawned by the dashboard, and the bundled Node runtime
  // has no npm, so its dependencies must already be installed in the package.
  const whatsAppBridge = path.join(
    resources,
    "app-services",
    "hermes-agent",
    "scripts",
    "whatsapp-bridge",
  );
  requireFile(path.join(whatsAppBridge, "bridge.js"), `${label} WhatsApp bridge`);
  requireFile(
    path.join(whatsAppBridge, "node_modules", "@whiskeysockets", "baileys", "package.json"),
    `${label} WhatsApp bridge dependencies`,
  );
  const breadboardPluginRoot = path.join(
    resources,
    "app-services",
    "hermes-agent",
    "plugins",
    "breadboard",
  );
  const breadboardPluginSource = path.join(breadboardPluginRoot, "__init__.py");
  const breadboardPluginManifest = path.join(breadboardPluginRoot, "plugin.yaml");
  requireFile(breadboardPluginSource, `${label} Breadboard Hermes plugin source`);
  if (fs.existsSync(breadboardPluginSource) && fs.existsSync(breadboardPluginManifest)) {
    const source = fs.readFileSync(breadboardPluginSource, "utf8");
    const manifest = fs.readFileSync(breadboardPluginManifest, "utf8");
    for (const tool of [
      "interactive_visualizer_plan",
      "interactive_visualizer_generate",
      "interactive_visualizer_revise",
      "interactive_visualizer_rollback",
      "interactive_visualizer_cancel",
    ]) {
      if (!source.includes(`"${tool}"`)) {
        problems.push(`${label} Breadboard Hermes plugin source is missing ${tool}`);
      }
      if (!manifest.includes(`- ${tool}`)) {
        problems.push(`${label} Breadboard Hermes plugin manifest is missing ${tool}`);
      }
    }
  }
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
checkTranscriptionRuntime(
  path.join(desktopRoot, "resources", "bin"),
  "desktop native transcription runtime",
);

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
  checkTranscriptionRuntime(
    path.join(winUnpacked, "resources", "bin"),
    "packaged native transcription runtime",
  );
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
