import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { planSpawn, quoteForCmd, resolveOnPath, expandsEnvironment } = await import(
  "../src/lib/agent-reach/spawn-plan.ts"
);

const notFound = (name) => `${name} is missing`;

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spawn-plan-"));
  return dir;
}

test("an executable is resolved to a concrete file on PATH", () => {
  const dir = fixtureDir();
  try {
    const exe = path.join(dir, "tool.exe");
    fs.writeFileSync(exe, "");
    const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };
    // The resolved path carries PATHEXT's casing (".EXE"), which is what the OS
    // itself does; the filesystem is case-insensitive, so only the case differs.
    assert.equal(resolveOnPath("tool", env)?.toLowerCase(), exe.toLowerCase());
    assert.equal(resolveOnPath("absent", env), null);

    const plan = planSpawn("tool", ["--flag", "value"], env, notFound);
    assert.equal(plan.command.toLowerCase(), exe.toLowerCase());
    assert.deepEqual(plan.argv, ["--flag", "value"]);
    assert.equal(plan.verbatim, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing executable is reported, never silently shelled out", () => {
  const plan = planSpawn("definitely-not-installed", [], { PATH: "" }, notFound);
  assert.deepEqual(plan, { error: "definitely-not-installed is missing" });
});

test("a .cmd shim is wrapped for cmd.exe with our own per-argument quoting", () => {
  const dir = fixtureDir();
  try {
    // A directory with a space is the case that breaks naive quoting, and the
    // case that actually occurs ("C:\\Program Files\\nodejs\\npm.cmd").
    const spaced = path.join(dir, "Program Files");
    fs.mkdirSync(spaced);
    const shim = path.join(spaced, "npm.cmd");
    const commandProcessor = path.join(spaced, "cmd.exe");
    fs.writeFileSync(shim, "");
    fs.writeFileSync(commandProcessor, "");
    const env = { PATH: spaced, PATHEXT: ".EXE;.CMD", ComSpec: commandProcessor };

    const plan = planSpawn(
      "npm",
      ["install", "-g", "https://example.com/a?x=1&y=2"],
      env,
      notFound,
    );
    assert.ok(!("error" in plan));
    assert.equal(plan.command.toLowerCase(), commandProcessor.toLowerCase());
    assert.equal(plan.verbatim, true);
    assert.deepEqual(plan.argv.slice(0, 3), ["/d", "/s", "/c"]);

    const line = plan.argv[3];
    // cmd /s strips exactly the outer quote pair, so it must be there or the
    // spaced shim path is split into two words.
    assert.ok(line.startsWith('""') && line.endsWith('""'), `missing outer quotes: ${line}`);
    assert.ok(line.toLowerCase().includes(quoteForCmd(shim).toLowerCase()));
    // The `&` must sit inside quotes, otherwise cmd reads it as a separator.
    assert.ok(line.includes('"https://example.com/a?x=1&y=2"'));
    assert.ok(!/[^"]&/.test(line.replaceAll('"https://example.com/a?x=1&y=2"', "")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("environment expansion is refused on the cmd.exe path", () => {
  const dir = fixtureDir();
  try {
    const shim = path.join(dir, "tool.cmd");
    fs.writeFileSync(shim, "");
    const env = { PATH: dir, PATHEXT: ".CMD" };
    assert.equal(expandsEnvironment("%USERPROFILE%"), true);
    assert.equal(expandsEnvironment("100% done"), false);
    const plan = planSpawn("tool", ["%USERPROFILE%"], env, notFound);
    assert.match(plan.error ?? "", /Environment-variable syntax/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("relative PATH entries and indirect executable files are never launch authority", (t) => {
  const dir = fixtureDir();
  try {
    const executable = path.join(dir, "tool.exe");
    fs.writeFileSync(executable, "");
    assert.equal(resolveOnPath("tool", { PATH: path.basename(dir), PATHEXT: ".EXE" }), null);

    const indirect = path.join(dir, "indirect.exe");
    try {
      fs.symlinkSync(executable, indirect, "file");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
        t.skip("This Windows account cannot create a symlink fixture.");
        return;
      }
      throw error;
    }
    assert.equal(resolveOnPath(indirect, { PATH: "", PATHEXT: ".EXE" }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setup actions only ever run argv the catalog owns", async () => {
  const setup = await import("../src/lib/agent-reach/setup.ts");
  const source = fs.readFileSync(
    fileURLToPath(new URL("../src/lib/agent-reach/setup.ts", import.meta.url)),
    "utf8",
  );
  const executorSource = fs.readFileSync(
    fileURLToPath(
      new URL("../scripts/runtime-v2-agent-reach-setup-executor.mjs", import.meta.url),
    ),
    "utf8",
  );
  // Neither trust context may reach a shell.
  assert.doesNotMatch(source, /^\s*shell:\s*(true|process\.platform)/m);

  const rejects = async (label, run, code) => {
    await assert.rejects(run, (error) => {
      assert.equal(error.code, code, `${label} rejected with ${error.code}`);
      return true;
    });
  };
  await rejects("arbitrary install", () => setup.install("rm -rf /"), "unknown_install_target");
  await rejects("arbitrary credential", () => setup.configure("evil", "x"), "unknown_credential");
  await rejects("empty credential", () => setup.configure("groq-key", "  "), "empty_value");
  await rejects("unknown browser", () => setup.importCookies("netscape", "twitter"), "unknown_browser");
  await rejects("unknown platform", () => setup.importCookies("chrome", "gmail"), "unknown_platform");

  const catalog = setup.setupCatalog();
  // The catalog must not leak the recipes themselves to the browser.
  assert.ok(catalog.installs.every((target) => !("steps" in target)));
  assert.deepEqual(catalog.platforms, ["bilibili", "xueqiu"]);
  // Podcast setup must install both the transcoder and Agent Reach's own
  // transcription helper; ffmpeg alone still leaves the channel unusable.
  assert.match(executorSource, /kind: "bundled-file"/);
  assert.match(executorSource, /transcribe_xiaoyuzhou\.sh/);
});

test("archive extraction names the system tar, not whatever PATH finds first", () => {
  const source = fs.readFileSync(
    fileURLToPath(
      new URL("../scripts/runtime-v2-agent-reach-setup-executor.mjs", import.meta.url),
    ),
    "utf8",
  );
  // Git Bash puts an MSYS tar on PATH that reads "C:\..." as a remote host and
  // fails with "Cannot connect to C: resolve failed". Windows' own bsdtar in
  // System32 handles zip and Windows paths, so it must be named by full path.
  assert.match(source, /SystemRoot[\s\S]{0,80}System32[\s\S]{0,40}tar\.exe/);
  assert.doesNotMatch(source, /run\(\s*"tar"/);
});

test("the settings panel only uses surfaces and variables that exist", () => {
  const dialog = fs.readFileSync(
    fileURLToPath(
      new URL("../src/app/components/hermes/agent-reach-settings-dialog.tsx", import.meta.url),
    ),
    "utf8",
  );
  const css = fs.readFileSync(
    fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
    "utf8",
  );

  // A modal that paints its own background instead of using the shared ones
  // renders transparent, with the page showing through it.
  assert.match(dialog, /bb-modal-backdrop/);
  assert.match(dialog, /bb-modal-panel/);
  assert.match(dialog, /aria-expanded=\{expanded\}/);
  assert.match(dialog, /Recommended setup/);
  assert.match(dialog, /Doctor details/);
  assert.match(dialog, /target\.channels\.includes\(channel\.channel\)/);
  assert.match(dialog, /field\.channels\.includes\(channel\.channel\)/);
  for (const channel of [
    "web",
    "rss",
    "v2ex",
    "youtube",
    "bilibili",
    "github",
    "twitter",
    "reddit",
    "facebook",
    "instagram",
    "xiaohongshu",
    "linkedin",
    "xueqiu",
    "xiaoyuzhou",
    "exa_search",
  ]) {
    assert.match(dialog, new RegExp(`\\b${channel}: \\{`), `${channel} needs a friendly guide`);
  }

  // Every custom property the panel references must be defined, or Tailwind's
  // arbitrary value resolves to nothing. `--paper` does not exist; the real ones
  // are --paper-bg / -surface / -raised / -strong.
  const used = [...dialog.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
  const undefined_ = [...new Set(used)].filter((name) => !css.includes(`  ${name}:`));
  assert.deepEqual(undefined_, [], `undefined CSS variables: ${undefined_.join(", ")}`);

  // Same for the neu-* surface classes.
  const classes = [...dialog.matchAll(/\b(neu-[a-z-]+)\b/g)].map((match) => match[1]);
  const missing = [...new Set(classes)].filter((name) => !css.includes(`.${name}`));
  assert.deepEqual(missing, [], `undefined classes: ${missing.join(", ")}`);
});

test("one settings button sits beside Agent Reach in the Agents tab", () => {
  const hub = fs.readFileSync(
    fileURLToPath(new URL("../src/app/components/hermes/command-hub.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(hub, /setAgentReachSettingsOpen\(true\)/);
  assert.match(hub, /<AgentSettingsButton\s*\n\s*name="Agent Reach"/);
  assert.match(hub, /<AgentReachSettingsDialog onClose=/);

  // Channels and run defaults are the same panel, reached from that one button.
  const dialog = fs.readFileSync(
    fileURLToPath(new URL("../src/app/components/hermes/agent-reach-settings-dialog.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(dialog, /AgentRunDefaults agentId="agent-reach"/);
});
