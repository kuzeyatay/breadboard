import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { modelReferencePath, wardrobeDataDir } from "./runtime.ts";
import { setupStatus, type SetupResult } from "./status.ts";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export async function saveIdentityPhoto(dataUrl: string): Promise<SetupResult> {
  const status = () => setupStatus();
  const target = modelReferencePath();
  const dataDir = wardrobeDataDir();
  if (!target || !dataDir) {
    return { ok: false, message: status().reason, status: status() };
  }
  const match = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return { ok: false, message: "That is not an image.", status: status() };
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.byteLength || bytes.byteLength > MAX_REFERENCE_BYTES) {
    return { ok: false, message: "That image is empty or too large.", status: status() };
  }
  try {
    const png = await sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, png);
  } catch {
    return { ok: false, message: "That image could not be read.", status: status() };
  }
  return {
    ok: true,
    message: "Your photo is saved. Wardrobe can model clothes on it now.",
    status: status(),
  };
}

export async function removeIdentityPhoto(): Promise<SetupResult> {
  const target = modelReferencePath();
  if (target) await fs.promises.rm(target, { force: true });
  return { ok: true, message: "Your photo was removed.", status: setupStatus() };
}
