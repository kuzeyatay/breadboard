import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../db.ts";
import { resolveConnectedRepository } from "../opencode/repository.ts";
import { prepareGraftIndex } from "./garden.ts";

/** True when this user's Garden has a connected repository whose folder still exists. */
export function gardenHasRepository(userId: number, gardenSlug: string | null | undefined): boolean {
  if (!gardenSlug?.trim()) return false;
  try {
    return fs.existsSync(resolveConnectedRepository(userId, gardenSlug).path);
  } catch {
    return false;
  }
}

function folderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "project";
}

/**
 * Create a new local Git repository and connect it to the Garden, the same
 * connection the Garden settings make. Lives under ~/Breadboard/repos.
 */
export async function createGardenRepository(input: { userId: number; clusterId: number; name?: string; root?: string }) {
  const garden = db.prepare("SELECT slug, name, repo_path FROM clusters WHERE id = ? AND user_id = ?")
    .get(input.clusterId, input.userId) as { slug: string; name: string; repo_path: string | null } | undefined;
  if (!garden) throw new Error("Garden not found.");
  if (garden.repo_path && fs.existsSync(garden.repo_path)) {
    throw new Error(`This Garden is already connected to ${garden.repo_path}.`);
  }
  const root = input.root ?? path.join(os.homedir(), "Breadboard", "repos");
  const base = folderName(input.name?.trim() || garden.slug);
  let target = path.join(root, base);
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(root, `${base}-${n}`);
  fs.mkdirSync(target, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: target, stdio: "pipe", windowsHide: true }).toString().trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(target, "README.md"), `# ${input.name?.trim() || garden.name}\n\nCode for the ${garden.name} Garden.\n`);
  git("add", "README.md");
  // An unborn HEAD reads as no repository to the chat digest, so commit once.
  // The user's own Git identity wins; the fallback only covers a fresh machine.
  const identity = (() => { try { return git("config", "user.email") ? [] : null; } catch { return null; } })()
    ?? ["-c", "user.name=Breadboard", "-c", "user.email=breadboard@localhost"];
  git(...identity, "commit", "-m", "Initial commit");

  const resolved = fs.realpathSync(target);
  db.prepare("UPDATE clusters SET repo_path = ? WHERE id = ? AND user_id = ?").run(resolved, input.clusterId, input.userId);
  // Indexing can take a while; chat picks the graph up once it is ready.
  void prepareGraftIndex(input.userId, resolved).catch(() => undefined);
  return { path: resolved, garden: garden.name };
}
