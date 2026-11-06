import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyGoogleFlowSource } from "./google-flow-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = verifyGoogleFlowSource(root);
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
if (npmCli && !existsSync(npmCli)) throw new Error("npm is required beside the active Node runtime.");
for (const args of [["ci", "--no-audit", "--no-fund"], ["run", "check"]]) {
  const result = spawnSync(npmCli ? process.execPath : "npm", [...(npmCli ? [npmCli] : []), ...args], {
    cwd: path.join(root, "google-flow-mcp"), stdio: "inherit", windowsHide: true,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Flow setup failed: npm ${args.join(" ")}`);
}
verifyGoogleFlowSource(root);
process.stdout.write(`Google Flow ${pin.version} built and tested (${pin.commit}).\n`);
process.stdout.write("In Breadboard, open Settings → Connections → Google Flow · Veo to connect your Google account.\n");
