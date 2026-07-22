// Assembles the self-contained runtimes shipped inside the Windows installer:
//
//   build-resources/runtimes/node/node.exe    — official Node runtime (copied
//       from the Node running this script; keeps native-module ABI identical
//       to the one dashboard/node_modules was installed for)
//   build-resources/runtimes/bun/bun.exe      — Bun runtime for OpenHarness
//   build-resources/runtimes/python/          — CPython embeddable distribution
//       matching the local Python's minor version, with ChatMock's pinned
//       dependencies installed into Lib/site-packages
//
// The script is deterministic for a given machine toolchain and fails loudly
// when a runtime cannot be produced — packaging must not silently drop one.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const runtimesDir = path.join(desktopRoot, "build-resources", "runtimes");

const CHATMOCK_PINNED_DEPS = [
  "blinker==1.9.0",
  "certifi==2025.8.3",
  "flask==3.1.1",
  "flask-sock==0.7.0",
  "idna==3.10",
  "itsdangerous==2.2.0",
  "jinja2==3.1.6",
  // ChatMock pins 3.0.2, which ships no cp314 wheel; 3.0.x is API-compatible
  // (jinja2 requires >=2.0) and matches what the dev environment resolves.
  "markupsafe>=3.0.2,<3.1",
  "requests==2.32.5",
  "urllib3==2.5.0",
  "websockets==15.0.1",
  "werkzeug==3.1.3",
];

function ensureChatMockImportPath(target) {
  const sitePackages = path.join(target, "Lib", "site-packages");
  const chatMockRoot = path.join(desktopRoot, "build-resources", "app-services", "chatmock");
  const relativeChatMockRoot = path.relative(sitePackages, chatMockRoot).split(path.sep).join("/");
  fs.mkdirSync(sitePackages, { recursive: true });
  fs.writeFileSync(
    path.join(sitePackages, "breadboard-chatmock.pth"),
    `${relativeChatMockRoot}\n`,
    "utf8",
  );
}

function log(message) {
  console.log(`[prepare-runtimes] ${message}`);
}

function fail(message) {
  console.error(`[prepare-runtimes] ERROR: ${message}`);
  process.exit(1);
}

function which(binary) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [binary], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  return first ? first.trim() : null;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.rmSync(destination, { force: true });
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    request.on("error", reject);
  });
}

async function prepareNode() {
  const target = path.join(runtimesDir, "node");
  fs.mkdirSync(target, { recursive: true });
  const nodeExe = process.execPath;
  fs.copyFileSync(nodeExe, path.join(target, path.basename(nodeExe)));
  log(`node ${process.version} copied from ${nodeExe}`);
  return { runtime: "node", version: process.version, source: nodeExe };
}

async function prepareBun() {
  const bunPath = which(process.platform === "win32" ? "bun.exe" : "bun") ?? which("bun");
  if (!bunPath) fail("Bun is not installed; install from https://bun.sh (OpenHarness requires it).");
  const version = execFileSync(bunPath, ["--version"], { encoding: "utf8" }).trim();
  const target = path.join(runtimesDir, "bun");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(bunPath, path.join(target, process.platform === "win32" ? "bun.exe" : "bun"));
  log(`bun ${version} copied from ${bunPath}`);
  return { runtime: "bun", version, source: bunPath };
}

function findPipCapablePython() {
  const candidates = [];
  const pyList = spawnSync("py", ["-0p"], { encoding: "utf8" });
  if (pyList.status === 0) {
    for (const line of pyList.stdout.split(/\r?\n/)) {
      const match = line.trim().match(/(\S+python\.exe)\s*\*?$/i);
      if (match) candidates.push(match[1]);
    }
  }
  const onPath = which("python.exe") ?? which("python");
  if (onPath) candidates.push(onPath);
  for (const candidate of candidates) {
    const pipProbe = spawnSync(candidate, ["-m", "pip", "--version"], { encoding: "utf8" });
    if (pipProbe.status === 0) return candidate;
  }
  return null;
}

async function preparePython() {
  if (process.platform !== "win32") fail("Python runtime assembly currently targets Windows x64 only.");
  const systemPython = findPipCapablePython();
  if (!systemPython) fail("A system Python (>=3.11) with pip is required to assemble the bundled runtime.");
  log(`using ${systemPython} to assemble the bundled Python`);
  const versionOut = execFileSync(systemPython, ["--version"], { encoding: "utf8" }).trim();
  const match = versionOut.match(/Python (\d+)\.(\d+)\.(\d+)/);
  if (!match) fail(`Could not parse Python version from "${versionOut}"`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (major !== 3 || minor < 11) fail(`Bundled Python must be >=3.11; found ${versionOut}`);
  const fullVersion = `${major}.${minor}.${patch}`;

  const target = path.join(runtimesDir, "python");
  const stampFile = path.join(target, ".breadboard-python-version");
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8").trim() === fullVersion) {
    ensureChatMockImportPath(target);
    log(`python ${fullVersion} runtime already assembled — skipping`);
    return { runtime: "python", version: fullVersion, source: "cached" };
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  const zipName = `python-${fullVersion}-embed-amd64.zip`;
  const url = `https://www.python.org/ftp/python/${fullVersion}/${zipName}`;
  const zipPath = path.join(os.tmpdir(), zipName);
  log(`downloading ${url}`);
  await download(url, zipPath);

  const unzip = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${target}" -Force`],
    { encoding: "utf8" },
  );
  if (unzip.status !== 0) fail(`Failed to extract ${zipPath}: ${unzip.stderr}`);

  // Enable site-packages in the embeddable distribution.
  const pthFile = fs
    .readdirSync(target)
    .find((name) => /^python\d+\._pth$/.test(name));
  if (!pthFile) fail("Could not find python*._pth in the embeddable distribution");
  const pthPath = path.join(target, pthFile);
  const pth = fs.readFileSync(pthPath, "utf8");
  fs.writeFileSync(
    pthPath,
    pth.replace(/^#\s*import site\s*$/m, "import site") + "\nLib\\site-packages\n",
    "utf8",
  );

  // Install ChatMock's pinned dependencies with the system pip targeting the
  // bundled runtime (same interpreter minor version => matching ABI wheels).
  const sitePackages = path.join(target, "Lib", "site-packages");
  fs.mkdirSync(sitePackages, { recursive: true });
  log("installing ChatMock dependencies into the bundled runtime");
  const pip = spawnSync(
    systemPython,
    [
      "-m",
      "pip",
      "install",
      "--no-warn-script-location",
      "--target",
      sitePackages,
      `--python-version`,
      `${major}.${minor}`,
      "--only-binary=:all:",
      "--implementation",
      "cp",
      ...CHATMOCK_PINNED_DEPS,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (pip.status !== 0) fail("pip install for the bundled Python runtime failed");

  fs.writeFileSync(stampFile, fullVersion, "utf8");
  ensureChatMockImportPath(target);
  log(`python ${fullVersion} runtime assembled`);
  return { runtime: "python", version: fullVersion, source: url };
}

const manifest = [];
manifest.push(await prepareNode());
manifest.push(await prepareBun());
manifest.push(await preparePython());
fs.writeFileSync(
  path.join(runtimesDir, "runtimes-manifest.json"),
  JSON.stringify({ assembledAt: new Date().toISOString(), runtimes: manifest }, null, 2),
);
log("done");
