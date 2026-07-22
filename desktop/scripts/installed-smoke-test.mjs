import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("The installed smoke test requires Windows.");
  process.exit(2);
}

const installer = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!installer || !fs.existsSync(installer)) {
  console.error("Usage: node scripts/installed-smoke-test.mjs <Breadboard-Setup.exe> [evidence-dir]");
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "breadboard-desktop-smoke", runId);
const installDir = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Breadboard");
const installedExe = path.join(installDir, "Breadboard.exe");
const uninstaller = path.join(installDir, "Uninstall Breadboard.exe");
const isolatedUserData = path.join(evidenceDir, "user-data");
const appResults = path.join(evidenceDir, "app-smoke-results.json");
const appLog = path.join(evidenceDir, "app-smoke.log");
const summaryFile = path.join(evidenceDir, "installed-smoke-summary.json");
const records = [];
let failures = 0;

fs.mkdirSync(evidenceDir, { recursive: true });

function record(name, ok, detail = "") {
  records.push({ name, ok, detail, checkedAt: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''");
}

function powershell(command) {
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 120_000,
  });
}

function installProcesses() {
  const root = escapePowerShell(installDir);
  const result = powershell(
    `$root='${root}'; Get-CimInstance Win32_Process | ` +
      `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root) } | ` +
      `Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
  );
  try {
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function waitFor(predicate, timeoutMs, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(intervalMs);
  }
  return predicate();
}

async function closeInstalledProcesses() {
  const root = escapePowerShell(installDir);
  powershell(
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BreadboardWindow { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam); }'; ` +
      `$root='${root}'; Get-Process -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Path -and $_.Path.StartsWith($root) -and $_.MainWindowHandle -ne 0 } | ` +
      `ForEach-Object { [BreadboardWindow]::PostMessage($_.MainWindowHandle, 16, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }`,
  );
  const graceful = await waitFor(() => installProcesses().length === 0, 120_000, 2_000);
  if (graceful) return true;
  for (const entry of installProcesses()) {
    spawnSync("taskkill", ["/f", "/t", "/pid", String(entry.ProcessId)], { encoding: "utf8" });
  }
  await waitFor(() => installProcesses().length === 0, 30_000, 1_000);
  return false;
}

function runInstaller(targetDir) {
  return spawnSync(installer, ["/S", `/D=${targetDir}`], {
    encoding: "utf8",
    timeout: 20 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function installDirectoryIsCleared() {
  return !fs.existsSync(installDir) || fs.readdirSync(installDir).length === 0;
}

async function runUninstaller() {
  if (!fs.existsSync(uninstaller)) return { status: null, removed: false, stderr: "uninstaller missing" };
  const result = spawnSync(uninstaller, ["/S"], {
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const removed = await waitFor(
    () =>
      !fs.existsSync(installedExe) &&
      !fs.existsSync(uninstaller) &&
      installDirectoryIsCleared() &&
      installProcesses().length === 0,
    300_000,
    2_000,
  );
  if (removed) await delay(3_000);
  return { status: result.status, removed, stderr: result.stderr.trim() };
}

function authenticodeStatus(filePath) {
  const target = escapePowerShell(filePath);
  const result = powershell(
    `(Get-AuthenticodeSignature -LiteralPath '${target}') | Select-Object Status,StatusMessage,SignerCertificate | ConvertTo-Json -Compress -Depth 3`,
  );
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { Status: "Unknown", StatusMessage: result.stderr.trim() };
  }
}

function sha256(filePath) {
  const target = escapePowerShell(filePath);
  const result = powershell(`(Get-FileHash -Algorithm SHA256 -LiteralPath '${target}').Hash`);
  return result.stdout.trim().toLowerCase();
}

function persistSummary(exitCode) {
  const installerBytes = fs.statSync(installer).size;
  const installerSha256 = sha256(installer);
  const summary = {
    runId,
    startedFrom: process.cwd(),
    finishedAt: new Date().toISOString(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    installer: {
      path: installer,
      filename: path.basename(installer),
      type: "NSIS assisted per-user installer",
      architecture: "x64",
      bytes: installerBytes,
      sha256: installerSha256,
      packageVersion: packageJson.version,
      authenticode: authenticodeStatus(installer),
    },
    installDir,
    isolatedUserData,
    appResults,
    appLog,
    passed: records.length - failures,
    failed: failures,
    total: records.length,
    exitCode,
    checks: records,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`[installed-smoke] evidence: ${summaryFile}`);
}

const previouslyInstalled = fs.existsSync(installedExe);
const previouslyRunning = installProcesses().length > 0;
const existingDataDir = path.join(process.env.APPDATA ?? "", "breadboard-desktop");
const previousDataExisted = fs.existsSync(existingDataDir);
let testInstallPresent = false;

try {
  if (previouslyInstalled) {
    const graceful = await closeInstalledProcesses();
    record("existing installation stops before isolation setup", installProcesses().length === 0, graceful ? "graceful" : "forced fallback");
    const removedPrevious = await runUninstaller();
    record(
      "previous installation is removed before the clean install",
      removedPrevious.status === 0 && removedPrevious.removed,
      `exit ${removedPrevious.status}; ${removedPrevious.stderr}`,
    );
    if (!removedPrevious.removed) throw new Error("could not remove the previous installation");
  }

  const install = runInstaller(installDir);
  testInstallPresent = fs.existsSync(installedExe);
  record(
    "installer completes into the expected per-user location",
    install.status === 0 && testInstallPresent,
    `exit ${install.status}; ${installDir}`,
  );
  record("installed executable exists", fs.existsSync(installedExe), installedExe);
  record("installed uninstaller exists", fs.existsSync(uninstaller), uninstaller);
  if (!testInstallPresent) throw new Error(`installer did not create ${installedExe}`);

  const smoke = spawnSync(
    process.execPath,
    [path.join(scriptDir, "smoke-test.mjs"), installedExe, isolatedUserData, appResults],
    {
      cwd: evidenceDir,
      encoding: "utf8",
      timeout: 45 * 60_000,
      maxBuffer: 40 * 1024 * 1024,
      env: process.env,
    },
  );
  fs.writeFileSync(appLog, `${smoke.stdout}\n${smoke.stderr}`);
  process.stdout.write(smoke.stdout);
  process.stderr.write(smoke.stderr);
  record(
    "installed application smoke checks pass",
    smoke.status === 0,
    `exit ${smoke.status}; results ${appResults}`,
  );

  await closeInstalledProcesses();
  const uninstall = await runUninstaller();
  testInstallPresent = !uninstall.removed;
  record(
    "silent uninstall completes and removes the installed entry point",
    uninstall.status === 0 && uninstall.removed,
    `exit ${uninstall.status}; ${uninstall.stderr}`,
  );
  record(
    "uninstall preserves isolated user data by policy",
    fs.existsSync(path.join(isolatedUserData, "Data")),
    isolatedUserData,
  );
} catch (error) {
  record(
    "installed smoke orchestration completes without an uncaught error",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  if (testInstallPresent) {
    await closeInstalledProcesses();
    const cleanup = await runUninstaller();
    record("failed-run cleanup removes the test installation", cleanup.removed, `exit ${cleanup.status}`);
  }

  if (previouslyInstalled) {
    const restore = runInstaller(installDir);
    const restored = restore.status === 0 && fs.existsSync(installedExe);
    record("pre-existing Breadboard installation is restored", restored, `exit ${restore.status}; ${installDir}`);
    if (previousDataExisted) {
      record("pre-existing Breadboard user data remains present", fs.existsSync(existingDataDir), existingDataDir);
    }
    if (restored && previouslyRunning) {
      const appEnv = { ...process.env };
      delete appEnv.ELECTRON_RUN_AS_NODE;
      const child = spawn(installedExe, [], { detached: true, stdio: "ignore", env: appEnv });
      child.unref();
      record("previously running Breadboard is relaunched", child.pid !== undefined, `pid ${child.pid}`);
    }
  }
}

const exitCode = failures === 0 ? 0 : 1;
persistSummary(exitCode);
process.exit(exitCode);
