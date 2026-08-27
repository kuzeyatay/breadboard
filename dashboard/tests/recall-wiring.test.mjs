import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECALL_TOOLS,
  RECALL_CONTROL_TOOLS,
  allowedToolsForSurface,
  isRecallEnabled,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { buildEngineArgs, enginePort } from "../src/lib/recall/engine.ts";
import { loadRecallConfig } from "../src/lib/recall/config.ts";
import { parseInstallStatus, platformPackage } from "../src/lib/recall/install.ts";
import { RecallClient, normalizeTimeExpression } from "../src/lib/recall/client.ts";
import {
  readStoredRecallApiKey,
  recallApiKeyPath,
  resolveRecallApiKey,
} from "../src/lib/recall/api-key.ts";
import { DEFAULT_RECALL_SETTINGS } from "../src/lib/recall/policy.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A throwaway Recall home, so key files never touch the real one. */
function temporaryRecallConfig(env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "recall-key-"));
  return loadRecallConfig({ RECALL_HOME: home, ...env });
}

test("Recall exposes exactly the six intended tools", () => {
  assert.deepEqual([...RECALL_TOOLS].sort(), [
    "recall_activity",
    "recall_control",
    "recall_frame_context",
    "recall_meetings",
    "recall_search",
    "recall_status",
  ]);
  // Only one of them changes anything.
  assert.deepEqual([...RECALL_CONTROL_TOOLS], ["recall_control"]);
});

test("Recall offers no UI automation, pipe execution, or export", () => {
  // These are screenpipe capabilities Breadboard deliberately does not wrap:
  // they act on the computer or write files outside the chat.
  const forbidden = ["element", "pipe", "click", "type", "export", "delete", "install", "team"];
  for (const tool of RECALL_TOOLS) {
    for (const bad of forbidden) {
      assert.ok(!tool.includes(bad), tool + " must not expose a " + bad + " operation");
    }
  }
});

test("Quartz AI never receives Recall tools; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of RECALL_TOOLS) {
    assert.ok(!quartz.includes(tool), "quartz_ai must not receive " + tool);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of RECALL_TOOLS) {
      assert.ok(allowed.includes(tool), surface + " should receive " + tool);
    }
  }
});

test("the feature switch removes the tools entirely", () => {
  assert.equal(isRecallEnabled({}), true, "absent means enabled");
  assert.equal(isRecallEnabled({ RECALL_ENABLED: "false" }), false);
  assert.equal(isRecallEnabled({ RECALL_ENABLED: "0" }), false);
  assert.equal(isRecallEnabled({ RECALL_ENABLED: "on" }), true);
});

test("every Recall tool is brokered, so none can be inherited by default", () => {
  for (const tool of RECALL_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), tool + " must be in BROKERED_TOOLS");
  }
});

// The failure this repo has hit before: a tool wired on the Breadboard side but
// never registered with the runtime, so the model is never offered it.
test("every Recall tool is registered in the Hermes plugin, both places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const manifestEntries = manifest
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
  for (const tool of RECALL_TOOLS) {
    assert.ok(
      manifestEntries.includes(tool),
      tool + " missing from plugin.yaml provides_tools",
    );
    assert.ok(
      plugin.includes('"' + tool + '"'),
      tool + " missing from the _TOOLS registry in __init__.py",
    );
  }
  // The tools must route somewhere the dashboard actually serves.
  assert.ok(plugin.includes('"/api/hermes/tools/recall"'));
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "recall", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );
});

test("the permission handshake is symmetric between plugin and route", () => {
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "recall", "route.ts"),
    "utf8",
  );
  // The route answers 428 with this code; the plugin must recognize that exact
  // code, or asking the user silently degrades into a plain failure.
  assert.ok(plugin.includes('"recall_permission_required"'));
  assert.ok(route.includes("recall_permission_required"));
  // And the plugin must send back the flag the route checks for.
  assert.ok(plugin.includes('payload["permissionGranted"] = True'));
  assert.ok(route.includes("body.permissionGranted === true"));
});

test("engine arguments carry the privacy choices through to the recorder", () => {
  const config = loadRecallConfig({ RECALL_HOME: "/tmp/recall-test" });
  const args = buildEngineArgs(
    {
      ...DEFAULT_RECALL_SETTINGS,
      captureEnabled: true,
      captureAudio: false,
      excludedWindows: ["1Password", "Slack::#hr"],
    },
    config,
  );
  assert.equal(args[0], "record");
  assert.ok(args.includes("--disable-audio"), "audio off must reach the recorder");
  // One flag per exclusion, each as its own argv item (never shell-joined).
  const flags = args.filter((arg) => arg === "--ignored-windows");
  assert.equal(flags.length, 2);
  assert.ok(args.includes("1Password"));
  assert.ok(args.includes("Slack::#hr"));

  const withAudio = buildEngineArgs(
    { ...DEFAULT_RECALL_SETTINGS, captureEnabled: true, captureAudio: true },
    config,
  );
  assert.ok(!withAudio.includes("--disable-audio"));
  assert.ok(!withAudio.includes("--ignored-windows"));
});

test("Next neither launches Recall nor sends its engine key over Runtime control", () => {
  const engine = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "recall", "engine.ts"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "recall", "runtime-service.ts"),
    "utf8",
  );
  const apiKey = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "recall", "api-key.ts"),
    "utf8",
  );
  assert.doesNotMatch(engine, /child_process|\bspawn\s*\(|process\.kill/);
  assert.doesNotMatch(runtime, /ensureRecallApiKey|SCREENPIPE_API_KEY|RECALL_API_KEY/);
  assert.doesNotMatch(apiKey, /randomBytes|writeFile/);
  assert.match(runtime, /authorization:\s*`Bearer \$\{target\.token\}`/);
  assert.match(runtime, /"x-breadboard-user-id": String\(userId\)/);
});

test("opening the app has a route to announce itself to, and a mount that does", () => {
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "recall", "autostart", "route.ts"),
    ),
    "the auto-start route must exist",
  );
  // Mounted in the root layout rather than a page, so the announcement does not
  // depend on which part of Breadboard the user happens to open.
  const layout = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "layout.tsx"),
    "utf8",
  );
  assert.ok(layout.includes("RecallAutoStart"), "auto-start is never mounted");
  assert.ok(layout.includes("<RecallAutoStart />"), "auto-start is imported but not rendered");
  const component = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "components", "recall-autostart.tsx"),
    "utf8",
  );
  const lifecycle = fs.readFileSync(
    path.join(
      repoRoot,
      "dashboard",
      "src",
      "app",
      "components",
      "recall-autostart-lifecycle.ts",
    ),
    "utf8",
  );
  assert.ok(component.includes("announceRecallAutostart"));
  assert.ok(lifecycle.includes("/api/recall/autostart"));
});

test("the engine port follows the configured base URL", () => {
  assert.equal(enginePort(loadRecallConfig({})), 3030);
  assert.equal(enginePort(loadRecallConfig({ RECALL_BASE_URL: "http://127.0.0.1:3999" })), 3999);
  // A malformed value falls back rather than producing a NaN port.
  assert.equal(enginePort(loadRecallConfig({ RECALL_BASE_URL: "not a url" })), 3030);
});

test("config caps are clamped and the home is never left undefined", () => {
  const config = loadRecallConfig({ RECALL_MAX_RESULTS: "9999", RECALL_HOME: "/tmp/recall-test" });
  assert.equal(config.maxResults, 20, "an out-of-range cap falls back to the default");
  assert.equal(config.home, "/tmp/recall-test");
  assert.ok(config.dataDir.includes("recall-test"));
  assert.equal(loadRecallConfig({ RECALL_ENABLED: "false" }).enabled, false);
});

test("an install whose writer died is reported as stalled, not as progress", () => {
  const now = Date.parse("2026-08-06T10:00:00Z");
  const fresh = parseInstallStatus(
    JSON.stringify({
      phase: "installing",
      message: "Downloading",
      updatedAt: "2026-08-06T09:59:50Z",
      pid: 4242,
    }),
    { now, isAlive: () => true },
  );
  assert.equal(fresh.stalled, false);

  const writerGone = parseInstallStatus(
    JSON.stringify({
      phase: "installing",
      message: "Downloading",
      updatedAt: "2026-08-06T09:59:50Z",
      pid: 4242,
    }),
    { now, isAlive: () => false },
  );
  assert.equal(writerGone.stalled, true, "a dead installer must not look like progress");

  const overdue = parseInstallStatus(
    JSON.stringify({
      phase: "installing",
      message: "Downloading",
      updatedAt: "2026-08-06T09:00:00Z",
    }),
    { now },
  );
  assert.equal(overdue.stalled, true);

  // A settled phase is allowed to sit still forever.
  const done = parseInstallStatus(
    JSON.stringify({
      phase: "installed",
      message: "Capture engine installed.",
      updatedAt: "2026-08-01T09:00:00Z",
    }),
    { now },
  );
  assert.equal(done.stalled, false);
  assert.equal(parseInstallStatus("not json"), null);
  assert.equal(parseInstallStatus(JSON.stringify({ phase: "installing" })), null);
});

test("only platforms screenpipe publishes a binary for are supported", () => {
  assert.equal(platformPackage("win32", "x64"), "@screenpipe/cli-win32-x64");
  assert.equal(platformPackage("darwin", "arm64"), "@screenpipe/cli-darwin-arm64");
  assert.equal(platformPackage("linux", "arm64"), null);
  assert.equal(platformPackage("freebsd", "x64"), null);
});

// The engine answers 403 to every read without a bearer, and only /health is
// open — so an unkeyed client looks healthy in the settings tab while every
// question about the day fails. These three tests pin the whole key path.
test("the Runtime-minted key is reused by every dashboard reader", () => {
  const config = temporaryRecallConfig();
  assert.equal(readStoredRecallApiKey(config), null, "nothing exists before the first start");

  const nativeKey = "sp-0123456789abcdef0123456789abcdef";
  fs.writeFileSync(recallApiKeyPath(config), `${nativeKey}\n`, "utf8");
  assert.equal(readStoredRecallApiKey(config), nativeKey);
  assert.equal(resolveRecallApiKey(config), nativeKey);
  assert.equal(resolveRecallApiKey(config), nativeKey, "reads must never rotate the key");
  assert.equal(fs.readFileSync(recallApiKeyPath(config), "utf8").trim(), nativeKey);
});

test("a configured key wins, and a corrupt file is not passed on as one", () => {
  const configured = temporaryRecallConfig({ RECALL_API_KEY: "sp-operators-own-key" });
  assert.equal(resolveRecallApiKey(configured), "sp-operators-own-key");
  assert.equal(fs.existsSync(recallApiKeyPath(configured)), false, "nothing to mint, nothing to write");

  // Whitespace or control characters would ride into an HTTP header and a
  // child process environment; a file like that counts as absent.
  const corrupt = temporaryRecallConfig();
  fs.writeFileSync(recallApiKeyPath(corrupt), "not a key\nwith newlines\n", "utf8");
  assert.equal(readStoredRecallApiKey(corrupt), null);
});

test("the client authenticates every read, because the engine rejects unkeyed ones", async () => {
  const config = temporaryRecallConfig();
  const key = "sp-fedcba9876543210fedcba9876543210";
  fs.writeFileSync(recallApiKeyPath(config), `${key}\n`, "utf8");

  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), authorization: init.headers.Authorization ?? null });
    return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new RecallClient(config);
    await client.search({ query: "anything", limit: 1 });
    await client.meetings({ limit: 1 });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.equal(call.authorization, `Bearer ${key}`, `${call.url} was sent unauthenticated`);
  }
});

test("everyday time phrasing is translated into what the engine accepts", () => {
  assert.equal(normalizeTimeExpression("yesterday"), "1d ago");
  assert.equal(normalizeTimeExpression("today"), "0d ago");
  assert.equal(normalizeTimeExpression("2026-08-06"), "2026-08-06T00:00:00Z");
  // Expressions the engine already understands pass through untouched.
  assert.equal(normalizeTimeExpression("3h ago"), "3h ago");
  assert.equal(normalizeTimeExpression("now"), "now");
  assert.equal(normalizeTimeExpression("  "), undefined);
  assert.equal(normalizeTimeExpression(undefined), undefined);
});
