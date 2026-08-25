import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import nextAuthJwt from "../node_modules/next-auth/jwt/index.js";

const { encode } = nextAuthJwt;
const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const envPath = path.join(dashboardRoot, ".env.local");
const desktopConfigPath = path.join(repoRoot, ".runtime", "desktop-config", "desktop-config.json");
const baseUrl = process.env.GENOFFICE_SMOKE_BASE_URL?.trim() || "http://127.0.0.1:3000";
const artifactId = process.env.GENOFFICE_SMOKE_ARTIFACT_ID?.trim();
const conversationId = process.env.GENOFFICE_SMOKE_CONVERSATION_ID?.trim();
const userId = process.env.GENOFFICE_SMOKE_USER_ID?.trim() || "1";

if (!artifactId || !conversationId) {
  throw new Error("GENOFFICE_SMOKE_ARTIFACT_ID and GENOFFICE_SMOKE_CONVERSATION_ID are required.");
}

function envValue(name) {
  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is not configured.`);
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.length >= 2 && (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) ? value.slice(1, -1) : value;
}

function nextAuthSecret() {
  if (fs.existsSync(desktopConfigPath)) {
    const config = JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"));
    if (typeof config.nextAuthSecret === "string" && config.nextAuthSecret) {
      return config.nextAuthSecret;
    }
  }
  return envValue("NEXTAUTH_SECRET");
}

const token = await encode({
  secret: nextAuthSecret(),
  maxAge: 10 * 60,
  token: { id: userId, sub: userId, name: "genoffice-ai-smoke" },
});
const response = await fetch(
  `${baseUrl}/api/hermes/artifacts/${encodeURIComponent(artifactId)}/genoffice/ai?${new URLSearchParams({ conversationId })}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `next-auth.session-token=${token}`,
    },
    body: JSON.stringify({
      prompt: "What title does this document use? Answer in chat only and do not edit the document.",
      history: [],
      documentContext: [
        "Current document: 1 block, 6 words",
        "0|docHeading level=1|Cat Species and Their Ancestries",
      ].join("\n"),
      documentHtml: "<h1>Cat Species and Their Ancestries</h1>",
      documentTruncated: false,
    }),
  },
);
const payload = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(`Contained GenOffice AI API failed (${response.status}): ${payload?.error || "unknown error"}`);
}
if (!String(payload?.message || "").toLowerCase().includes("cat species")) {
  throw new Error("Contained GenOffice AI API did not answer from the supplied live document context.");
}
if (!Array.isArray(payload?.actions) || payload.actions.length !== 0) {
  throw new Error("A read-only document question unexpectedly returned edit actions.");
}
console.log(JSON.stringify({ ok: true, authenticated: true, modelReply: true, actions: 0 }));

