import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridge = await import("../src/lib/agent-browser/opencli-profile.ts");
const source = (relativePath) =>
  fs
    .readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");

/** The daemon's real /status shape, trimmed to what is read. */
const statusBody = (contextIds, profileRequired = false) => ({
  ok: true,
  daemonVersion: "1.8.6",
  extensionConnected: contextIds.length > 0,
  profileRequired,
  profiles: contextIds.map((contextId) => ({
    contextId,
    extensionConnected: true,
    extensionVersion: "1.0.22",
    pending: 0,
    lastSeenAt: 1787322194558,
  })),
});

const serving = (body) => async () => new Response(JSON.stringify(body), { status: 200 });
const noSleep = async () => {};

/**
 * A claim that can never touch the real `~/.breadboard`.
 *
 * `claimBreadboardProfile` remembers the profile it selected, and it defaults
 * to `process.env` — so a test that omitted `env` wrote its fixture contextId
 * into the user's actual data directory. That is how `late7`, a value invented
 * three tests down, ended up as the remembered production profile and quietly
 * disabled profile selection on this machine. Every call goes through here now,
 * and a test may still pass its own `env` when the record is what it is testing.
 */
function claimScoped(options) {
  return bridge.claimBreadboardProfile({ env: scratchEnv(), ...options });
}

function scratchEnv() {
  return { BREADBOARD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bridge-")) };
}

test("the daemon's profiles are read from its side-effect-free status API", async () => {
  const seen = [];
  const status = await bridge.readBridgeStatus({
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), header: init?.headers?.["X-OpenCLI"] });
      return new Response(JSON.stringify(statusBody(["aaa", "bbb"], true)), { status: 200 });
    },
  });

  assert.deepEqual(status, { contextIds: ["aaa", "bbb"], profileRequired: true });
  assert.equal(seen[0].url, "http://127.0.0.1:19825/status");
  assert.equal(seen[0].header, "1", "the daemon requires its own header");

  const sourceText = source("src/lib/agent-browser/opencli-profile.ts");
  assert.ok(
    !/doctor/.test(sourceText.replace(/^\/\/.*$/gm, "")),
    "doctor auto-starts the daemon, so reading state through it would change what it measures",
  );
});

test("a daemon that is not running reads as null, not as an empty list", async () => {
  assert.equal(
    await bridge.readBridgeStatus({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    null,
  );
  assert.equal(
    await bridge.readBridgeStatus({ fetchImpl: async () => new Response("", { status: 500 }) }),
    null,
  );
  // A running daemon with nothing connected is a different answer: the
  // extension may still be coming up, and that is worth waiting for.
  assert.deepEqual(
    await bridge.readBridgeStatus({ fetchImpl: serving(statusBody([])) }),
    { contextIds: [], profileRequired: false },
  );
});

test("the profile that appears after the launch is named and selected", async () => {
  const calls = [];
  const claim = await claimScoped({
    before: ["personal1"],
    fetchImpl: serving(statusBody(["personal1", "fresh42"])),
    execImpl: async (args) => {
      calls.push(args.join(" "));
      return { ok: true, message: "" };
    },
    sleepImpl: noSleep,
  });

  assert.deepEqual(claim, {
    status: "claimed",
    contextId: "fresh42",
    alias: bridge.BREADBOARD_PROFILE_ALIAS,
  });
  assert.deepEqual(calls, [
    `profile rename fresh42 ${bridge.BREADBOARD_PROFILE_ALIAS}`,
    `profile use ${bridge.BREADBOARD_PROFILE_ALIAS}`,
  ]);
});

test("a single connected browser needs no selecting and is not renamed on a guess", async () => {
  // The ordinary re-open: the daemon remembers a profile after its window
  // closes and the same profile directory reconnects under the same id, so
  // ours is already in the snapshot. Renaming whatever is connected would be
  // the one move that could point the agents at a personal browser.
  const claim = await claimScoped({
    before: ["twktfdp7"],
    fetchImpl: serving(statusBody(["twktfdp7"])),
    execImpl: async () => assert.fail("a single profile must never be renamed on a guess"),
    sleepImpl: noSleep,
    timeoutMs: 0,
  });

  assert.equal(claim.status, "not_needed");
  assert.match(claim.reason, /no choice to make/);
});

test("several unidentifiable browsers are reported rather than guessed between", async () => {
  const claim = await claimScoped({
    before: ["personal1", "personal2"],
    fetchImpl: serving(statusBody(["personal1", "personal2"], true)),
    execImpl: async () => assert.fail("nothing new appeared, so nothing may be renamed"),
    sleepImpl: noSleep,
    timeoutMs: 0,
  });

  assert.equal(claim.status, "skipped");
  assert.match(claim.reason, /2 browsers are connected/);
  assert.match(claim.reason, /opencli profile use/, "the person needs to know how to settle it");
});

test("a browser that never connects is reported as exactly that", async () => {
  const claim = await claimScoped({
    before: [],
    fetchImpl: serving(statusBody([])),
    execImpl: async () => assert.fail("nothing connected, so nothing may be renamed"),
    sleepImpl: noSleep,
    timeoutMs: 0,
  });

  assert.equal(claim.status, "skipped");
  assert.match(claim.reason, /did not connect/);
});

test("two profiles appearing at once are left alone rather than guessed between", async () => {
  const claim = await claimScoped({
    before: [],
    fetchImpl: serving(statusBody(["one", "two"])),
    execImpl: async () => assert.fail("an ambiguous profile must not be selected"),
    sleepImpl: noSleep,
  });

  assert.equal(claim.status, "skipped");
  assert.match(claim.reason, /none could be identified/);
});

test("waiting stops as soon as the browser connects", async () => {
  let poll = 0;
  const claim = await claimScoped({
    before: [],
    // The browser takes a moment to bring its extension up, as it really does.
    fetchImpl: async () => {
      poll += 1;
      return new Response(JSON.stringify(statusBody(poll < 3 ? [] : ["late7"])), { status: 200 });
    },
    execImpl: async () => ({ ok: true, message: "" }),
    sleepImpl: noSleep,
  });

  assert.equal(claim.status, "claimed");
  assert.equal(claim.contextId, "late7");
  assert.equal(poll, 3);
});

test("a claim that fails leaves the person a browser rather than an error", async () => {
  const noDaemon = await claimScoped({
    before: [],
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    execImpl: async () => assert.fail("nothing to rename without a daemon"),
    sleepImpl: noSleep,
    timeoutMs: 0,
  });
  assert.equal(noDaemon.status, "skipped");
  assert.match(noDaemon.reason, /daemon is not running/);

  const renameFailed = await claimScoped({
    before: [],
    fetchImpl: serving(statusBody(["fresh42"])),
    execImpl: async (args) =>
      args[1] === "rename"
        ? { ok: false, message: "unknown contextId" }
        : assert.fail("selection must not be attempted after naming failed"),
    sleepImpl: noSleep,
  });
  assert.equal(renameFailed.status, "skipped");
  assert.match(renameFailed.reason, /could not name the profile/);
});

test("the Runtime worker snapshots the bridge before launching Chromium", () => {
  const executor = source("scripts/runtime-v2-agent-browser-profile-executor.mjs");
  const body = executor.slice(executor.indexOf("executeAgentBrowserProfileOperation"));
  const snapshot = body.indexOf("readBridgeStatus");
  const launch = body.indexOf("spawnImpl(browser");
  const claim = body.indexOf("claimProfile");

  assert.ok(snapshot >= 0 && launch >= 0 && claim >= 0);
  assert.ok(snapshot < launch, "a snapshot taken after launch would already contain our profile");
  assert.ok(launch < claim, "there is nothing to claim until the browser exists");
});

test("the identified profile is remembered, so a re-open does not have to infer it again", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bridge-"));
  const env = { BREADBOARD_DATA_DIR: dir };

  assert.equal(bridge.rememberedContextId(env), null);

  // First open: a personal browser is already connected, ours is the new one.
  const first = await claimScoped({
    before: ["personal1"],
    fetchImpl: serving(statusBody(["personal1", "ours88"])),
    execImpl: async () => ({ ok: true, message: "" }),
    sleepImpl: noSleep,
    env,
  });
  assert.equal(first.status, "claimed");
  assert.equal(first.contextId, "ours88");
  assert.equal(bridge.rememberedContextId(env), "ours88");

  // Re-open: the daemon still lists ours from last time, so it is in the
  // snapshot and nothing looks fresh. Inference alone would give up here.
  const calls = [];
  const second = await claimScoped({
    before: ["personal1", "ours88"],
    fetchImpl: serving(statusBody(["personal1", "ours88"], true)),
    execImpl: async (args) => {
      calls.push(args.join(" "));
      return { ok: true, message: "" };
    },
    sleepImpl: noSleep,
    env,
  });
  assert.equal(second.status, "claimed", "a remembered profile must still be selectable");
  assert.equal(second.contextId, "ours88");
  assert.deepEqual(calls, [
    `profile rename ours88 ${bridge.BREADBOARD_PROFILE_ALIAS}`,
    `profile use ${bridge.BREADBOARD_PROFILE_ALIAS}`,
  ]);
});

test("a remembered profile that is not connected does not override what is", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bridge-"));
  const env = { BREADBOARD_DATA_DIR: dir };
  fs.mkdirSync(path.dirname(bridge.bridgeProfileRecordPath(env)), { recursive: true });
  fs.writeFileSync(bridge.bridgeProfileRecordPath(env), JSON.stringify({ contextId: "gone77" }), "utf8");

  const claim = await claimScoped({
    before: ["personal1", "personal2"],
    fetchImpl: serving(statusBody(["personal1", "personal2"], true)),
    execImpl: async () => assert.fail("a profile that is not connected must not be selected"),
    sleepImpl: noSleep,
    timeoutMs: 0,
    env,
  });

  assert.equal(claim.status, "skipped");
  assert.match(claim.reason, /2 browsers are connected/);
});

test("nothing is remembered when the claim did not fully succeed", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bridge-"));
  const env = { BREADBOARD_DATA_DIR: dir };

  const claim = await claimScoped({
    before: [],
    fetchImpl: serving(statusBody(["ours88"])),
    execImpl: async (args) =>
      args[1] === "rename" ? { ok: true, message: "" } : { ok: false, message: "daemon refused" },
    sleepImpl: noSleep,
    env,
  });

  assert.equal(claim.status, "skipped");
  assert.equal(
    bridge.rememberedContextId(env),
    null,
    "remembering a profile we failed to select would make the failure permanent",
  );
});

test("the profile is passed per invocation, since `profile use` alone does not take", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bridge-"));
  const env = { BREADBOARD_DATA_DIR: dir };

  // Nothing claimed yet: nothing to say.
  assert.deepEqual(
    await bridge.openCliProfileEnv({ env, fetchImpl: serving(statusBody(["ours88"])) }),
    {},
  );

  fs.mkdirSync(path.dirname(bridge.bridgeProfileRecordPath(env)), { recursive: true });
  fs.writeFileSync(bridge.bridgeProfileRecordPath(env), JSON.stringify({ contextId: "ours88" }), "utf8");

  assert.deepEqual(
    await bridge.openCliProfileEnv({ env, fetchImpl: serving(statusBody(["personal1", "ours88"])) }),
    { OPENCLI_PROFILE: "ours88" },
    "with several browsers connected, ours has to be named or every channel fails",
  );

  // A remembered profile that is not connected is a hard failure if passed:
  // `Browser profile "x" is not connected`. Better to say nothing.
  assert.deepEqual(
    await bridge.openCliProfileEnv({ env, fetchImpl: serving(statusBody(["personal1"])) }),
    {},
  );
  assert.deepEqual(
    await bridge.openCliProfileEnv({
      env,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    {},
  );

  // A person who set it themselves is not overridden.
  assert.deepEqual(
    await bridge.openCliProfileEnv({
      env: { ...env, OPENCLI_PROFILE: "mine" },
      fetchImpl: serving(statusBody(["personal1", "ours88"])),
    }),
    {},
  );
});

test("agent reach passes that environment to the commands it spawns", () => {
  const runManager = source("src/lib/agent-reach/run-manager.ts");
  assert.match(runManager, /run\.openCliEnv \?\?= await openCliProfileEnv\(\)/);
  assert.match(
    runManager,
    /const env = \{\s*\.\.\.agentReachEnv\(runtime\),\s*\.\.\.run\.openCliEnv,/s,
    "the overlay has to reach the spawned process, not just be computed",
  );
});
