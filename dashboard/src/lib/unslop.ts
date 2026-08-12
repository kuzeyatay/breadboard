// Server-side helpers for the cloned unslop skill (github asavvin-pixel/unslop).
//
// ChatMock reads the skill (and the calibrated author profile) from the unslop
// repo on disk; the dashboard writes the profile to the SAME location so the two
// stay in sync. Both sides resolve the repo the same way: the UNSLOP_SKILL_DIR
// env var, else a sibling `unslop/` clone found by walking up from the CWD.

import { promises as fs } from "node:fs";
import path from "node:path";

const PROFILE_RELATIVE = path.join("references", "style-profile.md");
const TEMPLATE_RELATIVE = path.join("references", "style-profile-template.md");

/** Directories where the cloned unslop repo might live, most specific first. */
function candidateDirs(): string[] {
  const dirs: string[] = [];
  const envDir = process.env.UNSLOP_SKILL_DIR?.trim();
  if (envDir) dirs.push(envDir);
  // The dashboard runs from breadboard/dashboard; the clone sits at
  // breadboard/unslop. Walk up from the CWD looking for a sibling `unslop/`.
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    dirs.push(path.join(current, "unslop"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

/** The unslop repo root, or null when no clone can be found. */
export async function resolveUnslopDir(): Promise<string | null> {
  for (const dir of candidateDirs()) {
    if (await isFile(path.join(dir, "SKILL.md"))) return dir;
  }
  return null;
}

export interface VoiceProfileState {
  available: boolean; // the unslop clone was found
  exists: boolean; // a calibrated profile has been written
  content: string | null; // the profile markdown, when it exists
  template: string | null; // the blank template, for reference/hand-editing
  updatedAt: string | null; // profile mtime, ISO
}

export async function readVoiceProfile(): Promise<VoiceProfileState> {
  const dir = await resolveUnslopDir();
  if (!dir) {
    return { available: false, exists: false, content: null, template: null, updatedAt: null };
  }
  const profilePath = path.join(dir, PROFILE_RELATIVE);
  const templatePath = path.join(dir, TEMPLATE_RELATIVE);
  let content: string | null = null;
  let updatedAt: string | null = null;
  try {
    content = await fs.readFile(profilePath, "utf-8");
    updatedAt = (await fs.stat(profilePath)).mtime.toISOString();
  } catch {
    content = null;
  }
  let template: string | null = null;
  try {
    template = await fs.readFile(templatePath, "utf-8");
  } catch {
    template = null;
  }
  return { available: true, exists: content !== null, content, template, updatedAt };
}

/** Read the blank template that defines the profile's sections. */
export async function readVoiceTemplate(): Promise<string | null> {
  const dir = await resolveUnslopDir();
  if (!dir) return null;
  try {
    return await fs.readFile(path.join(dir, TEMPLATE_RELATIVE), "utf-8");
  } catch {
    return null;
  }
}

/** Persist the profile markdown, creating references/ if needed. */
export async function writeVoiceProfile(content: string): Promise<void> {
  const dir = await resolveUnslopDir();
  if (!dir) throw new Error("The unslop skill is not installed. Clone it into the repo root first.");
  const profilePath = path.join(dir, PROFILE_RELATIVE);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(profilePath, content.replace(/\r\n/g, "\n").trimEnd() + "\n", "utf-8");
}

/** Remove the calibrated profile, reverting the skill to its defaults. */
export async function deleteVoiceProfile(): Promise<void> {
  const dir = await resolveUnslopDir();
  if (!dir) return;
  try {
    await fs.unlink(path.join(dir, PROFILE_RELATIVE));
  } catch {
    // Already absent — nothing to revert.
  }
}

export function countWords(texts: string[]): number {
  return texts.reduce((total, text) => {
    const words = text.trim().match(/\S+/g);
    return total + (words ? words.length : 0);
  }, 0);
}
