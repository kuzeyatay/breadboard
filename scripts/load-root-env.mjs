import fs from "node:fs";
import path from "node:path";

// Small dependency-free .env reader for the root service launchers. Existing
// process variables always win, matching conventional dotenv behavior.
export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

export function loadRootEnv(repoRoot) {
  loadEnvFile(path.join(repoRoot, ".env"));
}

/**
 * Dev-only secret sharing: the dashboard's own `.env.local` is the single place
 * a developer keeps loopback credentials (it is git-ignored, unlike the root
 * `.env`). Launchers read it after the root `.env` so a runtime child process
 * and the dashboard cannot drift onto different tokens.
 */
export function loadDashboardEnv(repoRoot) {
  loadEnvFile(path.join(repoRoot, "dashboard", ".env.local"));
}
