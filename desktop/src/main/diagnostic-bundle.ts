/**
 * Diagnostic bundle: one zip the person can attach to a bug report. It holds
 * the same redacted report the startup screen's "Copy diagnostics" produces,
 * the rotated logs (already redacted by the log manager) and recent native
 * crash dumps. Nothing is sent anywhere; the person picks where the file goes.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_LOG_BYTES = 50 * 1024 * 1024;
const MAX_CRASH_DUMP_BYTES = 200 * 1024 * 1024;
const MAX_CRASH_DUMP_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface DiagnosticBundleInput {
  destination: string;
  report: unknown;
  logsDir: string;
  crashDumpsDir: string;
}

export interface DiagnosticBundleResult {
  path: string;
  files: number;
}

export async function writeDiagnosticBundle(
  input: DiagnosticBundleInput,
): Promise<DiagnosticBundleResult> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-diagnostics-"));
  try {
    let files = 0;
    const add = (source: string, target: string) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      files += 1;
    };
    fs.writeFileSync(
      path.join(staging, "diagnostics.json"),
      JSON.stringify(input.report, null, 2),
    );
    files += 1;
    copyNewest(input.logsDir, path.join(staging, "logs"), MAX_LOG_BYTES, Infinity, add);
    copyNewest(
      input.crashDumpsDir,
      path.join(staging, "crash-dumps"),
      MAX_CRASH_DUMP_BYTES,
      MAX_CRASH_DUMP_AGE_MS,
      add,
    );
    await zipDirectory(staging, input.destination);
    return { path: input.destination, files };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Copies the newest files first until the byte budget is spent. */
function copyNewest(
  sourceDir: string,
  targetDir: string,
  budget: number,
  maxAgeMs: number,
  add: (source: string, target: string) => void,
): void {
  if (!fs.existsSync(sourceDir)) return;
  const now = Date.now();
  const entries = listFiles(sourceDir)
    .map((file) => ({ file, stat: fs.statSync(file) }))
    .filter(({ stat }) => now - stat.mtimeMs <= maxAgeMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  let used = 0;
  for (const { file, stat } of entries) {
    if (used + stat.size > budget) continue;
    used += stat.size;
    add(file, path.join(targetDir, path.relative(sourceDir, file)));
  }
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** Windows 10 1803+ ships bsdtar, which writes a zip when told to by the extension. */
function zipDirectory(dir: string, destination: string): Promise<void> {
  const tar =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe")
      : "tar";
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ["-a", "-c", "-f", destination, "-C", dir, "."], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${code}: ${stderr.trim()}`));
    });
  });
}
