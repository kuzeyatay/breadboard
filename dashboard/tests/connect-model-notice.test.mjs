// A blank chat on a fresh install says that no model is connected and offers
// the Settings → Account panel, instead of letting the first message fail
// with a provider error.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { modelConnected, OPEN_SETTINGS_EVENT } from "../src/lib/model-connection.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const none = { chatgptSignedIn: false, providers: [], proxyAccounts: 0 };

test("a fresh install has nothing connected", () => {
  assert.equal(modelConnected(none), false);
});

test("any one of a ChatGPT sign-in, a configured key provider or a proxy account counts", () => {
  assert.equal(modelConnected({ ...none, chatgptSignedIn: true }), true);
  assert.equal(modelConnected({ ...none, proxyAccounts: 1 }), true);
  assert.equal(modelConnected({ ...none, providers: [{ kind: "anthropic", enabled: true, configured: true }] }), true);
});

test("the ChatGPT provider row never counts on its own, and neither does a disabled or unconfigured key", () => {
  // ChatMock reports the OAuth provider as configured whenever it is not
  // switched off, signed in or not; the account endpoint is the truth there.
  assert.equal(modelConnected({ ...none, providers: [{ kind: "chatgpt_oauth", enabled: true, configured: true }] }), false);
  assert.equal(modelConnected({ ...none, providers: [{ kind: "anthropic", enabled: false, configured: true }] }), false);
  assert.equal(modelConnected({ ...none, providers: [{ kind: "anthropic", enabled: true, configured: false }] }), false);
});

test("the notice sits above the greeting and opens the composer's Settings popover on the account tab", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(terminal, /<ConnectModelNotice \/>\s*<ChatGreetingEmptyState/);
  const notice = read("src/app/components/hermes/connect-model-notice.tsx");
  assert.match(notice, /new CustomEvent\(OPEN_SETTINGS_EVENT, \{ detail: "account" \}\)/);
  assert.match(notice, /if \(connected !== false\) return null/, "silent until the endpoints have answered");
  const composer = read("src/app/components/assistant-composer.tsx");
  assert.match(composer, /window\.addEventListener\(OPEN_SETTINGS_EVENT, open\)/);
  assert.match(composer, /setIntelligencePanel\('settings'\);\s*\};\s*window\.addEventListener\(OPEN_SETTINGS_EVENT/);
  assert.match(composer, /settingsButtonRef\.current\.getClientRects\(\)\.length === 0\) return;/, "a hidden side-chat composer stays quiet");
  assert.equal(OPEN_SETTINGS_EVENT, "breadboard:open-settings");
});

test("ChatMock's no-credentials error names the in-app fix, not a CLI command", () => {
  for (const file of ["chatmock/chatmock/upstream.py", "chatmock/chatmock/websocket_routes.py"]) {
    const source = fs.readFileSync(path.join(root, "..", file), "utf8");
    assert.doesNotMatch(source, /chatmock\.py login/, file);
    assert.match(source, /Open Settings → Account in Breadboard/, file);
  }
});
