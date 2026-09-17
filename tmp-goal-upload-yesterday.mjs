import crypto from "node:crypto";
import fs, { openAsBlob } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const gardenSlug = "electromagnetism-1";
const downloadsDirectory = "C:/Users/20252082/Downloads";
const baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ||
  "http://127.0.0.1:3000";
const manifest = [
  [
    "5EPF0 2025-10-03 - 0845 Eindhoven University of Technology Enter.mp3",
    "37b047dccc12ce2f899641b105e7cf45c6df27d52bfe754d9e745b15c2322a49",
  ],
  [
    "5EPF0 2025-10-08 - 1330 Eindhoven University of Technology Enter.mp3",
    "0e8ecd8d682d83bfe0de40c1a430ddb10c18934d6609994e360fb8eabe6b3bf4",
  ],
  [
    "5EPF0 2025-10-10 - 0845 Eindhoven University of Technology Enter.mp3",
    "5dfe59cfa68ee9e3340a069ab078b7800267d64d26cd9f558da8af950bf102a3",
  ],
  [
    "5EPF0 2025-10-15 - 1330 Eindhoven University of Technology Enter.mp3",
    "fec2d6dd2aa834466c9aa6fb1dd2d574eb8dc6aad6e29a4bd571bd609ea67583",
  ],
  [
    "5EPF0 2025-10-17 - 0845 Eindhoven University of Technology Enter.mp3",
    "39520289236ccdff2bb0abd4f6e49004f47329af5bcec2a8da16d29949ab67df",
  ],
  [
    "5EPF0 2025-10-22 - 1330 Eindhoven University of Technology Enter.mp3",
    "828e6f35a9ad1c9232656f3ac7667b162893c10ddfeaa7e505a6efe8e6d7f857",
  ],
  [
    "5EPF0 2025-10-24 - 0845 Eindhoven University of Technology Enter.mp3",
    "3b69fa48e826c35ace47e544e48dad52f1c9af89100cfd33954c7db45d8657e5",
  ],
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/gu, ""),
        ];
      }),
  );
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const desktopConfigPath = path.join(
    ".runtime",
    "desktop-config",
    "desktop-config.json",
  );
  const desktopConfig = fs.existsSync(desktopConfigPath)
    ? JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"))
    : null;
  const database = new DatabaseSync("dashboard/db/brain.db", {
    readOnly: true,
  });
  const user = database
    .prepare("SELECT id, username, email FROM users WHERE id = 1")
    .get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable.");
  const secrets = [env.NEXTAUTH_SECRET, desktopConfig?.nextAuthSecret].filter(
    (secret, index, values) =>
      typeof secret === "string" &&
      secret.trim() &&
      values.indexOf(secret) === index,
  );
  for (const secret of secrets) {
    const token = await encode({
      secret,
      token: {
        id: String(user.id),
        sub: String(user.id),
        name: user.username,
        email: user.email,
      },
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
const apiBase = `${baseUrl}/api/gardens/${gardenSlug}/video-transcriptions`;
const tracked = new Map();

async function fetchJobs() {
  const response = await fetch(apiBase, {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.jobs)) {
    throw new Error(
      `Job inventory failed: HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload.jobs;
}

for (const [filename, expectedHash] of manifest) {
  const filePath = path.resolve(downloadsDirectory, filename);
  if (path.dirname(filePath) !== path.resolve(downloadsDirectory)) {
    throw new Error(`Manifest path escapes Downloads: ${filename}`);
  }
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Manifest file is missing: ${filePath}`);
  }
  const actualHash = await sha256File(filePath);
  if (actualHash !== expectedHash) {
    throw new Error(`Manifest hash changed for ${filename}.`);
  }
  const jobs = await fetchJobs();
  const matches = jobs.filter(
    (job) =>
      job?.mediaSha256 === expectedHash || job?.originalFilename === filename,
  );
  const existing =
    matches.find((job) => job.status === "completed") ??
    matches.find((job) => !["failed", "cancelled"].includes(job.status));
  if (existing?.status === "completed") {
    process.stdout.write(
      `${JSON.stringify({ event: "already-complete", filename, jobId: existing.id, sourceSlug: existing.sourceSlug })}\n`,
    );
    continue;
  }
  if (existing) {
    tracked.set(existing.id, { filename, retries: 0 });
    process.stdout.write(
      `${JSON.stringify({ event: "resumed", filename, jobId: existing.id, status: existing.status })}\n`,
    );
    continue;
  }

  for (;;) {
    const body = new FormData();
    body.append("media", await openAsBlob(filePath, { type: "audio/mpeg" }), filename);
    const response = await fetch(apiBase, {
      method: "POST",
      headers: { Cookie: cookie },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.duplicate === true && payload?.source) {
      process.stdout.write(
        `${JSON.stringify({ event: "duplicate-source", filename, source: payload.source })}\n`,
      );
      break;
    }
    if (response.status === 429 && payload?.errorCode === "queue_full") {
      process.stdout.write(
        `${JSON.stringify({ event: "queue-full", filename, action: "wait-and-retry" })}\n`,
      );
      for (;;) {
        await sleep(30_000);
        const waitingJobs = await fetchJobs();
        const appeared = waitingJobs.find(
          (job) =>
            job?.mediaSha256 === expectedHash ||
            job?.originalFilename === filename,
        );
        if (appeared) {
          tracked.set(appeared.id, { filename, retries: 0 });
          process.stdout.write(
            `${JSON.stringify({ event: "resumed", filename, jobId: appeared.id, status: appeared.status })}\n`,
          );
          break;
        }
        const activeCount = waitingJobs.filter(
          (job) => !["completed", "failed", "cancelled"].includes(job?.status),
        ).length;
        if (activeCount < 5) break;
      }
      if ([...tracked.values()].some((state) => state.filename === filename)) {
        break;
      }
      continue;
    }
    if (response.status !== 202 || payload?.success !== true || !payload?.job?.id) {
      throw new Error(
        `Upload was not accepted for ${filename}: HTTP ${response.status} ${JSON.stringify(payload)}`,
      );
    }
    tracked.set(payload.job.id, { filename, retries: 0 });
    process.stdout.write(
      `${JSON.stringify({ event: "accepted", filename, jobId: payload.job.id })}\n`,
    );
    break;
  }
}

const terminal = new Set(["completed", "failed", "cancelled"]);
let lastSignature = "";
while (tracked.size > 0) {
  const response = await fetch(apiBase, {
    headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.jobs)) {
    throw new Error(
      `Job inventory failed: HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  const snapshot = [];
  for (const [jobId, state] of tracked) {
    const job = payload.jobs.find((candidate) => candidate?.id === jobId);
    if (!job) throw new Error(`Accepted job disappeared: ${jobId}`);
    snapshot.push({
      jobId,
      filename: state.filename,
      status: job.status,
      stage: job.currentStage,
      progress: job.progressPercent,
      errorCode: job.errorCode,
      error: job.errorMessage,
    });
    if (job.status === "completed") {
      process.stdout.write(
        `${JSON.stringify({ event: "completed", jobId, filename: state.filename, sourceSlug: job.sourceSlug })}\n`,
      );
      tracked.delete(jobId);
      continue;
    }
    if (job.status === "failed" && state.retries < 2) {
      const retry = await fetch(`${apiBase}/${jobId}/retry`, {
        method: "POST",
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(30_000),
      });
      const retryPayload = await retry.json().catch(() => ({}));
      if (!retry.ok || retryPayload?.success !== true) {
        throw new Error(
          `Retry failed for ${jobId}: HTTP ${retry.status} ${JSON.stringify(retryPayload)}`,
        );
      }
      state.retries += 1;
      process.stdout.write(
        `${JSON.stringify({ event: "retried", jobId, filename: state.filename, attempt: state.retries, priorErrorCode: job.errorCode })}\n`,
      );
      continue;
    }
    if (terminal.has(job.status)) {
      throw new Error(
        `Job ${jobId} ended as ${job.status}: ${job.errorCode ?? "unknown"} ${job.errorMessage ?? ""}`,
      );
    }
  }
  const signature = JSON.stringify(snapshot);
  if (signature !== lastSignature) {
    process.stdout.write(`${JSON.stringify({ event: "progress", jobs: snapshot })}\n`);
    lastSignature = signature;
  }
  if (tracked.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

process.stdout.write(
  `${JSON.stringify({ event: "all-complete", count: manifest.length })}\n`,
);
