import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  VOICEBOX_ARTIFACT_AUTHORITY,
  assertVoiceboxArtifactReceipt,
} from "./voicebox-artifact-receipt.mjs";
import { assertWindowsCommitHeadroom } from "./commit-preflight.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const sourceRoot = path.join(repoRoot, "voicebox");
const python = path.join(repoRoot, ".runtime", "voicebox-venv", "Scripts", "python.exe");
const provenanceRoot = path.join(repoRoot, ".runtime", "voicebox-build-provenance");
const builderWheelhouse = path.join(provenanceRoot, "wheelhouse-reviewed");
const cpuWheelhouse = path.join(provenanceRoot, "cpu-wheelhouse-reviewed");
const builderSite = path.join(provenanceRoot, "builder-site-reviewed");
const cpuOverlay = path.join(provenanceRoot, "cpu-overlay-reviewed");
const buildSource = path.join(provenanceRoot, "source-worktree");
const buildTemporary = path.join(provenanceRoot, "build-temporary");
const pyinstallerConfig = path.join(provenanceRoot, "pyinstaller-config");
const argumentsJson = path.join(provenanceRoot, "pyinstaller-arguments.json");
const argumentsBinary = path.join(provenanceRoot, "pyinstaller-arguments.bin");
const receiptTarget = path.join(
  desktopRoot,
  "runtime-v2",
  "vendor",
  "voicebox",
  "runtime-artifact.json",
);
const executableTarget = path.join(sourceRoot, "backend", "dist", "voicebox-server.exe");
const preflightOnly = process.argv.includes("--preflight");
const BUILD_COMMIT_ESTIMATE_MB = 8_192;
const BUILD_DISK_ESTIMATE_BYTES = 10 * 1024 ** 3;
const BUILD_DISK_RESERVE_BYTES = 8 * 1024 ** 3;
const disposableBuildPaths = Object.freeze([buildSource, buildTemporary, pyinstallerConfig]);
let activeBuildPid = null;

function fail(message) {
  throw new Error(message);
}

function directFile(candidate, label) {
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) fail(`${label} is not one direct file: ${candidate}`);
  return metadata;
}

function directDirectory(candidate, label) {
  const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} is not one direct directory: ${candidate}`);
  }
  return metadata;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    fail(`${path.basename(command)} exited with ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

async function sha256File(candidate) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(candidate);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex").toUpperCase();
}

async function fileReceipt(root, relativePath) {
  const candidate = path.join(root, ...relativePath.split("/"));
  const metadata = directFile(candidate, relativePath);
  return {
    path: relativePath,
    size: metadata.size,
    sha256: await sha256File(candidate),
  };
}

function exactArtifactInventory(authority, directory, label) {
  directDirectory(directory, label);
  const actualNames = fs.readdirSync(directory).sort();
  const expectedNames = authority.map(({ filename }) => filename).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail(`${label} inventory does not contain exactly the reviewed wheels`);
  }
  return Promise.all(
    authority.map(async (artifact) => {
      const candidate = path.join(directory, artifact.filename);
      const metadata = directFile(candidate, `${label} ${artifact.filename}`);
      const sha256 = await sha256File(candidate);
      if (metadata.size !== artifact.size || sha256 !== artifact.sha256) {
        fail(`${label} ${artifact.filename} does not match its reviewed size and SHA-256`);
      }
      return artifact.filename;
    }),
  );
}

function checkedSourceState() {
  directDirectory(sourceRoot, "Voicebox source checkout");
  const commit = run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]).trim();
  if (commit !== VOICEBOX_ARTIFACT_AUTHORITY.sourceCommit) {
    fail(`Voicebox source commit is ${commit}, not ${VOICEBOX_ARTIFACT_AUTHORITY.sourceCommit}`);
  }
  const status = run("git", [
    "-C",
    sourceRoot,
    "status",
    "--porcelain=v2",
    "--untracked-files=all",
  ]).trim();
  if (status) fail(`Voicebox source checkout is not clean:\n${status}`);
  return commit;
}

function checkedPythonIdentity(environment) {
  directFile(python, "Voicebox build Python");
  const probe = run(
    python,
    [
      "-c",
      [
        "import json, platform, PyInstaller, struct, torch, torchaudio, torchvision",
        "print(json.dumps({",
        "  'implementation': platform.python_implementation(),",
        "  'python': platform.python_version(),",
        "  'bits': struct.calcsize('P') * 8,",
        "  'pyinstaller': PyInstaller.__version__,",
        "  'torch': torch.__version__,",
        "  'torchCuda': torch.version.cuda,",
        "  'torchHip': torch.version.hip,",
        "  'torchaudio': torchaudio.__version__,",
        "  'torchvision': torchvision.__version__,",
        "  'torchFile': torch.__file__,",
        "  'pyinstallerFile': PyInstaller.__file__,",
        "}))",
      ].join("\n"),
    ],
    { env: environment },
  );
  const identity = JSON.parse(probe);
  const authority = VOICEBOX_ARTIFACT_AUTHORITY;
  if (
    identity.implementation !== authority.buildPython.implementation ||
    identity.python !== authority.buildPython.version ||
    identity.bits !== 64 ||
    identity.pyinstaller !== authority.pyinstaller.version ||
    identity.torch !== authority.cpuRuntimeArtifacts[0].version ||
    identity.torchaudio !== authority.cpuRuntimeArtifacts[1].version ||
    identity.torchvision !== authority.cpuRuntimeArtifacts[2].version ||
    identity.torchCuda !== null ||
    identity.torchHip !== null ||
    path.resolve(identity.torchFile).toLowerCase().indexOf(path.resolve(cpuOverlay).toLowerCase()) !== 0 ||
    path.resolve(identity.pyinstallerFile).toLowerCase().indexOf(path.resolve(builderSite).toLowerCase()) !== 0
  ) {
    fail(`Voicebox isolated build identity is not reviewed: ${JSON.stringify(identity)}`);
  }
  return identity;
}

function canonicalLf(bytes) {
  if (!bytes.includes(13)) return bytes;
  const normalized = Buffer.allocUnsafe(bytes.length);
  let written = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    normalized[written] = bytes[index];
    written += 1;
  }
  return normalized.subarray(0, written);
}

function sourceTreeReceipt() {
  const listed = spawnSync("git", ["-C", sourceRoot, "ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) fail("git ls-files failed for Voicebox");
  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  for (const relativePath of files) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      relativePath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      fail(`Voicebox tracked source path is unsafe: ${relativePath}`);
    }
    const candidate = path.join(sourceRoot, ...relativePath.split("/"));
    directFile(candidate, `Voicebox tracked source ${relativePath}`);
    digest.update(relativePath, "utf8");
    digest.update("\0", "utf8");
    digest.update(canonicalLf(fs.readFileSync(candidate)));
    digest.update("\0", "utf8");
  }
  return {
    format: VOICEBOX_ARTIFACT_AUTHORITY.sourceTreeFormat,
    fileCount: files.length,
    sha256: digest.digest("hex").toUpperCase(),
  };
}

function normalizedDistribution(value) {
  return value.toLowerCase().replace(/[-_.]+/gu, "-");
}

function runtimeDependencyInventory() {
  const environment = { ...process.env, PYTHONNOUSERSITE: "1" };
  delete environment.PYTHONPATH;
  const raw = run(
    python,
    ["-m", "pip", "freeze", "--all", "--disable-pip-version-check"],
    { env: environment },
  );
  const cpuVersions = new Map(
    VOICEBOX_ARTIFACT_AUTHORITY.cpuRuntimeArtifacts.map(({ distribution, version }) => [
      normalizedDistribution(distribution),
      `${distribution}==${version}`,
    ]),
  );
  const builderOnly = new Set(["altgraph", "pefile", "pyinstaller", "pyinstaller-hooks-contrib"]);
  const lines = [];
  for (const original of raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)) {
    const name = /^([A-Za-z0-9_.-]+)(?:==|\s+@\s+)/u.exec(original)?.[1];
    if (!name) fail(`Voicebox pip freeze emitted an unsupported line: ${original}`);
    const normalized = normalizedDistribution(name);
    if (builderOnly.has(normalized)) continue;
    if (cpuVersions.has(normalized)) {
      lines.push(cpuVersions.get(normalized));
      cpuVersions.delete(normalized);
      continue;
    }
    if (/\s+@\s+file:/iu.test(original)) {
      fail(`Voicebox runtime inventory contains a machine-local dependency: ${original}`);
    }
    lines.push(original);
  }
  if (cpuVersions.size > 0) {
    fail(`Voicebox runtime inventory is missing CPU overrides: ${[...cpuVersions.keys()].join(", ")}`);
  }
  lines.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const bytes = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const directVcs = [];
  for (const line of lines) {
    const match = /^([A-Za-z0-9_.-]+)\s+@\s+git\+(https:\/\/[^@\s]+)@([0-9a-f]{40})$/u.exec(line);
    if (!match) continue;
    const distribution = match[1];
    const installedVersion = run(
      python,
      ["-c", `import importlib.metadata as m; print(m.version(${JSON.stringify(distribution)}))`],
      { env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "" } },
    ).trim();
    directVcs.push({
      distribution,
      version: installedVersion,
      vcs: "git",
      url: match[2],
      commitId: match[3],
    });
  }
  directVcs.sort((left, right) => {
    const a = normalizedDistribution(left.distribution);
    const b = normalizedDistribution(right.distribution);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return {
    dependencyInventorySha256: sha256,
    dependencyInventory: {
      format: VOICEBOX_ARTIFACT_AUTHORITY.dependencyInventoryFormat,
      entryCount: lines.length,
      sha256,
    },
    directVcs,
  };
}

function isolatedBuildEnvironment() {
  return {
    ...process.env,
    PYTHONNOUSERSITE: "1",
    PYTHONPATH: `${builderSite}${path.delimiter}${cpuOverlay}`,
    PIP_NO_INDEX: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    UV_OFFLINE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    PYINSTALLER_CONFIG_DIR: pyinstallerConfig,
    TMP: buildTemporary,
    TEMP: buildTemporary,
    TMPDIR: buildTemporary,
  };
}

function ensureFreshBuildPaths() {
  for (const candidate of [
    buildSource,
    buildTemporary,
    pyinstallerConfig,
    argumentsJson,
    argumentsBinary,
    receiptTarget,
    executableTarget,
  ]) {
    if (fs.existsSync(candidate)) fail(`Voicebox disposable build path already exists: ${candidate}`);
  }
  fs.mkdirSync(buildTemporary, { recursive: false });
  fs.mkdirSync(pyinstallerConfig, { recursive: false });
}

function launchBuild(environment) {
  const buildScript = path.join(buildSource, "backend", "build_binary.py");
  const wrapper = [
    "import json, os, pathlib, runpy, sys",
    "import PyInstaller.__main__",
    `arguments_json = pathlib.Path(${JSON.stringify(argumentsJson)})`,
    `arguments_binary = pathlib.Path(${JSON.stringify(argumentsBinary)})`,
    "original_run = PyInstaller.__main__.run",
    "def audited_run(arguments):",
    "    exact = [str(argument) for argument in arguments]",
    "    arguments_json.write_text(json.dumps(exact, ensure_ascii=False), encoding='utf-8')",
    "    arguments_binary.write_bytes(b''.join(argument.encode('utf-8') + b'\\0' for argument in exact))",
    "    return original_run(arguments)",
    "PyInstaller.__main__.run = audited_run",
    `sys.argv = [${JSON.stringify(buildScript)}]`,
    `runpy.run_path(${JSON.stringify(buildScript)}, run_name='__main__')`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", wrapper], {
      cwd: path.join(buildSource, "backend"),
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    activeBuildPid = child.pid;
    child.once("error", reject);
    child.once("close", (code, signal) => {
      activeBuildPid = null;
      if (code === 0) resolve();
      else reject(new Error(`Voicebox PyInstaller build exited with ${code ?? signal ?? "unknown"}`));
    });
  });
}

function currentDiskAdmission() {
  const disk = fs.statfsSync(provenanceRoot);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const requiredBytes = BUILD_DISK_ESTIMATE_BYTES + BUILD_DISK_RESERVE_BYTES;
  if (!Number.isSafeInteger(freeBytes) || freeBytes < requiredBytes) {
    const error = new Error(
      `Voicebox CPU onefile build denied: ${freeBytes} bytes free cannot preserve ` +
        `${BUILD_DISK_RESERVE_BYTES} bytes of disk reserve plus the ` +
        `${BUILD_DISK_ESTIMATE_BYTES}-byte build estimate.`,
    );
    error.code = "BREADBOARD_RESOURCE_EXHAUSTED";
    throw error;
  }
  return {
    freeBytes,
    reserveBytes: BUILD_DISK_RESERVE_BYTES,
    estimateBytes: BUILD_DISK_ESTIMATE_BYTES,
  };
}

function forceStopProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return;
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot) fail("SYSTEMROOT is unavailable for bounded Voicebox process-tree cleanup");
  const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
  directFile(taskkill, "trusted Windows taskkill executable");
  spawnSync(taskkill, ["/PID", String(rootPid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
    timeout: 30_000,
  });
}

function recoveryMessage(reason) {
  return [
    `Voicebox build ${reason}.`,
    "Only these explicitly created disposable paths may be removed after inspecting the failure:",
    ...disposableBuildPaths.map((candidate) => `  ${candidate}`),
    "Retain the reviewed wheelhouses, builder site, CPU overlay, source checkout, Voicebox venv, model caches, and any final artifact/receipt.",
  ].join("\n");
}

async function dynamicPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!Number.isInteger(port) || port <= 0) fail("could not reserve one dynamic Voicebox smoke port");
  return port;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  const body = await response.json();
  return { status: response.status, body };
}

function processTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) fail("invalid Voicebox smoke root PID");
  const command = [
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name)",
    `$owned = New-Object 'System.Collections.Generic.HashSet[uint32]'`,
    `[void]$owned.Add([uint32]${rootPid})`,
    "$changed = $true",
    "while ($changed) {",
    "  $changed = $false",
    "  foreach ($process in $all) {",
    "    if ($owned.Contains([uint32]$process.ParentProcessId) -and $owned.Add([uint32]$process.ProcessId)) { $changed = $true }",
    "  }",
    "}",
    "$all | Where-Object { $owned.Contains([uint32]$_.ProcessId) } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]);
  if (!output.trim()) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function smokeArtifact(executable) {
  const port = await dynamicPort();
  const smokeData = path.join(provenanceRoot, `smoke-data-${process.pid}-${Date.now()}`);
  fs.mkdirSync(smokeData, { recursive: false });
  const child = spawn(
    executable,
    ["--host", "127.0.0.1", "--port", String(port), "--data-dir", smokeData],
    {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        VOICEBOX_BACKEND_VARIANT: "cpu",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  let exit = null;
  let ownedBeforeStop = [];
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  try {
    const deadline = Date.now() + 10 * 60_000;
    let health = null;
    while (Date.now() < deadline && health === null) {
      if (exit) fail(`Voicebox smoke process exited before readiness: ${JSON.stringify(exit)}`);
      try {
        const candidate = await fetchJson(`http://127.0.0.1:${port}/health`);
        if (candidate.status === 200) health = candidate;
      } catch {
        // Onefile extraction and Python/ML imports are expected to take time.
      }
      if (health === null) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (health === null) fail("Voicebox smoke process did not become healthy within ten minutes");
    const root = await fetchJson(`http://127.0.0.1:${port}/`);
    ownedBeforeStop = processTree(child.pid);
    await fetchJson(`http://127.0.0.1:${port}/shutdown`, { method: "POST" });
    await new Promise((resolve, reject) => {
      if (exit) return resolve();
      const timer = setTimeout(() => reject(new Error("Voicebox smoke process did not stop gracefully")), 30_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const remaining = ownedBeforeStop.filter(({ ProcessId }) => {
      try {
        process.kill(Number(ProcessId), 0);
        return true;
      } catch {
        return false;
      }
    });
    if (remaining.length > 0) {
      fail(`Voicebox smoke left owned processes after stop: ${JSON.stringify(remaining)}`);
    }
    if (
      health.status !== 200 ||
      health.body?.status !== "healthy" ||
      health.body?.backend_variant !== "cpu" ||
      health.body?.model_loaded !== false ||
      root.status !== 200 ||
      root.body?.version !== VOICEBOX_ARTIFACT_AUTHORITY.version
    ) {
      fail(`Voicebox smoke response is not reviewed: ${JSON.stringify({ health, root })}`);
    }
    return {
      dynamicPort: true,
      host: "127.0.0.1",
      healthPath: "/health",
      httpStatus: health.status,
      reportedStatus: health.body.status,
      backendVariant: health.body.backend_variant,
      modelLoaded: health.body.model_loaded,
      reportedVersion: root.body.version,
      isolatedDataDirectory: true,
      zeroDescendantsAfterStop: true,
    };
  } catch (error) {
    if (!exit) forceStopProcessTree(child.pid);
    for (const process of ownedBeforeStop) {
      const pid = Number(process.ProcessId);
      if (pid !== child.pid) forceStopProcessTree(pid);
    }
    throw error;
  }
}

function cleanupSuccessfulBuild() {
  const resolvedProvenance = fs.realpathSync(provenanceRoot);
  const resolvedBuildSource = fs.realpathSync(buildSource);
  const relative = path.relative(resolvedProvenance, resolvedBuildSource);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("Voicebox disposable worktree escaped its reviewed provenance root");
  }
  run("git", ["-C", sourceRoot, "worktree", "remove", "--force", buildSource]);
  for (const candidate of [buildTemporary, pyinstallerConfig]) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    const child = path.relative(resolvedProvenance, resolved);
    if (!child || child.startsWith("..") || path.isAbsolute(child)) {
      fail(`Voicebox disposable cleanup path escaped: ${candidate}`);
    }
    fs.rmSync(candidate, { recursive: true, force: false });
  }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("The reviewed Voicebox artifact build supports Windows x64 only");
  }
  const sourceCommit = checkedSourceState();
  await exactArtifactInventory(
    VOICEBOX_ARTIFACT_AUTHORITY.builderArtifacts,
    builderWheelhouse,
    "Voicebox builder wheelhouse",
  );
  await exactArtifactInventory(
    VOICEBOX_ARTIFACT_AUTHORITY.cpuRuntimeArtifacts,
    cpuWheelhouse,
    "Voicebox CPU wheelhouse",
  );
  directDirectory(builderSite, "Voicebox isolated builder site");
  directDirectory(cpuOverlay, "Voicebox isolated CPU overlay");
  const environment = isolatedBuildEnvironment();
  const pythonIdentity = checkedPythonIdentity(environment);
  const sourceTree = sourceTreeReceipt();
  const dependency = runtimeDependencyInventory();
  const buildRequirements = [await fileReceipt(sourceRoot, "backend/requirements.txt")];
  const buildScriptReceipt = await fileReceipt(sourceRoot, "backend/build_binary.py");
  const sourceSpecReceipt = await fileReceipt(sourceRoot, "backend/voicebox-server.spec");
  const resourceAdmission = assertWindowsCommitHeadroom({
    operation: "Voicebox CPU onefile build",
    estimateMb: BUILD_COMMIT_ESTIMATE_MB,
  });
  const diskAdmission = currentDiskAdmission();
  const preflight = {
    sourceCommit,
    sourceTree,
    pythonIdentity,
    dependencyInventory: dependency.dependencyInventory,
    directVcs: dependency.directVcs,
    buildRequirements,
    buildScript: buildScriptReceipt,
    sourceSpec: sourceSpecReceipt,
    resourceAdmission,
    diskAdmission,
    builderWheelCount: VOICEBOX_ARTIFACT_AUTHORITY.builderArtifacts.length,
    cpuWheelCount: VOICEBOX_ARTIFACT_AUTHORITY.cpuRuntimeArtifacts.length,
  };
  process.stdout.write(`${JSON.stringify({ preflight: "PASS", ...preflight }, null, 2)}\n`);
  if (preflightOnly) return;

  ensureFreshBuildPaths();
  run("git", [
    "-C",
    sourceRoot,
    "worktree",
    "add",
    "--detach",
    buildSource,
    VOICEBOX_ARTIFACT_AUTHORITY.sourceCommit,
  ]);
  await launchBuild(environment);

  const executable = path.join(buildSource, "backend", "dist", "voicebox-server.exe");
  const metadata = directFile(executable, "built Voicebox CPU onefile executable");
  const sha256 = await sha256File(executable);
  const generatedSpec = await fileReceipt(buildSource, "backend/voicebox-server.spec");
  const exactArguments = JSON.parse(fs.readFileSync(argumentsJson, "utf8"));
  const normalizedArguments = directFile(argumentsBinary, "Voicebox normalized PyInstaller arguments");
  if (!Array.isArray(exactArguments) || exactArguments.length < 1) {
    fail("Voicebox build did not record one bounded PyInstaller argument array");
  }
  const smoke = await smokeArtifact(executable);
  const receipt = {
    schemaVersion: VOICEBOX_ARTIFACT_AUTHORITY.schemaVersion,
    name: VOICEBOX_ARTIFACT_AUTHORITY.name,
    version: VOICEBOX_ARTIFACT_AUTHORITY.version,
    backendVersion: VOICEBOX_ARTIFACT_AUTHORITY.backendVersion,
    platform: VOICEBOX_ARTIFACT_AUTHORITY.platform,
    architecture: VOICEBOX_ARTIFACT_AUTHORITY.architecture,
    sourceCommit,
    executable: VOICEBOX_ARTIFACT_AUTHORITY.executable,
    size: metadata.size,
    sha256,
    sourceTree,
    buildPython: { ...VOICEBOX_ARTIFACT_AUTHORITY.buildPython },
    pyinstallerVersion: VOICEBOX_ARTIFACT_AUTHORITY.pyinstaller.version,
    builderArtifacts: VOICEBOX_ARTIFACT_AUTHORITY.builderArtifacts.map((artifact) => ({ ...artifact })),
    cpuRuntimeArtifacts: VOICEBOX_ARTIFACT_AUTHORITY.cpuRuntimeArtifacts.map((artifact) => ({ ...artifact })),
    dependencyInventorySha256: dependency.dependencyInventorySha256,
    dependencyInventory: dependency.dependencyInventory,
    directVcs: dependency.directVcs,
    build: {
      variant: "cpu",
      bundleMode: "onefile",
      entrypoint: "backend/server.py",
      arguments: [],
      requirements: buildRequirements,
      buildScript: buildScriptReceipt,
      sourceSpec: sourceSpecReceipt,
      generatedSpec,
      normalizedPyinstallerArguments: {
        format: VOICEBOX_ARTIFACT_AUTHORITY.normalizedArgumentsFormat,
        argumentCount: exactArguments.length,
        sha256: await sha256File(argumentsBinary),
      },
    },
    smoke,
  };
  if (normalizedArguments.size < exactArguments.length * 2) {
    fail("Voicebox normalized PyInstaller argument evidence is unexpectedly small");
  }
  assertVoiceboxArtifactReceipt(receipt);

  if (fs.existsSync(executableTarget)) fail(`Voicebox executable target already exists: ${executableTarget}`);
  fs.mkdirSync(path.dirname(executableTarget), { recursive: true });
  fs.renameSync(executable, executableTarget);
  if (
    directFile(executableTarget, "staged Voicebox executable").size !== receipt.size ||
    (await sha256File(executableTarget)) !== receipt.sha256
  ) {
    fail("Voicebox staged executable changed during the same-volume move");
  }
  fs.mkdirSync(path.dirname(receiptTarget), { recursive: true });
  const temporaryReceipt = `${receiptTarget}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  fs.renameSync(temporaryReceipt, receiptTarget);
  cleanupSuccessfulBuild();
  process.stdout.write(
    `${JSON.stringify({ artifact: executableTarget, receipt: receiptTarget, size: receipt.size, sha256: receipt.sha256, smoke }, null, 2)}\n`,
  );
}

main().catch((error) => {
  if (activeBuildPid !== null) forceStopProcessTree(activeBuildPid);
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${detail}\n${recoveryMessage("failed or was interrupted")}\n`);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.once(signal, () => {
    if (activeBuildPid !== null) forceStopProcessTree(activeBuildPid);
    process.stderr.write(`${recoveryMessage(`received ${signal}`)}\n`);
    process.exit(signal === "SIGINT" ? 130 : 1);
  });
}
