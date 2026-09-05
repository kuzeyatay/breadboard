import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ensureHermesSourceHook } from "../scripts/hermes-python-source-hook.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Use standard Python for the hermetic fixture; the runtime smoke test also
// exercises the manifest with the actual Windows embedded interpreter.
const python = "python";
const manifest = JSON.parse(fs.readFileSync(
  path.join(desktopRoot, "runtime-v2/manifests/services.json"), "utf8",
));
const hermes = manifest.services.find(({ id }) => id === "hermes");

function sourceFixture(directory) {
  fs.mkdirSync(path.join(directory, "hermes_cli"), { recursive: true });
  fs.copyFileSync(path.resolve(desktopRoot, "../hermes-agent/breadboard_runtime.py"),
    path.join(directory, "breadboard_runtime.py"));
  fs.copyFileSync(path.resolve(desktopRoot, "../hermes-agent/hermes_cli/runtime_identity.py"),
    path.join(directory, "hermes_cli/runtime_identity.py"));
  for (const name of ["hermes_cli", "agent", "tools", "plugins", "tui_gateway"]) {
    fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.writeFileSync(path.join(directory, name, "__init__.py"), "");
  }
  fs.writeFileSync(path.join(directory, "model_tools.py"), "");
  fs.writeFileSync(path.join(directory, "hermes_cli/main.py"), "");
  return directory;
}

test("embedded parent and workers cannot fall back to stale packaged Hermes", (t) => {
  const embeddedRoot = path.join(desktopRoot, "build-resources/runtimes/python");
  if (process.platform !== "win32" || !fs.existsSync(path.join(embeddedRoot, "python.exe"))) {
    t.skip("requires the assembled Windows embedded Python runtime");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hermes-embedded-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, "python");
  fs.mkdirSync(runtime);
  // Copy only the interpreter's flat stdlib/native closure; no site packages,
  // developer config, credentials, or live runtime files are changed.
  for (const entry of fs.readdirSync(embeddedRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(exe|dll|zip|pyd|_pth)$/u.test(entry.name)) {
      fs.copyFileSync(path.join(embeddedRoot, entry.name), path.join(runtime, entry.name));
    }
  }
  const active = sourceFixture(path.join(root, "active app café/hermes-agent"));
  const stale = sourceFixture(path.join(root, "packaged old/hermes-agent"));
  const hook = path.join(runtime, "Lib/site-packages/breadboard-hermes.pth");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `${stale}\n`);
  const env = { ...process.env, HERMES_HOME: path.join(root, "home") };
  delete env.BREADBOARD_HERMES_SOURCE_ROOT;
  delete env.PYTHONPATH;
  const run = (args) => spawnSync(path.join(runtime, "python.exe"), args, {
    cwd: stale, env, encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  const launch = [path.join(active, "breadboard_runtime.py"), "--check-source"];
  const broken = run(launch);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /child processes would load a different source tree/u);
  assert.equal(ensureHermesSourceHook(runtime), true);
  assert.equal(ensureHermesSourceHook(runtime), false, "current hook stays untouched");
  const fixed = run(launch);
  assert.equal(fixed.status, 0, fixed.stderr);
  const identity = JSON.parse(fixed.stdout);
  assert.equal(identity.sourceRoot, active);
  assert.deepEqual(identity.parent, identity.child);
  assert.ok(Object.values(identity.child).every((origin) => origin.startsWith(active + path.sep)));
  assert.notEqual(run(["-c", "import hermes_cli"]).status, 0,
    "unscoped embedded Python must not select a packaged fallback");
  fs.rmSync(path.join(active, "model_tools.py"));
  assert.match(run(launch).stderr, /Hermes source mismatch: model_tools/u);
});

test("source identity stays frozen in a running process after files change", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hermes-identity-"));
  try {
    const active = sourceFixture(root);
    const probe = spawnSync(python, ["-c", [
      "import sys; sys.path.insert(0, sys.argv[1])",
      "from hermes_cli.runtime_identity import RUNTIME_SOURCE, source_identity",
      "from pathlib import Path",
      "before = dict(RUNTIME_SOURCE)",
      "Path(sys.argv[1], 'model_tools.py').write_text('CHANGED = True\\n', encoding='utf-8')",
      "assert RUNTIME_SOURCE == before",
      "assert source_identity(sys.argv[1])['sourceSha256'] != before['sourceSha256']",
    ].join("\n"), active], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    assert.equal(probe.status, 0, probe.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ["lean", "hot", "packaged"]) {
  test(`Hermes ${mode} launches the selected app source with isolated Python`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hermes-source-"));
    try {
      const appRoot = path.join(root, "active app café");
      const packageRoot = path.join(appRoot, "hermes-agent/hermes_cli");
      sourceFixture(path.join(appRoot, "hermes-agent"));
      fs.writeFileSync(path.join(packageRoot, "identity.py"), 'SOURCE = "active app"\n');
      fs.writeFileSync(path.join(packageRoot, "main.py"), [
        "import json, sys",
        "from hermes_cli.identity import SOURCE",
        "print(json.dumps({'source': SOURCE, 'arguments': sys.argv[1:]}))",
      ].join("\n"));
      const profile = hermes.launchProfiles.find(({ modes }) => modes.includes(mode));
      const args = profile.arguments.map((argument) => {
        if (argument.kind === "literal") return argument.value;
        if (argument.kind === "app-path") return path.join(appRoot, argument.path);
        assert.equal(argument.kind, "runtime-value");
        assert.equal(argument.value, "service-port");
        return "43199";
      });
      // Windows embedded Python ignores cwd/PYTHONPATH. -I -S reproduces that
      // isolation without relying on a developer's installed Hermes or config.
      const result = spawnSync(python, ["-I", "-S", ...args], {
        cwd: path.join(appRoot, profile.workingDirectory.path),
        env: { ...process.env, HERMES_HOME: path.join(root, "home") },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        source: "active app",
        arguments: ["serve", "--isolated", "--host", "127.0.0.1", "--port", "43199", "--no-open"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
