import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const { createTwoFilesPatch } = require("diff");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.toString().replace(/\r\n/g, "\n");
const head = (file) => execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const checkpoint = JSON.parse(fs.readFileSync(path.join(root, "audits/agent-repairs-2026-11-06/build26-source-checkpoint.json"), "utf8"));
const sources = [
  "hermes-config/system/chat-core.md", "hermes-config/system/process-status.md",
  "dashboard/src/lib/hermes/process-status.ts", "dashboard/src/app/api/hermes/tools/process-status/route.ts",
  "dashboard/src/lib/telegram/client.ts", "dashboard/src/lib/telegram/format.ts",
  "dashboard/src/lib/speech/voice-prompt.ts", "hermes-agent/plugins/breadboard/__init__.py",
];
const tests = ["dashboard/tests/telegram-gateway-loop.test.mjs", "dashboard/tests/telegram-integration.test.mjs",
  "dashboard/tests/telegram-format.test.mjs", "dashboard/tests/chat-status-readability.test.mjs"];
const added = new Set(["dashboard/src/lib/telegram/format.ts", "dashboard/tests/telegram-format.test.mjs", "dashboard/tests/chat-status-readability.test.mjs"]);
const originalVoiceContract = `  'process-status': 'Use breadboard_process_status for requested upload, Learn, transcription, agent, workflow or other job status. Pass the user’s Garden wording unchanged, all_gardens:true only for an all-Gardens request, and kinds only for requested process types. Answer from returned summary/processes: stage, percentage, exact state and recorded errors. Clarify unmatched Gardens and disclose unreadable families. Never infer success, failure, cancellation or absence from memory, and keep the answer scoped to the requested jobs.',`;
function statusBlock(text) {
  const start = text.indexOf('    (\n        "breadboard_process_status",');
  const end = text.indexOf("\n    (\n", start + 1);
  if (start < 0 || end < 0) throw new Error("Cannot bound the owned status-tool schema");
  return { start, end, text: text.slice(start, end) };
}
const manifest = { frozenAt: new Date().toISOString(), sourceFiles: [], testFiles: [],
  state: "Shared source frozen for coordinated build27; no build or restart performed by this task.",
  ownership: "Only the process-status contract line in voice-prompt.ts and the breadboard_process_status tool definition in plugins/breadboard/__init__.py belong to this task. All other changes in those pre-existing dirty/untracked files are preserved.",
  baselineNote: "Initial working-tree bytes were not snapshotted. Clean-file baselines come from Git HEAD; shared-file baselines reconstruct only our edits in reverse. Normalized hashes use LF. The coordinator's build26 hashes are supplied where available; exact reconstructed snapshots are identified when they match those hashes.",
  activeResources: { providerRequests: 0, appChatsCreated: 0, telegramMessagesSent: 0, childProcesses: 0, cleanupDeadline: "All owned provider/test processes completed before this receipt." } };
let patch = "";
for (const file of [...sources, ...tests]) {
  const current = fs.readFileSync(path.join(root, file));
  const afterText = normalize(current);
  let before = null, basis = "new file";
  if (!added.has(file)) {
    if (file.endsWith("voice-prompt.ts")) {
      const line = afterText.split("\n").find((line) => line.startsWith("  'process-status':"));
      if (!line) throw new Error("Voice status contract is missing");
      before = Buffer.from(afterText.replace(line, originalVoiceContract));
      basis = "Reconstructed pre-change file: restore the exact process-status line read before editing; preserve all other current content.";
    } else if (file === "hermes-agent/plugins/breadboard/__init__.py") {
      const block = statusBlock(afterText);
      before = Buffer.from(afterText.slice(0, block.start) + statusBlock(normalize(head(file))).text + afterText.slice(block.end));
      basis = "Reconstructed pre-change file: restore only the status-tool definition (observed unchanged from HEAD before editing); preserve other pre-existing plugin changes.";
    } else { before = head(file); basis = "Git HEAD; inspected initial source had no other owned diff."; }
  }
  const expected = checkpoint.files.find((entry) => entry.file.replaceAll("\\", "/").endsWith(file))?.expected ?? null;
  let matchesBuild26 = before && expected ? sha(before) === expected : null;
  if (before && expected && !matchesBuild26) {
    const crlf = Buffer.from(normalize(before).replace(/\n/g, "\r\n"));
    if (sha(crlf) === expected) { before = crlf; matchesBuild26 = true; }
  }
  const beforePath = before ? path.join(directory, "before", file) : null;
  const afterPath = path.join(directory, "frozen", file);
  for (const [target, bytes] of [[beforePath, before], [afterPath, current]]) {
    if (!target) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  patch += createTwoFilesPatch(before ? `a/${file}` : "/dev/null", `b/${file}`, before ? normalize(before) : "", afterText, "", "", { context: 4 });
  const entry = { file, newFile: added.has(file), beforeBasis: basis, beforeSnapshot: beforePath,
    beforeSha256: before ? sha(before) : null, beforeNormalizedSha256: before ? sha(normalize(before)) : null,
    build26ExpectedSha256: expected, reconstructedBeforeMatchesBuild26: matchesBuild26,
    currentSha256: sha(current), currentNormalizedSha256: sha(afterText), frozenSnapshot: afterPath };
  manifest[sources.includes(file) ? "sourceFiles" : "testFiles"].push(entry);
}
fs.writeFileSync(path.join(directory, "owned.patch"), patch);
manifest.patch = { path: path.join(directory, "owned.patch"), sha256: sha(patch), note: "Owned changes only, normalized LF; do not use the full repository git diff for shared files." };
const live = JSON.parse(fs.readFileSync(path.join(directory, "results.json"), "utf8"));
manifest.validation = {
  focusedJs: { passed: 45, failed: 0, command: "node --experimental-strip-types --test dashboard/tests/telegram-format.test.mjs dashboard/tests/chat-status-readability.test.mjs dashboard/tests/telegram-gateway-loop.test.mjs dashboard/tests/process-status-tool.test.mjs dashboard/tests/response-style.test.mjs dashboard/tests/voice-turn-latency.test.mjs", isolatedDataDirectory: true },
  formatterTypecheck: { exitCode: 0, command: "node dashboard/node_modules/typescript/bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck dashboard/src/lib/telegram/format.ts" },
  pluginCallback: { passed: 1, failed: 0, file: "qa/chat-readability-20261107/test_process_status_callback.py", log: "qa/chat-readability-20261107/plugin-test.log", method: "Canonical hermes-agent/scripts/run_tests.sh with HERMES_PYTHON pointing to .venv/Scripts/python.exe and a unique --basetemp under this QA folder. Actual registered callback plus a loopback HTTP server.", initialEnvironmentIssue: "The first run failed before the test because the default pytest temp directory was inaccessible; the unique --basetemp run passed." },
  liveModel: { passed: live.results.filter((entry) => !entry.error && Object.values(entry.checks).every(Boolean)).length, total: live.results.length,
    path: "qa/chat-readability-20261107/results.json", sha256: sha(fs.readFileSync(path.join(directory, "results.json"))), method: live.method,
    limitation: "Exercises the production prompt builder and status reader with fixture chats, not a deployed Telegram end-to-end conversation. Earlier development samples exposed finished-chat noise and unavailable-status overclaiming; final samples passed after filtering and evidence-boundary fixes." },
  knownUnrelatedFailures: [
    "telegram-integration.test.mjs: 'a message goes through the same authenticated turn pipeline as the browser' expects prepareTelegramAttachments(settings.ownerUserId, message), but unchanged inbound.ts uses the ownerUserId local.",
    "telegram-integration.test.mjs: 'Telegram sits beside WhatsApp in Settings → Messaging' expects the phrase 'official Bot API', absent from unchanged settings-telegram.tsx.",
  ],
  deployment: "Not built or restarted. The coordinator owns build27 activation. Telegram gateway and Hermes processes need the new source/schema; the standalone dashboard needs rebuilding for its status route. Shared prompt files are read by the production prompt builder."
};
fs.writeFileSync(path.join(directory, "handoff.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ handoff: path.join(directory, "handoff.json"), sources: sources.length, tests: tests.length, live: manifest.validation.liveModel.passed,
  checkpointMatches: manifest.sourceFiles.filter((entry) => entry.build26ExpectedSha256).map((entry) => ({ file: entry.file, matches: entry.reconstructedBeforeMatchesBuild26 })) }));
