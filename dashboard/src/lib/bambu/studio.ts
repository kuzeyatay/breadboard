import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BAMBU_MODELS, fail, type BambuStudioStatus } from "./types.ts";
import { modelName } from "./compatibility.ts";

type StudioInstallation = { executable: string; resources: string; config: string };
const emptySelected = () => ({ printer: null, model: null, nozzle: null, process: null, filaments: [] });
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value) ? value : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Bambu adds a trailing checksum comment to its JSON config. Never expose the
 * config itself: it also contains LAN access codes and account identifiers. */
export function studioPreferences(source: string): Pick<BambuStudioStatus, "version" | "selected"> {
  let config: Record<string, unknown>;
  try { config = record(JSON.parse(source.replace(/^\uFEFF/, "").replace(/\r?\n#[^]*$/, ""))); }
  catch { return { version: null, selected: emptySelected() }; }
  const app = record(config.app), presets = record(config.presets);
  const printer = text(presets.machine ?? presets.printer);
  const model = printer ? BAMBU_MODELS.find(m => modelName(m) === modelName(printer)) ?? null : null;
  const nozzle = printer ? Number(/\s(0\.[2468])\s*(?:mm\s*)?nozzle\b/i.exec(printer)?.[1]) : NaN;
  return { version: text(app.version), selected: { printer, model, nozzle: Number.isFinite(nozzle) ? nozzle : null, process: text(presets.process ?? presets.print), filaments: (Array.isArray(presets.filaments) ? presets.filaments : []).slice(0, 16).map(text).filter((x): x is string => x !== null) } };
}

export function studioLocations(platform = process.platform, env = process.env, home = os.homedir()): StudioInstallation[] {
  if (platform === "win32") {
    const config = path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "BambuStudio", "BambuStudio.conf");
    return [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")].filter((p): p is string => Boolean(p)).map(root => ({ executable: path.join(root, "Bambu Studio", "bambu-studio.exe"), resources: path.join(root, "Bambu Studio", "resources"), config }));
  }
  if (platform === "darwin") return ["/Applications", path.join(home, "Applications")].map(root => ({ executable: path.join(root, "BambuStudio.app/Contents/MacOS/BambuStudio"), resources: path.join(root, "BambuStudio.app/Contents/Resources"), config: path.join(home, "Library/Application Support/BambuStudio/BambuStudio.conf") }));
  return ["/usr", "/usr/local"].map(root => ({ executable: path.join(root, "bin/bambu-studio"), resources: path.join(root, "share/BambuStudio"), config: path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "BambuStudio/BambuStudio.conf") }));
}

async function smallFile(file: string, max = 2 * 1024 * 1024): Promise<string> {
  if ((await fs.stat(file)).size > max) throw new Error("Studio metadata is too large");
  return fs.readFile(file, "utf8");
}
export async function findBambuStudio(locations = studioLocations()): Promise<StudioInstallation | null> {
  for (const location of locations) { try { if ((await fs.stat(location.executable)).isFile()) return location; } catch { /* Try the next standard installation. */ } }
  return null;
}
export async function inspectBambuStudio(locations = studioLocations()): Promise<BambuStudioStatus> {
  const install = await findBambuStudio(locations);
  if (!install) return { installed: false, version: null, profiles: [], selected: emptySelected(), message: "Bambu Studio was not found in its standard installation folders on this computer." };
  let preferences: Pick<BambuStudioStatus, "version" | "selected"> = { version: null, selected: emptySelected() };
  try { preferences = studioPreferences(await smallFile(install.config)); } catch { /* App can open even before its first setup. */ }
  const profiles: BambuStudioStatus["profiles"] = [];
  const directory = path.join(install.resources, "profiles/BBL/machine");
  try {
    for (const file of (await fs.readdir(directory)).filter(n => n.endsWith(".json") && !n.includes("nozzle")).slice(0, 100)) {
      try {
        const row = JSON.parse(await smallFile(path.join(directory, file), 128 * 1024));
        if (row.type !== "machine_model" || !text(row.name)) continue;
        const nozzles = String(row.nozzle_diameter ?? "").split(";").map(Number).filter(n => [0.2,0.4,0.6,0.8].includes(n));
        profiles.push({ name: row.name, nozzles });
      } catch { /* One invalid profile must not hide a usable installation. */ }
    }
  } catch { /* Still allow launching an installation with no bundled profiles. */ }
  return { installed: true, ...preferences, profiles: profiles.sort((a,b) => a.name.localeCompare(b.name)), message: "Use Bambu Studio’s existing printer connections and sign-in. Select the printer and AMS tray there when sending a print." };
}

/** The executable is discovered locally, never supplied by an HTTP client.
 * A successful launch is a handoff, not a printer connection or print receipt. */
export async function openBambuStudio(file?: string, locations = studioLocations(), launch = spawn) {
  const install = await findBambuStudio(locations);
  if (!install) fail("Install Bambu Studio in its standard folder, then refresh the connection.", "bambu_studio_missing", 404);
  if (file && (!path.isAbsolute(file) || !/\.(3mf|stl|step|stp)$/i.test(file) || !(await fs.stat(file)).isFile())) fail("Choose a local CAD or 3MF file.", "bambu_studio_file", 400);
  await new Promise<void>((resolve, reject) => {
    const child = launch(install.executable, file ? [file] : [], { shell: false, windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", () => reject(Object.assign(new Error("Bambu Studio could not be opened. Check its installation and try again."), { status: 503, code: "bambu_studio_launch" })));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
  return { opened: true, printStarted: false, message: file ? "Opened the file in Bambu Studio. Review slicing, printer and AMS mapping there before printing." : "Opened Bambu Studio with its existing printer connections." };
}

export function studioModelExtension(name: string, bytes: Buffer) {
  const extension = path.extname(name).toLowerCase();
  const header = bytes.subarray(0, 512).toString("ascii").trimStart();
  const isBinaryStl = bytes.length >= 84 && 84 + bytes.readUInt32LE(80) * 50 === bytes.length;
  if ((extension === ".3mf" && bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))) || (extension === ".stl" && (isBinaryStl || /^solid\b/.test(header))) || ([".step", ".stp"].includes(extension) && header.startsWith("ISO-10303-21;"))) return extension;
  fail("Choose a valid .3mf, .stl or .step model to open in Bambu Studio.", "bambu_studio_file", 400);
}

export async function stageStudioModel(root: string, name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 128 * 1024 * 1024) fail("Choose a model smaller than 128 MiB.", "archive_size", 400);
  const extension = studioModelExtension(name, bytes);
  const safeName = path.basename(name.replace(/\\/g,"/")).slice(0,100).replace(/[^a-zA-Z0-9._ -]/g,"_").replace(/^[ .-]+/, "") || `model${extension}`;
  const directory = path.join(root, randomUUID());
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, safeName.endsWith(extension) ? safeName : `model${extension}`);
  await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  return file;
}
