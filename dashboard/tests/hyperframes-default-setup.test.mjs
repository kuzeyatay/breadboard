import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureHyperframesToolchain, targetCliVersion, toolchainStatus } from "../src/lib/hyperframes/setup.ts";
import { hyperframesEnv, hyperframesTemporaryDirectory, resolveBrowser, resolveToolchain, runtimeAvailability, writeCliShim } from "../src/lib/hyperframes/runtime.ts";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-default-"));
  const previous = process.env.BREADBOARD_REPO_ROOT;
  process.env.BREADBOARD_REPO_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_REPO_ROOT;
    else process.env.BREADBOARD_REPO_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (relative, content = "fixture") => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o755 });
    return file;
  };
  const manifest = write("hyperframes/packages/cli/package.json", '{"version":"0.7.94"}');
  write("hyperframes/skills/hyperframes/SKILL.md", "# Hyperframes");
  const env = {
    PATH: "",
    HYPERFRAMES_ROOT: path.join(root, "hyperframes"),
    HYPERFRAMES_CLI_ROOT: path.join(root, "data", "hyperframes-cli"),
    FFMPEG_PATH: write("media/ffmpeg"),
    FFPROBE_PATH: write("media/ffprobe"),
  };
  const install = () => {
    write("data/hyperframes-cli/node_modules/hyperframes/package.json", '{"version":"0.7.94"}');
    write("data/hyperframes-cli/node_modules/hyperframes/bin/hyperframes.mjs", "export {};");
    return { ok: true, message: "installed" };
  };
  return { root, env, manifest, write, install };
}

test("a fresh install is ready to start and prepares the CLI once", async (t) => {
  const { env, install } = fixture(t);
  assert.deepEqual(runtimeAvailability(env).missing, ["cli"]);
  const status = toolchainStatus({ found: true, version: "codex" }, env);
  assert.equal(status.ready, true);
  assert.equal(status.cli.found, false);
  assert.equal(status.cli.installable, true);
  assert.match(status.reason, /automatically/);
  assert.equal(status.ffprobe.found, true);
  let installations = 0;
  const prepare = async () => { installations += 1; return install(); };
  const signal = new AbortController().signal;
  const first = await ensureHyperframesToolchain(prepare, signal, env);
  assert.equal(first.cli.found, true);
  assert.equal(first.cli.version, "0.7.94");
  await ensureHyperframesToolchain(prepare, signal, env);
  assert.equal(installations, 1);
});

test("a Windows managed CLI path remains executable by Node", { skip: process.platform !== "win32" }, (t) => {
  const { root, env, install, write } = fixture(t);
  install();
  write("data/hyperframes-cli/node_modules/hyperframes/bin/hyperframes.mjs", 'console.log("0.7.94");');
  const toolchain = resolveToolchain({ ...env, HYPERFRAMES_CLI_ROOT: path.toNamespacedPath(env.HYPERFRAMES_CLI_ROOT) });
  assert.equal(toolchain.cli.found, true);
  const result = spawnSync(toolchain.cli.command, [...toolchain.cli.baseArgs, "--version"], {
    encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.7.94");
  const shim = writeCliShim(path.join(root, "shim"), toolchain.cli);
  const shell = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", "hyperframes --version"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: hyperframesEnv(toolchain, { SystemRoot: process.env.SystemRoot, PATH: "", PATHEXT: ".EXE;.CMD" }, [path.toNamespacedPath(shim)]),
  });
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout.trim(), "0.7.94");
});

test("Chromium temp paths stay short and separate for each worker attempt", (t) => {
  const { root } = fixture(t);
  const workspace = path.join(root, "runtime", "jobs", `job_${"a".repeat(64)}`, "attempts", "1", `worker_${"b".repeat(32)}`, "workspace");
  const temporary = hyperframesTemporaryDirectory(workspace, root);
  assert.ok(path.join(temporary, "puppeteer_dev_chrome_profile-XXXXXX").length < 240);
  fs.mkdirSync(temporary, { recursive: true });
  assert.ok(fs.mkdtempSync(path.join(temporary, "puppeteer_dev_chrome_profile-")));
  assert.equal(hyperframesTemporaryDirectory(workspace, root), temporary);
  assert.notEqual(hyperframesTemporaryDirectory(`${workspace}-other`, root), temporary);
});

test("setup failures are reported and a later run can retry", async (t) => {
  const { env, install } = fixture(t);
  const signal = new AbortController().signal;
  await assert.rejects(
    ensureHyperframesToolchain(async () => ({ ok: false, message: "Download failed", detail: "Package registry unavailable" }), signal, env),
    /Download failed\nPackage registry unavailable/,
  );
  await assert.rejects(
    ensureHyperframesToolchain(async () => ({ ok: true, message: "done" }), signal, env),
    /still unavailable/,
  );
  assert.equal((await ensureHyperframesToolchain(async () => install(), signal, env)).cli.found, true);
});

test("cancellation before or during setup prevents the video from starting", async (t) => {
  const { env, install } = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ensureHyperframesToolchain(async () => {
    assert.fail("a cancelled run must not install");
  }, controller.signal, env), { name: "AbortError" });
  const during = new AbortController();
  await assert.rejects(ensureHyperframesToolchain(async () => {
    during.abort();
    return install();
  }, during.signal, env), { name: "AbortError" });
});

test("missing FFprobe or source blocks setup before any download", async (t) => {
  const { env } = fixture(t);
  fs.rmSync(env.FFPROBE_PATH);
  assert.deepEqual(runtimeAvailability(env).missing, ["cli", "ffprobe"]);
  assert.equal(toolchainStatus({ found: true, version: "codex" }, env).ready, false);
  const unexpected = async () => assert.fail("must not install with missing prerequisites");
  await assert.rejects(ensureHyperframesToolchain(unexpected, new AbortController().signal, env), /ffprobe/);
  fs.rmSync(path.join(env.HYPERFRAMES_ROOT, "skills", "hyperframes", "SKILL.md"));
  await assert.rejects(ensureHyperframesToolchain(unexpected, new AbortController().signal, env), /clone/);
});

test("first-run setup never falls back to latest or a malformed version", async (t) => {
  const { env, manifest } = fixture(t);
  for (const version of ["latest", "0.7.94 && run", "0.7.94garbage", ""]) {
    fs.writeFileSync(manifest, JSON.stringify({ version }));
    assert.equal(targetCliVersion(env), "");
    assert.equal(toolchainStatus({ found: true, version: "codex" }, env).ready, false);
    await assert.rejects(ensureHyperframesToolchain(async () => {
      assert.fail("must not install an unpinned version");
    }, new AbortController().signal, env), /pinned CLI version/);
  }
});

test("media resolution honors specific overrides then Breadboard tools", (t) => {
  const { env, root, write } = fixture(t);
  const specific = write("custom/ffmpeg");
  assert.equal(resolveToolchain({ ...env, HYPERFRAMES_FFMPEG_PATH: specific }).ffmpeg.path, specific);
  assert.equal(resolveToolchain(env).ffmpeg.path, env.FFMPEG_PATH);
  assert.equal(resolveToolchain(env).ffprobe.path, env.FFPROBE_PATH);
  const binary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const desktop = write(`desktop/resources/bin/${binary}`);
  write(`agent-reach/.tools/bin/${binary}`);
  assert.equal(resolveToolchain({ ...env, FFMPEG_PATH: path.join(root, "missing") }).ffmpeg.path, desktop);
  fs.rmSync(desktop);
  fs.mkdirSync(desktop);
  assert.equal(resolveToolchain({ ...env, FFMPEG_PATH: "" }).ffmpeg.source, "agent-reach tools");
});

test("the default browser uses HyperFrames resolution while explicit overrides are honored", (t) => {
  const { env, write } = fixture(t);
  assert.equal(resolveBrowser(env).found, false);
  assert.equal(hyperframesEnv(resolveToolchain(env), env).HYPERFRAMES_BROWSER_PATH, undefined);
  const browser = write("custom/chromium");
  const configured = { ...env, HYPERFRAMES_BROWSER_PATH: browser };
  assert.equal(resolveBrowser(configured).path, browser);
  assert.equal(hyperframesEnv(resolveToolchain(configured), configured).HYPERFRAMES_BROWSER_PATH, browser);
});
