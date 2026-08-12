// Prepare the isolated interpreter used by Breadboard's headless iFixAi loop.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "iFixAi");
const runtimeRoot = path.join(repoRoot, ".runtime", "ifixai-venv");
const expectedCommit = "4ac9cc1c8765427300d98dc30855c18349610cf1";
const python = path.join(
  runtimeRoot,
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

function fail(message) {
  console.error(`[setup-ifixai] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(sourceRoot, "pyproject.toml"))) {
  fail(`iFixAi checkout not found at ${sourceRoot}`);
}
const actualCommit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (actualCommit !== expectedCommit) {
  fail(`checkout is ${actualCommit}; Breadboard is pinned to ${expectedCommit}`);
}

fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
if (!fs.existsSync(python)) {
  const create = spawnSync(
    "uv",
    ["venv", "--python", "3.12", runtimeRoot],
    { cwd: repoRoot, stdio: "inherit", shell: false },
  );
  if (create.status !== 0) fail("could not create the isolated Python environment");
}

const install = spawnSync(
  "uv",
  ["pip", "install", "--python", python, "--editable", sourceRoot],
  { cwd: repoRoot, stdio: "inherit", shell: false },
);
if (install.status !== 0) fail("could not install the pinned iFixAi checkout");

const verify = spawnSync(
  python,
  [
    "-c",
    [
      "import ifixai",
      "from ifixai.core.fixture_loader import load_fixture",
      `load_fixture(${JSON.stringify(path.join(repoRoot, "hermes-config", "ifixai", "breadboard-assistant.yaml"))})`,
      "print(ifixai.__version__)",
    ].join("; "),
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, IFIXAI_TELEMETRY: "0", DO_NOT_TRACK: "1" },
    windowsHide: true,
  },
);
if (verify.status !== 0) fail(verify.stderr.trim() || "iFixAi import/fixture check failed");
fs.writeFileSync(
  path.join(runtimeRoot, "BREADBOARD_UPSTREAM_COMMIT"),
  `${actualCommit}\n`,
  "utf8",
);
console.log(`[setup-ifixai] ready: iFixAi ${verify.stdout.trim()} (${actualCommit.slice(0, 12)})`);
