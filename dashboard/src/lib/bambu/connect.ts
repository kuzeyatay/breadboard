import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { fail } from "./types.ts";
import { inspectSlicedFile, MAX_FILE_BYTES } from "./inspection.ts";
import { externalRuntimeFilesystem } from "../external-runtime-filesystem.ts";
import { externalRuntimePath } from "../external-runtime-path.ts";

// Bambu's published third-party interface accepts only a file, name and version.
// It does NOT accept a printer, AMS mapping, automatic start, or a status callback.
// https://wiki.bambulab.com/en/software/bambu-connect
// https://github.com/OrcaSlicer/OrcaSlicer/pull/8103/commits/375839610c2c86579888e7810afa0cd8a1976b15
export const BAMBU_CONNECT_HELP = "https://wiki.bambulab.com/en/software/bambu-connect";
export interface BambuConnectStatus {
  available: boolean;
  platformSupported: boolean;
  requiresNativeConfirmation: true;
  canStartUnattended: false;
  canSetAmsMapping: false;
  canObservePrint: false;
  message: string;
  setupUrl: string;
}
type Registration = { platform: "win32"; executable: string } | { platform: "darwin"; application: string };
type Execute = (executable: string, args: string[], options: { timeout: number; windowsHide: boolean; maxBuffer: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string }>;
const execute: Execute = promisify(execFile);
const options = { timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 };
const windowsTool = (file: string, env = process.env) => path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", file);

/** Read only the registered protocol executable, never Studio credentials. */
export function registeredConnectExecutable(output: string): string | null {
  const command = /^\s*\([^\r\n]*\)\s+REG_SZ\s+([^\r\n]+)$/m.exec(output)?.[1]?.trim();
  const executable = command?.startsWith('"') ? /^"([^"\r\n]+\.exe)"(?:\s|$)/i.exec(command)?.[1] : /^(\S+\.exe)(?:\s|$)/i.exec(command ?? "")?.[1];
  return executable && path.win32.isAbsolute(executable) && !executable.startsWith("\\\\") && /^bambu[ _-]?connect\.exe$/i.test(path.win32.basename(executable)) ? executable : null;
}
export async function findBambuConnect(platform: NodeJS.Platform = process.platform, env = process.env, home = os.homedir(), run: Execute = execute): Promise<Registration | null> {
  if (platform === "win32") {
    try {
      const result = await run(windowsTool("reg.exe", env), ["query", "HKCR\\bambu-connect\\shell\\open\\command", "/ve"], options);
      const executable = registeredConnectExecutable(result.stdout);
      if (executable && (await externalRuntimeFilesystem.promises.stat(executable)).isFile()) return { platform: "win32", executable };
    } catch { /* Not installed, registration is missing, or access was denied. */ }
  } else if (platform === "darwin") {
    for (const root of ["/Applications", externalRuntimePath.join(home, "Applications")]) {
      for (const name of ["Bambu Connect.app", "BambuConnect.app", "bambu-connect.app"]) {
        const application = externalRuntimePath.join(root, name);
        try { if ((await externalRuntimeFilesystem.promises.stat(externalRuntimePath.join(application, "Contents/Info.plist"))).isFile()) return { platform: "darwin", application }; } catch { /* Try the next app. */ }
      }
    }
  }
  return null;
}
export async function inspectBambuConnect(find = findBambuConnect, platform: NodeJS.Platform = process.platform): Promise<BambuConnectStatus> {
  const supported = platform === "win32" || platform === "darwin";
  const available = supported && Boolean(await find());
  return {
    available, platformSupported: supported, requiresNativeConfirmation: true,
    canStartUnattended: false, canSetAmsMapping: false, canObservePrint: false,
    setupUrl: BAMBU_CONNECT_HELP,
    message: available ? "Send a sliced plate to Bambu Connect, then select the printer and AMS trays and confirm Print there. Your cloud connection stays enabled."
      : supported ? "Install Bambu Connect from Bambu Lab, open it once to finish setup, then refresh. Bambu Studio is a separate app."
      : "Bambu Connect handoff is available on Windows and macOS. Use Bambu Studio on this platform.",
  };
}
export function bambuConnectUri(file: string, name: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(file) || /[\x00-\x1f]/.test(file) || !/\.gcode\.3mf$/i.test(file) || !name || name.length > 160 || /[\x00-\x1f]/.test(name)) fail("Choose a valid local sliced plate.", "bambu_connect_file", 400);
  return `bambu-connect://import-file?path=${encodeURIComponent(file)}&name=${encodeURIComponent(name)}&version=1.0.0`;
}
export async function launchBambuConnect(file: string, name: string, registration: Registration, run: Execute = execute) {
  const uri = bambuConnectUri(file, name, registration.platform);
  try {
    if (registration.platform === "win32") {
      // Fixed script and environment data: filenames are never interpolated as code.
      await run(windowsTool("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:BREADBOARD_BAMBU_CONNECT_URI -WindowStyle Hidden"], { ...options, env: { ...process.env, BREADBOARD_BAMBU_CONNECT_URI: uri } });
    } else {
      await run("/usr/bin/open", ["-a", registration.application, uri], options);
    }
  } catch { fail("Bambu Connect did not accept the launch request. Open the app once, then try again.", "bambu_connect_launch", 503); }
  // OS launch success is not an acknowledgement from the app or printer.
  return { launchRequested: true as const, printStarted: false as const, sentToPrinter: false as const };
}

/** Account-scoped storage, content addressed to avoid duplicate large uploads. */
export async function prepareConnectPlate(root: string, bytes: Buffer, name: string) {
  const inspection = await inspectSlicedFile(bytes, name);
  if (inspection.plates.length !== 1) fail("Export one sliced plate at a time for Bambu Connect.", "single_plate_required", 400);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = path.join(root, sha256);
  const file = path.join(directory, "plate.gcode.3mf");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  // No automatic deletion: Connect may still be reading a previous handoff.
  let used = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    try { used += (await fs.stat(path.join(root, entry.name, "plate.gcode.3mf"))).size; } catch { /* Incomplete handoff. */ }
  }
  let existing: Buffer | null = null;
  try { if ((await fs.stat(file)).size <= MAX_FILE_BYTES) existing = await fs.readFile(file); } catch { /* New content. */ }
  if (existing && createHash("sha256").update(existing).digest("hex") !== sha256) fail("A stored handoff file changed. Choose a new export.", "bambu_connect_integrity", 409);
  if (!existing) {
    if (used + bytes.length > 512 * 1024 * 1024) fail("Stored Bambu Connect plates exceed 512 MiB. Remove completed handoffs before adding another.", "bambu_connect_storage", 409);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try { await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if (createHash("sha256").update(await fs.readFile(file)).digest("hex") !== sha256) fail("A stored handoff file changed.", "bambu_connect_integrity", 409); }
  }
  const displayName = path.basename(name.replaceAll("\\", "/")).replace(/\.gcode\.3mf$/i, "").replace(/[\x00-\x1f]/g, "").slice(0, 160) || "Sliced plate";
  return { file, directory, displayName, sha256, plate: inspection.plates[0] };
}
export async function handoffConnectPlate(root: string, bytes: Buffer, name: string, find = findBambuConnect, launch = launchBambuConnect) {
  const registration = await find();
  if (!registration) fail("Install and open Bambu Connect once, then refresh the connection.", "bambu_connect_missing", 409);
  const prepared = await prepareConnectPlate(root, bytes, name);
  const launchResult = await launch(prepared.file, prepared.displayName, registration);
  const receipt = {
    id: randomUUID(), createdAt: new Date().toISOString(), state: "confirmation_required" as const,
    ...launchResult, sha256: prepared.sha256, filename: prepared.displayName,
    requiresNativeConfirmation: true, printerConnectionVerified: false, mappingApplied: false,
    plate: prepared.plate,
    message: "Launch requested in Bambu Connect. Select the matching printer, check the plate and AMS mapping, then confirm Print there. Breadboard has not sent or started a print.",
  };
  await fs.writeFile(path.join(prepared.directory, "handoff.json"), JSON.stringify(receipt), { mode: 0o600 });
  return receipt;
}
