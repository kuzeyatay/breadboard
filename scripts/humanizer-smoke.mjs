#!/usr/bin/env node
// The installed real-model smoke test, behind an explicit flag.
//
//   set BREADBOARD_HUMANIZER_SMOKE=1
//   npm run dev:humanizer                 (in another terminal, or via the app)
//   node scripts/humanizer-smoke.mjs
//   ... restart Breadboard ...
//   node scripts/humanizer-smoke.mjs --after-restart
//
// Nothing in CI runs this. It exists because the automated suites all use a
// fake model on purpose, and there is exactly one thing a fake cannot tell you:
// whether a real beam search over a real tokenizer still gives back the version
// number, the date, the URL and the inline code untouched.
//
// The `--after-restart` pass is the other half: it checks that the environment
// and the user-downloaded checkpoint are still there after the application has
// been stopped and started, which is what "the model cache survives an update"
// means in practice.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
loadDashboardEnv(repoRoot);

if (process.env.BREADBOARD_HUMANIZER_SMOKE?.trim() !== "1") {
  process.stdout.write(
    "[humanizer-smoke] skipped. Set BREADBOARD_HUMANIZER_SMOKE=1 to run the real-model smoke test.\n",
  );
  process.exit(0);
}

const { humanizerBaseUrl, humanizerServiceSecret, humanizerModelCache } = await import(
  pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "humanizer", "config.ts")).href
);

const afterRestart = process.argv.includes("--after-restart");
const base = humanizerBaseUrl(process.env);
const secret = humanizerServiceSecret(process.env);
if (!secret) {
  process.stderr.write("[humanizer-smoke] no service secret; is Breadboard's data directory writable?\n");
  process.exit(1);
}

const FIXTURE = [
  "---",
  "title: Release notes",
  "version: 2.4",
  "---",
  "",
  "# A Pivotal New Chapter",
  "",
  "The system represents a groundbreaking and transformative step forward in the rapidly evolving landscape of local knowledge software.",
  "",
  "Version 2.4 shipped on August 19, 2026. Read the [release report](https://example.com/releases/2.4).",
  "",
  "Run `npm run build` before publishing.",
  "",
  '> "Do not alter this quoted statement."',
  "",
  "The measured improvement was 18.5%.",
  "",
].join("\n");

const MUST_SURVIVE = [
  "---\ntitle: Release notes\nversion: 2.4\n---",
  "# ",
  "2.4",
  "August 19, 2026",
  "https://example.com/releases/2.4",
  "`npm run build`",
  '> "Do not alter this quoted statement."',
  "18.5%",
];

const GENERIC =
  "The system represents a groundbreaking and transformative step forward in the rapidly evolving landscape of local knowledge software.";

let failures = 0;
function check(name, ok, detail = "") {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures += 1;
}

async function call(route, init = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

// 1. Health.
let health;
try {
  health = await call("/health");
} catch (error) {
  process.stderr.write(`[humanizer-smoke] the service is not reachable at ${base}: ${error.message}\n`);
  process.exit(1);
}
check("the service answers /health", health.status === 200, `status ${health.status}`);
check(
  "the checkpoint is installed",
  health.body.modelInstalled === true,
  `cache ${humanizerModelCache(process.env)}`,
);
check("the service is not degraded", health.body.status !== "degraded", health.body.detail ?? "");
process.stdout.write(
  `      model ${health.body.modelId}@${health.body.modelRevision} on ${health.body.device}\n`,
);

if (afterRestart) {
  // 6. After a restart: the environment and the user-downloaded cache are
  // still valid, and the service still reports itself ready without any
  // re-download.
  check(
    "the model cache survived the restart",
    health.body.modelInstalled === true && health.body.modelState !== "not_installed",
    health.body.modelState,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// 2. Rewrite a short sample.
const requestId = `smoke${Date.now().toString(36)}`;
const rewrite = await call("/humanize", {
  method: "POST",
  body: JSON.stringify({ requestId, text: FIXTURE, mode: "natural" }),
});
check("the rewrite completed", rewrite.status === 200, `status ${rewrite.status}`);
check("the preservation gate passed", rewrite.body?.preservation?.passed === true);

const rewritten = String(rewrite.body?.rewrittenText ?? "");

// 3. Every protected literal is byte-for-byte identical.
for (const literal of MUST_SURVIVE) {
  check(`preserved exactly: ${JSON.stringify(literal.slice(0, 40))}`, rewritten.includes(literal));
}
check("no placeholder survived", !rewritten.includes("[[P"));

// 4. The prose actually changed.
check("the generic sentence was rewritten", !rewritten.includes(GENERIC));
check("the document is not simply the original", rewritten !== FIXTURE);
process.stdout.write(
  `      ${rewrite.body?.chunks?.rewritten}/${rewrite.body?.chunks?.total} sections rewritten, ` +
    `${rewrite.body?.chunks?.reverted} reverted, ${rewrite.body?.timingMs?.total}ms\n`,
);

// 5. The restart step is a person's job; say so rather than pretending.
process.stdout.write(
  [
    "",
    "Next: restart Breadboard (or `npm run dev:humanizer`), then run",
    "  node scripts/humanizer-smoke.mjs --after-restart",
    "to confirm the environment and the downloaded checkpoint are still valid.",
    "",
  ].join("\n"),
);

process.exit(failures === 0 ? 0 : 1);
