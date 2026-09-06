import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureChatMockSourceHook } from "../scripts/chatmock-python-source-hook.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(
  path.join(desktopRoot, "runtime-v2/manifests/services.json"), "utf8",
));
const chatmock = manifest.services.find(({ id }) => id === "chatmock");

function sourceFixture(directory, identity) {
  fs.mkdirSync(path.join(directory, "chatmock"), { recursive: true });
  fs.copyFileSync(path.resolve(desktopRoot, "../chatmock/breadboard_runtime.py"),
    path.join(directory, "breadboard_runtime.py"));
  fs.writeFileSync(path.join(directory, "chatmock/__init__.py"), "");
  fs.writeFileSync(path.join(directory, "chatmock/cli.py"), [
    "import json, sys",
    `IDENTITY = ${JSON.stringify(identity)}`,
    "def main(): print(json.dumps({'source': IDENTITY, 'arguments': sys.argv[1:]}))",
  ].join("\n"));
  return directory;
}

test("embedded ChatMock selects the app source instead of a stale staged package", (t) => {
  const embeddedRoot = path.join(desktopRoot, "build-resources/runtimes/python");
  if (process.platform !== "win32" || !fs.existsSync(path.join(embeddedRoot, "python.exe"))) {
    t.skip("requires the assembled Windows embedded Python runtime");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chatmock-embedded-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, "python");
  fs.mkdirSync(runtime);
  for (const entry of fs.readdirSync(embeddedRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(exe|dll|zip|pyd|_pth)$/u.test(entry.name)) {
      fs.copyFileSync(path.join(embeddedRoot, entry.name), path.join(runtime, entry.name));
    }
  }
  const active = sourceFixture(path.join(root, "active app café/chatmock"), "active");
  const stale = sourceFixture(path.join(root, "packaged old/chatmock"), "stale");
  const hook = path.join(runtime, "Lib/site-packages/breadboard-chatmock.pth");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `${stale}\n`);
  assert.equal(ensureChatMockSourceHook(runtime), true);
  assert.equal(ensureChatMockSourceHook(runtime), false, "current hook stays untouched");
  const env = { ...process.env };
  delete env.BREADBOARD_CHATMOCK_SOURCE_ROOT;
  delete env.PYTHONPATH;
  const result = spawnSync(path.join(runtime, "python.exe"), [
    path.join(active, "breadboard_runtime.py"), "serve", "--port", "43199",
  ], { cwd: stale, env, encoding: "utf8", windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    source: "active",
    arguments: ["serve", "--port", "43199"],
  });
  assert.notEqual(spawnSync(path.join(runtime, "python.exe"), [
    "-c", "import chatmock",
  ], { cwd: root, env, encoding: "utf8", windowsHide: true }).status, 0,
  "unscoped embedded Python must not select a staged fallback");
});

for (const mode of ["lean", "hot", "packaged"]) {
  test(`ChatMock ${mode} launches the selected app source`, () => {
    const profile = chatmock.launchProfiles.find(({ modes }) => modes.includes(mode));
    assert.equal(profile.arguments[0].kind, "app-path");
    assert.equal(profile.arguments[0].path, "chatmock/breadboard_runtime.py");
    assert.ok(profile.installProbe.files.some(({ authority, path: candidate }) =>
      authority === "app-root" && candidate === "chatmock/breadboard_runtime.py"));
  });
}
