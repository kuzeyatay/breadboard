import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const baseUrl = process.argv.find((value) => value.startsWith("--base="))?.slice(7);
const gardenSlug = "electromagnetism-1";
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl ?? "")) {
  throw new Error("Usage: --base=http://127.0.0.1:<port>");
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/gu, "")];
      }),
  );
}

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const configPath = path.join(".runtime", "desktop-config", "desktop-config.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
  const database = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
  const user = database.prepare("SELECT id, username, email FROM users WHERE id = 1").get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable.");
  const secrets = [env.NEXTAUTH_SECRET, config?.nextAuthSecret].filter(
    (secret, index, values) => typeof secret === "string" && secret.trim() && values.indexOf(secret) === index,
  );
  for (const secret of secrets) {
    const token = await encode({
      secret,
      token: { id: String(user.id), sub: String(user.id), name: user.username, email: user.email },
      maxAge: 24 * 60 * 60,
    });
    const cookie = `next-auth.session-token=${token}`;
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && String(payload?.user?.id ?? "") === "1") return cookie;
  }
  throw new Error("No local authentication secret matched the running server.");
}

const cookie = await authenticatedCookie();
const response = await fetch(`${baseUrl}/api/gardens/${gardenSlug}/learn/clear`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ confirmClearLearnData: true }),
  signal: AbortSignal.timeout(20 * 60_000),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok || payload?.success !== true) {
  throw new Error(`Learn clear failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
}
process.stdout.write(`${JSON.stringify({ event: "learn-cleared", gardenSlug, result: payload.result })}\n`);
