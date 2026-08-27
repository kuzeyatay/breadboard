import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateInboxZeroScope,
  validateSealedInboxZeroPaths,
} from "../scripts/runtime-v2-inbox-zero-service.mjs";
import { validateSealedPostizConfig } from "../../scripts/start-postiz-supervisor.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(dashboardRoot, "src");

function source(relativePath) {
  return readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");
}

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx|mjs)$/u.test(entry.name) ? [absolute] : [];
  });
}

function relative(absolute) {
  return path.relative(dashboardRoot, absolute).replaceAll("\\", "/");
}

test("Next cannot reach either Compose owner through a direct import", () => {
  const allowed = new Map([
    ["src/lib/socials-manager/coordinator-runtime.ts", [
      "./docker.ts",
      "./stack.ts",
    ]],
    ["src/lib/socials-manager/stack.ts", ["./docker.ts"]],
    ["src/lib/inbox-zero/stack.ts", ["../socials-manager/docker.ts"]],
    ["src/lib/inbox-zero/session.ts", [
      "../socials-manager/docker.ts",
      "./stack.ts",
    ]],
    ["src/lib/inbox-zero/service.ts", [
      "./session.ts",
      "./stack.ts",
    ]],
  ]);
  const processTargets = new Set([
    "src/lib/socials-manager/docker.ts",
    "src/lib/socials-manager/stack.ts",
    "src/lib/socials-manager/coordinator-runtime.ts",
    "src/lib/inbox-zero/stack.ts",
    "src/lib/inbox-zero/service.ts",
    "src/lib/inbox-zero/session.ts",
  ]);

  const violations = [];
  for (const absolute of sourceFiles(sourceRoot)) {
    const name = relative(absolute);
    const text = readFileSync(absolute, "utf8");
    for (const match of text.matchAll(/(?:from\s+|import\()["']([^"']+)["']/gu)) {
      const specifier = match[1];
      const target = specifier.startsWith("@/")
        ? relative(path.join(sourceRoot, specifier.slice(2)))
        : specifier.startsWith(".")
          ? relative(path.resolve(path.dirname(absolute), specifier))
          : null;
      if (!target || !processTargets.has(target)) continue;
      if (!(allowed.get(name) ?? []).includes(specifier)) violations.push(`${name} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);

  for (const name of [
    "src/lib/socials-manager/activation.ts",
    "src/lib/socials-manager/service.ts",
    "src/lib/inbox-zero/runtime-service.ts",
    "src/lib/inbox-zero/run-manager.ts",
    "src/app/api/socials-manager/stack/route.ts",
    "src/app/api/inbox-zero/setup/route.ts",
  ]) {
    assert.doesNotMatch(source(name), /node:child_process|\bspawn(?:Sync)?\s*\(|\bexecFile\s*\(/u, name);
  }
});

test("Postiz uses one authenticated scoped Runtime service and has no local fallback", () => {
  const activation = source("src/lib/socials-manager/activation.ts");
  const service = source("src/lib/socials-manager/service.ts");
  const stackRoute = source("src/app/api/socials-manager/stack/route.ts");
  assert.match(activation, /acquireServiceLease\("postiz-coordinator"/u);
  assert.match(activation, /scope:\s*input\.scope/u);
  assert.match(activation, /releaseSupervisorLease/u);
  assert.match(activation, /MAX_REQUEST_BYTES\s*=\s*8\s*\*\s*1024/u);
  assert.match(activation, /MAX_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024/u);
  assert.doesNotMatch(activation, /from\s+["']\.\/(?:stack|docker|coordinator-runtime)\.ts["']/u);
  assert.doesNotMatch(activation, /startStack\s*\(/u);
  assert.match(service, /const outcome: ActivationOutcome = await activateStack/u);
  assert.match(service, /withPostizCoordinatorServiceLease\(scope, "already-running-operation"/u);
  assert.match(stackRoute, /Buffer\.byteLength\(text, "utf8"\) > 8 \* 1024/u);

  const coordinator = source("../scripts/start-postiz-supervisor.mjs");
  assert.match(coordinator, /--port/u);
  assert.match(coordinator, /value\.type !== "stop"/u);
  assert.match(coordinator, /coordinator\.close\(\)/u);
});

test("Inbox Zero keeps the full mailbox turn inside one scoped stack lease", () => {
  const runManager = source("src/lib/inbox-zero/run-manager.ts");
  const client = source("src/lib/inbox-zero/client.ts");
  assert.match(runManager, /withInboxZeroStackLease\(scope, "active-mailbox-run"/u);
  assert.match(runManager, /ensureInboxZeroReady\([\s\S]*run\.abort\.signal/u);
  assert.match(runManager, /runAssistantTurn\([\s\S]*signal:\s*run\.abort\.signal/u);
  assert.match(runManager, /conversationPublicId/u);
  assert.match(runManager, /MAX_ANSWER_CHARS - run\.answerChars/u);
  assert.match(client, /MAX_STREAM_BYTES\s*=\s*2 \* 1024 \* 1024/u);
  assert.match(client, /MAX_SSE_FRAME_CHARS\s*=\s*256 \* 1024/u);
  assert.doesNotMatch(runManager, /from\s+["']\.\/(?:stack|service|session)\.ts["']/u);
});

test("Inbox Zero never reuses a minted mailbox credential across user scopes", () => {
  const controller = source("scripts/runtime-v2-inbox-zero-service.mjs");
  const service = source("src/lib/inbox-zero/service.ts");
  const runManager = source("src/lib/inbox-zero/run-manager.ts");
  assert.match(controller, /scopeUserId:\s*body\.scope\.userId/u);
  assert.match(service, /__breadboardInboxZeroSessions\?: Map<number, CachedSession>/u);
  assert.match(service, /sessions\.get\(input\.scopeUserId\)/u);
  assert.match(service, /cacheSession\(input\.scopeUserId, session\)/u);
  assert.match(service, /MAX_CACHED_USER_SCOPES\s*=\s*64/u);
  assert.doesNotMatch(service, /__breadboardInboxZeroSession\?: CachedSession/u);
  assert.match(runManager, /const key = `\$\{run\.userId\}:\$\{input\.conversationKey \?\? run\.runId\}`/u);
  assert.match(runManager, /MAX_CHAT_CONTEXTS\s*=\s*1_024/u);
});

test("Inbox Zero controller seals paths, re-adopts a reachable stack, and only explicit stop runs down", () => {
  const service = source("scripts/runtime-v2-inbox-zero-service.mjs");
  assert.match(service, /validateSealedInboxZeroPaths\(config, appRoot\)/u);
  assert.match(service, /response\.body\?\.getReader\(\)/u);
  assert.match(service, /serializeResidentLease/u);
  assert.match(service, /if \(setup\.stack\?\.reachable\) await holdResidentLease\(\)/u);
  assert.match(service, /routePath === "\/v1\/status"/u);
  assert.match(service, /routePath === "\/v1\/ensure"/u);
  assert.match(service, /routePath === "\/v1\/setup"/u);
  assert.match(service, /if \(action === "stop"\)[\s\S]*modules\.stack\.stopStack\(config\)/u);
  const stopHook = service.slice(service.indexOf("onStop: async"));
  assert.doesNotMatch(stopHook, /stopStack\s*\(|compose\s+down/u);
  assert.match(stopHook, /releaseResidentLease\(\)/u);
});

test("Inbox Zero rejects forged scopes and caller-selected roots", () => {
  assert.doesNotThrow(() => validateInboxZeroScope({ userId: 7, runId: "run-1" }));
  assert.throws(
    () => validateInboxZeroScope({ userId: 7, runId: "run-1", extra: true }),
    /scope is invalid/u,
  );
  assert.throws(
    () => validateInboxZeroScope({ userId: 0 }),
    /valid Inbox Zero user/u,
  );

  const root = path.join(tmpdir(), "breadboard-inbox-zero-contract");
  const appRoot = path.join(root, "app");
  const dataRoot = path.join(root, "data");
  const stateDir = path.join(dataRoot, "inbox-zero");
  const valid = {
    cloneRoot: path.join(appRoot, "inbox-zero"),
    stateDir,
    overrideFile: path.join(stateDir, "docker-compose.breadboard.yaml"),
    credentialsFile: path.join(stateDir, "credentials.json"),
    baseUrl: "http://localhost:4021",
    projectName: "breadboard-inbox-zero",
    ports: { web: 4021, postgres: 5442, redis: 6390, redisHttp: 8089 },
  };
  const env = { BREADBOARD_REPO_ROOT: appRoot, BREADBOARD_DATA_DIR: dataRoot };
  assert.doesNotThrow(() => validateSealedInboxZeroPaths(valid, appRoot, env));
  assert.throws(
    () => validateSealedInboxZeroPaths({ ...valid, cloneRoot: path.join(root, "foreign") }, appRoot, env),
    /clone root escaped/u,
  );
  assert.throws(
    () => validateSealedInboxZeroPaths({ ...valid, baseUrl: "https://example.com" }, appRoot, env),
    /web origin escaped loopback/u,
  );
  assert.throws(
    () => validateSealedInboxZeroPaths({ ...valid, projectName: "foreign" }, appRoot, env),
    /project identity is not sealed/u,
  );
});

test("Postiz seals its Compose identity, state, clone, and web origin", () => {
  const root = path.join(tmpdir(), "breadboard-postiz-contract");
  const appRoot = path.join(root, "app");
  const dataRoot = path.join(root, "data");
  const stateDir = path.join(dataRoot, "postiz");
  const valid = {
    cloneRoot: path.join(appRoot, "postiz-app"),
    stateDir,
    overrideFile: path.join(stateDir, "docker-compose.breadboard.yaml"),
    credentialsFile: path.join(stateDir, "credentials.json"),
    baseUrl: "http://localhost:4007",
    projectName: "breadboard-postiz",
  };
  const env = { BREADBOARD_REPO_ROOT: appRoot, BREADBOARD_DATA_DIR: dataRoot };
  assert.doesNotThrow(() => validateSealedPostizConfig(valid, appRoot, env));
  assert.throws(
    () => validateSealedPostizConfig({ ...valid, stateDir: path.join(root, "foreign") }, appRoot, env),
    /mutable state escaped/u,
  );
  assert.throws(
    () => validateSealedPostizConfig({ ...valid, projectName: "foreign" }, appRoot, env),
    /project identity is not sealed/u,
  );
  assert.throws(
    () => validateSealedPostizConfig({ ...valid, baseUrl: "http://example.com:4007" }, appRoot, env),
    /web origin escaped loopback/u,
  );
});

test("neither project can delete volumes, prune the engine, or globally stop WSL", () => {
  const executionSources = [
    source("src/lib/socials-manager/docker.ts"),
    source("src/lib/socials-manager/stack.ts"),
    source("src/lib/inbox-zero/stack.ts"),
    source("scripts/runtime-v2-inbox-zero-service.mjs"),
    source("../scripts/start-postiz-supervisor.mjs"),
  ].join("\n");
  assert.doesNotMatch(executionSources, /["']--volumes["']|["']-v["']|\b(?:docker|podman)\s+(?:system\s+)?prune\b|\bwsl(?:\.exe)?\s+--shutdown\b/iu);
  assert.match(source("src/lib/socials-manager/stack.ts"), /"down"/u);
  assert.match(source("src/lib/inbox-zero/stack.ts"), /"down"/u);
});
