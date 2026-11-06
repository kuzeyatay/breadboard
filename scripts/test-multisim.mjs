#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, ".runtime/multisim-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) throw new Error("Run npm run setup:multisim first");
mkdirSync(path.join(root, ".tmp"), { recursive: true });
const temp = mkdtempSync(path.join(root, ".tmp", "multisim-tests-"));
const descriptor = path.join(root, ".runtime", "multisim.json");
const configuredNgspice = existsSync(descriptor) ? JSON.parse(readFileSync(descriptor, "utf8")).ngspice : null;
const result = spawnSync(python, ["-m", "pytest", "multisim-service/tests", "--basetemp", temp, ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", windowsHide: true, env: {
    ...process.env, BREADBOARD_REQUIRE_NGSPICE: "1",
    ...(configuredNgspice && !process.env.BREADBOARD_NGSPICE ? { BREADBOARD_NGSPICE: configuredNgspice } : {}),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
