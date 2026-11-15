// Run both Crumbs services on this machine: the indexer on :8787 and the
// organization store on :8788, the addresses Breadboard uses by default.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const children = [["indexer.mjs", "8787"], ["org-store.mjs", "8788"]].map(([file, port]) =>
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(here, file)], { cwd: here, stdio: "inherit", env: { ...process.env, PORT: process.env[file === "indexer.mjs" ? "CRUMBS_INDEXER_PORT" : "CRUMBS_ORG_STORE_PORT"] ?? port } }));
const stop = () => { for (const child of children) child.kill(); };
for (const child of children) child.on("exit", code => { stop(); process.exit(code ?? 0); });
process.on("SIGINT", stop); process.on("SIGTERM", stop);
