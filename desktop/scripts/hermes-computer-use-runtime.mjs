import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The driver binary is only half the transport. Release installs omit dev
// extras, so they must explicitly install the lockfile's computer-use extra.
export function ensureHermesComputerUseClient(python, uv, hermesRoot) {
  const probe = () => spawnSync(python, ["-c", "from mcp.client.session import ClientSession"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (probe().status === 0) return;
  const requirements = path.join(os.tmpdir(), `breadboard-computer-use-${process.pid}.txt`);
  try {
    const exported = spawnSync(uv, [
      "export", "--project", hermesRoot, "--frozen", "--no-dev",
      "--extra", "computer-use", "--no-emit-project", "--format", "requirements-txt",
      "--output-file", requirements,
    ], { encoding: "utf8", windowsHide: true });
    if (exported.status !== 0) throw new Error(`Hermes dependency export failed: ${exported.stderr}`);
    const installed = spawnSync(uv, [
      "pip", "install", "--python", python, "--requirements", requirements,
    ], { encoding: "utf8", windowsHide: true });
    if (installed.status !== 0) throw new Error(`Hermes computer-use dependencies failed: ${installed.stderr}`);
    const verified = probe();
    if (verified.status !== 0) throw new Error(`Hermes MCP client remains unavailable: ${verified.stderr}`);
  } finally {
    if (fs.existsSync(requirements)) fs.unlinkSync(requirements);
  }
}
