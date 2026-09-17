import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const baseUrl = process.argv.find((value) => value.startsWith("--base="))?.slice(7);
const expectedJobId = process.argv.find((value) => value.startsWith("--job="))?.slice(6);
if (!baseUrl || !expectedJobId) throw new Error("Usage: --base=<url> --job=<learn job id>");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8").split(/\r?\n/u)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/gu, "")];
      }),
  );
}

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const desktopConfigPath = path.join(".runtime", "desktop-config", "desktop-config.json");
  const desktopConfig = fs.existsSync(desktopConfigPath)
    ? JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"))
    : null;
  const database = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
  const user = database.prepare("SELECT id, username, email FROM users WHERE id = 1").get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable.");
  const secrets = [env.NEXTAUTH_SECRET, desktopConfig?.nextAuthSecret].filter(
    (secret, index, values) => typeof secret === "string" && secret.trim() && values.indexOf(secret) === index,
  );
  for (const secret of secrets) {
    const token = await encode({
      secret,
      token: { id: String(user.id), sub: String(user.id), name: user.username, email: user.email },
      maxAge: 24 * 60 * 60,
    });
    const cookie = `next-auth.session-token=${token}`;
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await session.json().catch(() => ({}));
    if (session.ok && String(payload?.user?.id ?? "") === "1") return cookie;
  }
  throw new Error("No local authentication secret matched the running server.");
}

const cookie = await authenticatedCookie();
const response = await fetch(`${baseUrl}/api/gardens/electromagnetism-1/learn/cancel`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ expectedJobId }),
  signal: AbortSignal.timeout(60_000),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Learn cancel failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
process.stdout.write(`${JSON.stringify({ event: "learn-cancel-requested", expectedJobId, response: payload })}\n`);
