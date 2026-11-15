import "server-only";

import { spawn } from "node:child_process";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

// In a source checkout nothing hosts Crumbs for you, so Breadboard starts the
// two services itself the first time Crumbs is used and they stop with the
// app. A build that points at hosted servers (CRUMBS_INDEXER_URL, or the
// Servers setting on the account page) never reaches this code.
let starting: Promise<void> | null = null;
let lastAttempt = 0;

async function healthy(url: string) {
  try { return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

export function ensureLocalCrumbsServices(servers: { indexer: string; orgStore: string }): Promise<void> {
  const local = /^http:\/\/127\.0\.0\.1:(\d+)$/;
  const indexerPort = local.exec(servers.indexer)?.[1], orgPort = local.exec(servers.orgStore)?.[1];
  if (!indexerPort || !orgPort) return Promise.resolve();
  if (starting) return starting;
  if (Date.now() - lastAttempt < 30_000) return Promise.resolve();
  lastAttempt = Date.now();
  starting = (async () => {
    if (await healthy(servers.indexer) && await healthy(servers.orgStore)) return;
    const home = path.join(repositoryRoot(), "crumbs");
    const script = path.join(home, "dev.mjs");
    if (!fs.existsSync(script)) return;
    const data = path.join(dashboardDataDir(), "crumbs");
    fs.mkdirSync(data, { recursive: true });
    const child = spawn(process.execPath, [script], { cwd: home, stdio: "ignore", windowsHide: true,
      // The dashboard's OPENAI_API_KEY is its local model gateway key, not an OpenAI key:
      // passing it on would leave every crumb waiting on a moderation call that can never succeed.
      // Its DATABASE_URL and NODE_OPTIONS belong to other services, so they are not passed on either.
      env: { ...process.env, NODE_OPTIONS: "", DATABASE_URL: "", OPENAI_API_KEY: process.env.CRUMBS_MODERATION_API_KEY ?? "", CRUMBS_INDEXER_PORT: indexerPort, CRUMBS_ORG_STORE_PORT: orgPort, CRUMBS_INDEXER_DB: path.join(data, "indexer.db"), CRUMBS_ORG_DB: path.join(data, "org-store.db") } });
    child.on("error", () => {});
    child.unref();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await healthy(servers.indexer) && await healthy(servers.orgStore)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  })().finally(() => { starting = null; });
  return starting;
}
