import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dashboardDataDir } from "../runtime-paths.ts";
import { approvedOrigin, type AceStepConnection } from "./client.ts";
import { capabilitiesFor } from "./capabilities.ts";
import { resonantBinding } from "../music-producer/resonant.ts";
export interface AceStepSettings {
  mode: "managed" | "external";
  externalUrl: string;
  model: string;
  apiKey: string;
  resonantSlug: string;
}
export interface AceStepConfig extends AceStepConnection {
  managed: boolean;
  directory: string;
  resonantSlug?: string;
  resonantDigest?: string;
}
function directory() { return path.join(dashboardDataDir(), "music-producer"); }
function file(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new Error("invalid_music_owner");
  return path.join(directory(), `settings-${userId}.json`);
}
export function readAceStepSettings(userId: number): AceStepSettings {
  const filename = file(userId);
  if (!fs.existsSync(filename))
    return { mode: "managed", externalUrl: "", model: "acestep-v15-turbo", apiKey: "", resonantSlug: "" };
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
    throw new Error("invalid_provider_settings");
  return z.object({ mode: z.enum(["managed", "external"]), externalUrl: z.string().max(4096), model: z.string().max(128), apiKey: z.string().max(2048).regex(/^[^\r\n]*$/), resonantSlug: z.string().regex(/^[a-z0-9_-]{0,48}$/).default("") }).strict().parse(JSON.parse(fs.readFileSync(filename, "utf8")));
}
export function saveAceStepSettings(userId: number, value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !["mode", "externalUrl", "model", "apiKey", "resonantSlug"].includes(key)))
    throw new Error("unknown_provider_setting");
  if (value.mode !== "managed" && value.mode !== "external")
    throw new Error("invalid_provider_mode");
  const model = typeof value.model === "string" ? value.model : "acestep-v15-turbo";
  capabilitiesFor(model);
  if (value.mode === "managed" && model !== "acestep-v15-turbo")
    throw new Error("Managed setup currently prepares the turbo model only.");
  const externalUrl = value.mode === "external" ? approvedOrigin(String(value.externalUrl ?? "")) : "";
  const old = readAceStepSettings(userId);
  const resonantSlug = value.resonantSlug === undefined ? old.resonantSlug ?? "" : String(value.resonantSlug);
  if (resonantSlug && !/^[a-z0-9_-]{1,48}$/.test(resonantSlug))
    throw new Error("invalid_resonant_connection");
  if (resonantSlug)
    resonantBinding(userId, resonantSlug);
  const apiKey = value.apiKey === undefined ? old.apiKey : String(value.apiKey);
  if (apiKey.length > 2048 || /[\r\n]/.test(apiKey))
    throw new Error("invalid_provider_key");
  fs.mkdirSync(directory(), { recursive: true });
  const filename = file(userId), temp = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ mode: value.mode, externalUrl, model, apiKey, resonantSlug }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, filename);
}
export function resolveAceStepConfig(userId: number): AceStepConfig {
  const settings = readAceStepSettings(userId);
  // Optional adapter authorization is checked only when it is used; its absence cannot disable ACE-Step.
  let resonantDigest: string | undefined;
  if (settings.resonantSlug) {
    try {
      resonantDigest = resonantBinding(userId, settings.resonantSlug).digest;
    }
    catch { /* Generation remains available. */ }
  }
  const resonant = { resonantSlug: settings.resonantSlug, resonantDigest };
  if (settings.mode === "external")
    return { ...resonant, managed: false, directory: directory(), baseUrl: approvedOrigin(settings.externalUrl), apiKey: settings.apiKey, model: settings.model };
  const root = process.env.BREADBOARD_ACESTEP_DIR?.trim();
  const url = process.env.BREADBOARD_ACESTEP_URL?.trim();
  if (!root || !path.isAbsolute(root) || !url || process.env.BREADBOARD_RUNTIME_V2_ACTIVE !== "true")
    throw new Error("Managed Music Producer requires the Breadboard Runtime. Configure an explicit external ACE-Step endpoint for a bare dashboard.");
  const baseUrl = approvedOrigin(url);
  if (new URL(baseUrl).hostname !== "127.0.0.1" || new URL(baseUrl).protocol !== "http:")
    throw new Error("invalid_managed_acestep_authority");
  const tokenFile = path.join(root, "api-key");
  const apiKey = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "";
  return { ...resonant, managed: true, directory: root, baseUrl, apiKey, model: settings.model };
}
