import "server-only";

// Building the Windows capture/control helper, once.
//
// The helper is a single C# file compiled by the .NET Framework compiler that
// ships with Windows. Nothing has to be installed, no package feed is reached,
// and the result is cached under the data root keyed by the hash of its source,
// so it is built the first time a user teaches a workflow and never again until
// the source changes.
//
// The compiler is old enough to pin the source to C# 5; that constraint lives
// with the source file, not here.

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { repositoryRoot } from "../runtime-paths.ts";
import { ensureDirectory, helperCacheDirectory } from "./artifacts.ts";
import { teachLog } from "./redaction.ts";

const execFileAsync = promisify(execFile);

const COMPILE_TIMEOUT_MS = 120_000;

/** Assemblies csc does not reference by default. */
const GAC_REFERENCES = [
  ["UIAutomationClient", "31bf3856ad364e35"],
  ["UIAutomationTypes", "31bf3856ad364e35"],
  ["WindowsBase", "31bf3856ad364e35"],
] as const;

export class WindowsHelperUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "WindowsHelperUnavailable";
    this.reason = reason;
  }
}

export function helperSourcePath(): string {
  const configured = process.env.BREADBOARD_TEACH_HELPER_SOURCE?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  return path.join(repositoryRoot(), "dashboard", "scripts", "teach", "BreadboardTeach.cs");
}

function compilerPath(): string | null {
  const configured = process.env.BREADBOARD_TEACH_CSC_PATH?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const windows = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
  const candidates = [
    path.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function gacReferencePaths(): string[] {
  const windows = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
  const gac = path.join(windows, "Microsoft.Net", "assembly", "GAC_MSIL");
  const resolved: string[] = [];
  for (const [name, token] of GAC_REFERENCES) {
    const directory = path.join(gac, name, `v4.0_4.0.0.0__${token}`);
    const assembly = path.join(directory, `${name}.dll`);
    if (!fs.existsSync(assembly)) {
      throw new WindowsHelperUnavailable(
        `Windows is missing the ${name} assembly, which demonstration capture needs.`,
      );
    }
    resolved.push(assembly);
  }
  return resolved;
}

export interface HelperAvailability {
  available: boolean;
  reason?: string;
}

export function helperAvailability(): HelperAvailability {
  if (process.platform !== "win32") {
    return {
      available: false,
      reason: `Teaching by demonstration has no capture backend for ${process.platform} yet.`,
    };
  }
  if (!fs.existsSync(helperSourcePath())) {
    return { available: false, reason: "The demonstration helper source is missing from this install." };
  }
  if (!compilerPath()) {
    return {
      available: false,
      reason: "The .NET Framework compiler that builds the demonstration helper was not found.",
    };
  }
  try {
    gacReferencePaths();
  } catch (error) {
    return { available: false, reason: (error as Error).message };
  }
  return { available: true };
}

let buildInFlight: Promise<string> | null = null;

/**
 * The path to a built helper, building it if the cached one is missing or stale.
 *
 * Concurrent callers share one build: the teaching UI can start a session while
 * a replay is warming up, and two compilers writing the same output file is a
 * race that ends with a truncated executable.
 */
export async function ensureHelperBinary(): Promise<string> {
  const availability = helperAvailability();
  if (!availability.available) throw new WindowsHelperUnavailable(availability.reason ?? "unavailable");
  if (buildInFlight) return buildInFlight;
  buildInFlight = buildHelperBinary().finally(() => {
    buildInFlight = null;
  });
  return buildInFlight;
}

async function buildHelperBinary(): Promise<string> {
  const source = helperSourcePath();
  const contents = fs.readFileSync(source);
  const digest = crypto.createHash("sha256").update(contents).digest("hex").slice(0, 16);
  const cache = ensureDirectory(helperCacheDirectory());
  const output = path.join(cache, `BreadboardTeach-${digest}.exe`);

  if (fs.existsSync(output)) {
    const stats = fs.statSync(output);
    if (stats.isFile() && stats.size > 0) return output;
  }

  const compiler = compilerPath();
  if (!compiler) throw new WindowsHelperUnavailable("The .NET Framework compiler was not found.");

  // Build beside the target and move into place, so a crashed or concurrent
  // compile can never leave a half-written executable at the cached path.
  const staging = path.join(cache, `BreadboardTeach-${digest}-${process.pid}.tmp.exe`);
  const args = [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    `/out:${staging}`,
    ...gacReferencePaths().map((assembly) => `/reference:${assembly}`),
    source,
  ];

  try {
    await execFileAsync(compiler, args, {
      timeout: COMPILE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    fs.rmSync(staging, { force: true });
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const message = (detail.stdout || detail.stderr || detail.message || "").trim().slice(0, 800);
    throw new WindowsHelperUnavailable(
      `The demonstration helper could not be built.${message ? ` ${message}` : ""}`,
    );
  }

  if (!fs.existsSync(staging)) {
    throw new WindowsHelperUnavailable("The demonstration helper compiler produced no output.");
  }
  try {
    fs.renameSync(staging, output);
  } catch {
    // Another process won the race; its binary is the same bytes as ours.
    fs.rmSync(staging, { force: true });
    if (!fs.existsSync(output)) throw new WindowsHelperUnavailable("The demonstration helper could not be installed.");
  }

  // Old builds are dead weight once the source moves on.
  for (const entry of fs.readdirSync(cache)) {
    if (entry.startsWith("BreadboardTeach-") && entry.endsWith(".exe") && entry !== path.basename(output)) {
      fs.rmSync(path.join(cache, entry), { force: true });
    }
  }

  teachLog("helper", "built the Windows demonstration helper", { digest, bytes: fs.statSync(output).size });
  return output;
}

/** Environment for a helper child: no inherited secrets, only what Windows needs. */
export function helperChildEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
    ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
    ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
    ...(process.env.SystemDrive ? { SystemDrive: process.env.SystemDrive } : {}),
  };
}
