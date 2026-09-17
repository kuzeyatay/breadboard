import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error("Base URL is required.");

function envFile(filePath) {
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

const env = envFile(path.join("dashboard", ".env.local"));
const configPath = path.join(".runtime", "desktop-config", "desktop-config.json");
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf8"))
  : {};
const db = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
const user = db.prepare("SELECT id, username, email FROM users WHERE id = 1").get();
db.close();
let cookie = null;
for (const secret of [env.NEXTAUTH_SECRET, config.nextAuthSecret].filter(Boolean)) {
  const token = await encode({
    secret,
    token: { id: String(user.id), sub: String(user.id), name: user.username, email: user.email },
    maxAge: 86_400,
  });
  const candidate = `next-auth.session-token=${token}`;
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: candidate } });
  const payload = await session.json().catch(() => ({}));
  if (String(payload?.user?.id ?? "") === "1") {
    cookie = candidate;
    break;
  }
}
if (!cookie) throw new Error("Authentication failed.");
const documentsMode = process.argv[3] === "documents";
const response = await fetch(
  documentsMode
    ? `${baseUrl}/api/documents?clusterSlug=electromagnetism-1`
    : `${baseUrl}/api/gardens/electromagnetism-1/video-transcriptions`, {
  headers: { Cookie: cookie, "Cache-Control": "no-cache" },
});
const payload = await response.json();
if (!response.ok) throw new Error(JSON.stringify(payload));
if (documentsMode) {
  process.stdout.write(`${JSON.stringify(payload.documents.filter((document) => document.type === "source-document"), null, 2)}\n`);
  process.exit(0);
}
process.stdout.write(`${JSON.stringify(payload.jobs.map((job) => ({
  id: job.id,
  filename: job.originalFilename,
  status: job.status,
  stage: job.currentStage,
  progress: job.progressPercent,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt,
  errorCode: job.errorCode,
  error: job.errorMessage,
})), null, 2)}\n`);
