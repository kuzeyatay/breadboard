import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CodeRepository { path: string; name: string; gardenSlug: string }

/** Only the authenticated Garden connection chooses a folder; IPC accepts no path. */
export async function resolveCodeRepository(pageUrl: string, fetch: typeof globalThis.fetch): Promise<CodeRepository | undefined> {
  const page = new URL(pageUrl);
  if (!page.searchParams.has("garden")) return undefined;
  const garden = page.searchParams.get("garden")?.trim();
  if (!garden || garden.length > 240) throw new Error("Choose a Garden with a connected repository.");
  const endpoint = new URL("/api/code/repository", page.origin);
  endpoint.searchParams.set("garden", garden);
  const response = await fetch(endpoint.href, { method: "GET", credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (response.status === 401) throw new Error("Sign in to Breadboard, then retry opening this repository.");
  const body = await response.json() as { repository?: CodeRepository; error?: string };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "This Garden’s repository could not be opened.");
  const repository = body.repository;
  if (!repository || repository.gardenSlug !== garden || typeof repository.path !== "string" || !path.isAbsolute(repository.path)) {
    throw new Error("This Garden has an invalid repository connection. Reconnect it, then try again.");
  }
  try {
    const folder = await fs.realpath(repository.path);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error("not a folder");
    await fs.access(path.join(folder, ".git")); // Worktrees may use a .git file.
    return { path: folder, name: path.basename(folder), gardenSlug: garden };
  } catch {
    throw new Error("The connected repository is unavailable on this computer. Reconnect it from the Garden card, then try again.");
  }
}
