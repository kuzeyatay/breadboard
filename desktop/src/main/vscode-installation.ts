import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { releaseInstallationDownload } from "../shared/released-downloads";

export interface VSCodeInstallation { executable: string; kind: "installed" | "managed" }
export interface VSCodeStorage { stateRoot: string; payloadRoot: string; bulkRoot?: string }
/** Active state stays with Electron; downloaded binaries and extensions follow bulk storage. */
export function resolveVSCodeStorage(userDataDir: string, bulkRoot?: string): VSCodeStorage {
  const stateRoot = path.join(userDataDir, "code");
  return { stateRoot, payloadRoot: bulkRoot ? path.join(bulkRoot, "code") : stateRoot, ...(bulkRoot ? { bulkRoot } : {}) };
}
export function assertVSCodeStorage(storage: VSCodeStorage): void {
  if (!storage.bulkRoot) return;
  try {
    if (!fs.statSync(storage.bulkRoot).isDirectory()) throw new Error("Not a directory");
    fs.accessSync(storage.bulkRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error("Breadboard’s configured large-file storage is unavailable. Reconnect it, then retry Code.");
  }
}
export function vscodeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"));
  for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"]]) if (base) candidates.push(path.join(base, "Microsoft VS Code", "Code.exe"));
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const clean = dir.replace(/^"|"$/g, "");
    candidates.push(path.join(clean, "Code.exe"));
    if (path.basename(clean).toLowerCase() === "bin") candidates.push(path.resolve(clean, "..", "Code.exe"));
  }
  return [...new Set(candidates)];
}
export function findVSCode(storage: VSCodeStorage, candidates = vscodeCandidates()): VSCodeInstallation | null {
  assertVSCodeStorage(storage);
  const root = storage.stateRoot;
  let custom: string | undefined;
  try { const saved = JSON.parse(fs.readFileSync(path.join(root, "installation.json"), "utf8")); if (typeof saved.executable === "string") custom = saved.executable; } catch { /* First run. */ }
  for (const executable of [...(custom ? [custom] : []), ...candidates]) {
    try { if (path.isAbsolute(executable) && fs.statSync(executable).isFile()) return { executable, kind: "installed" }; } catch { /* Try another installation. */ }
  }
  return findManagedVSCode(storage);
}
/** Find only Breadboard's verified download; an updating installed copy cannot shadow it. */
export function findManagedVSCode(storage: VSCodeStorage): VSCodeInstallation | null {
  assertVSCodeStorage(storage);
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(storage.stateRoot, "managed.json"), "utf8"));
    if (/^[a-f0-9]{40}$/.test(saved.commit)) {
      const executable = path.join(storage.payloadRoot, "versions", saved.commit, "Code.exe");
      if (fs.statSync(executable).isFile()) return { executable, kind: "managed" };
    }
  } catch { /* A missing or incomplete download is installable again. */ }
  return null;
}
export function saveVSCodeSelection(root: string, executable: string): void {
  if (!path.isAbsolute(executable) || !/^Code(?: - Insiders)?\.exe$/i.test(path.basename(executable)) || !fs.statSync(executable).isFile()) throw new Error("Choose the Code.exe file from your VS Code installation.");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "installation.json"), JSON.stringify({ executable }));
}
export interface VSCodeRelease { url: string; version: string; sha256hash: string }
export function isMicrosoftDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") &&
      ["update.code.visualstudio.com", "vscode.download.prss.microsoft.com", "vscode.download.prss.microsoft.com.edgesuite.net", "az764295.vo.msecnd.net"].includes(parsed.hostname);
  } catch { return false; }
}
export function readVSCodeRelease(value: unknown): VSCodeRelease {
  const release = value as Partial<VSCodeRelease> | null;
  if (!release || typeof release.url !== "string" || !isMicrosoftDownload(release.url) ||
      typeof release.version !== "string" || !/^[a-f0-9]{40}$/.test(release.version) ||
      typeof release.sha256hash !== "string" || !/^[a-f0-9]{64}$/.test(release.sha256hash)) throw new Error("Microsoft returned invalid VS Code download information.");
  return release as VSCodeRelease;
}
export function assertVSCodeHash(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("The VS Code download failed its integrity check. Please retry.");
}
function powershellLiteral(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
function extractArchive(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  const script = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(destination)}`;
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], signal });
    let error = "";
    child.stderr.on("data", chunk => { error = (error + String(chunk)).slice(-2000); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(error.trim() || "Could not extract VS Code.")));
  });
}
/** Downloads Microsoft's unmodified ZIP for this user; no installer, registry, or admin rights. */
export async function installVSCode(storage: VSCodeStorage, onProgress: (phase: "downloading" | "extracting", progress?: number) => void,
  fetcher: typeof fetch = fetch, signal: AbortSignal = AbortSignal.timeout(15 * 60_000), arch = process.arch): Promise<VSCodeInstallation> {
  assertVSCodeStorage(storage);
  signal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
  if (arch !== "x64" && arch !== "arm64") throw new Error("The Code tab supports 64-bit Windows.");
  async function request(url: string, remaining = 5): Promise<Response> {
    if (!isMicrosoftDownload(url)) throw new Error("VS Code downloads must come from Microsoft.");
    const response = await fetcher(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || remaining <= 0) throw new Error("The VS Code download redirected too many times.");
      return request(new URL(location, url).href, remaining - 1);
    }
    if (!response.ok) throw new Error(`Microsoft's VS Code download is unavailable (${response.status}).`);
    return response;
  }
  onProgress("downloading", 0);
  const metadata = await request(`https://update.code.visualstudio.com/api/update/win32-${arch}-archive/stable/latest`);
  const release = readVSCodeRelease(await metadata.json());
  const versions = path.join(storage.payloadRoot, "versions");
  await fs.promises.mkdir(versions, { recursive: true });
  const destination = path.join(versions, release.version);
  const executable = path.join(destination, "Code.exe");
  const temp = path.join(versions, ".download-" + randomUUID());
  await fs.promises.mkdir(temp);
  try {
    if (!fs.existsSync(executable)) {
      const response = await request(release.url);
      if (!response.body) throw new Error("Microsoft returned an empty VS Code download.");
      const total = Number(response.headers.get("content-length")) || 0;
      const hash = createHash("sha256"); let received = 0, reported = -1;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > 750 * 1024 * 1024) { callback(new Error("The VS Code archive is larger than expected.")); return; }
        hash.update(chunk);
        const progress = total ? Math.min(99, Math.floor(received * 100 / total)) : undefined;
        if (progress !== reported) { if (progress !== undefined) reported = progress; onProgress("downloading", progress); }
        callback(null, chunk);
      } });
      const archive = path.join(temp, "vscode.zip");
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), meter, fs.createWriteStream(archive), { signal });
      assertVSCodeHash(hash.digest("hex"), release.sha256hash);
      onProgress("extracting");
      const extracted = path.join(temp, "app");
      await extractArchive(archive, extracted, signal);
      if (!fs.existsSync(path.join(extracted, "Code.exe"))) throw new Error("The VS Code archive did not contain Code.exe.");
      // Portable data is kept with this managed copy; an installed user's profile is untouched.
      await fs.promises.mkdir(path.join(extracted, "data"), { recursive: true });
      await fs.promises.rename(extracted, destination);
    }
    signal.throwIfAborted();
    await fs.promises.mkdir(storage.stateRoot, { recursive: true });
    await fs.promises.writeFile(path.join(storage.stateRoot, "managed.json"), JSON.stringify({ commit: release.version }));
    // If immediate removal is blocked, the idle coordinator can recognize this
    // verified, released archive after seven days without guessing from its age.
    try { if (fs.existsSync(path.join(temp, "vscode.zip"))) releaseInstallationDownload(temp, "vscode.zip"); }
    catch { /* A receipt failure cannot invalidate an already verified install. */ }
    return { executable, kind: "managed" };
  } finally {
    // This unique staging directory is created above, always under our versions directory.
    if (path.dirname(path.resolve(temp)) === path.resolve(versions) && path.basename(temp).startsWith(".download-"))
      await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
