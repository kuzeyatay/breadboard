import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { CodeDockManager } from "../src/main/code-dock";

type Request = { id: number; op: string; [key: string]: unknown };
class FakeWindow extends EventEmitter {
  destroyed = false;
  closeAttempts = 0;
  isDestroyed() { return this.destroyed; }
  isFocused() { return true; }
  getNativeWindowHandle() { const result = Buffer.alloc(8); result.writeBigUInt64LE(123n); return result; }
  close() { this.closeAttempts++; let canceled = false; this.emit("close", { preventDefault() { canceled = true; } }); if (!canceled) this.destroyed = true; }
}
class FakeContents extends EventEmitter {
  readonly id = 42;
  url = "https://breadboard.test/code";
  session = { fetch: async () => new Response("{}", { status: 404 }) };
  getURL() { return this.url; }
  isDestroyed() { return false; }
}
class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  requests: Request[] = [];
  unref() { return this; }
  kill() { throw Error("The editor or helper must never be force-killed during release."); }
  reply(request: Request, ok = true) { this.stdout.write(JSON.stringify({ id: request.id, ok, result: {}, error: ok ? undefined : "restore blocked" }) + "\n"); }
}
const until = async (probe: () => boolean, label: string) => {
  const end = Date.now() + 2000;
  while (!probe()) { if (Date.now() > end) throw Error("Timed out: " + label); await new Promise(resolve => setTimeout(resolve, 5)); }
};
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "Code.exe"); fs.writeFileSync(executable, "test");
  const helpers: FakeChild[] = [], launches: { executable: string; args: string[]; options: Record<string, unknown> }[] = [];
  const control = { attach: true, exit: true, failExit: false, editorExit: null as number | null, diagnostic: "",
    launchOutcomes: [] as { attach: boolean; editorExit: number | null; diagnostic: string }[] };
  const source = path.resolve(__dirname, "../src/main/code-dock.js");
  const realRequire = createRequire(source);
  const module = { exports: {} as { CodeDockManager: typeof CodeDockManager } };
  const downloads: string[] = [];
  const electron = { app: { getPath: () => root }, dialog: { showErrorBox: () => {} },
    net: { fetch: async (input: unknown) => { downloads.push(String(input)); throw Error("Unexpected network request"); } } };
  const spawn = (target: string, args: string[], options: Record<string, unknown>) => {
    const child = new FakeChild();
    const outcome = control.launchOutcomes[launches.length] ?? control;
    if (path.basename(target) !== "vscode-dock.exe") {
      launches.push({ executable: target, args, options });
      process.nextTick(() => {
        child.emit("spawn");
        if (outcome.editorExit !== null) process.nextTick(() => { child.stderr.write(outcome.diagnostic); child.emit("exit", outcome.editorExit); });
      }); return child;
    }
    helpers.push(child);
    let buffer = "";
    child.stdin.on("data", value => {
      buffer += String(value);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, newline)) as Request; buffer = buffer.slice(newline + 1);
        child.requests.push(request);
        if (request.op === "attach" && !outcome.attach || request.op === "exit" && !control.exit) continue;
        process.nextTick(() => {
          child.reply(request, !(request.op === "exit" && control.failExit));
          if (request.op === "exit" && !control.failExit) process.nextTick(() => child.emit("exit", 0));
        });
      }
    });
    return child;
  };
  const requireMock = (name: string) => {
    if (name === "electron") return electron;
    if (name === "node:child_process") return { spawn };
    if (name === "node:fs") return { ...fs, existsSync: (file: fs.PathLike) => String(file).endsWith("vscode-dock.exe") || fs.existsSync(file) };
    return realRequire(name);
  };
  new Function("require", "module", "exports", "__dirname", "__filename", fs.readFileSync(source, "utf8"))(requireMock, module, module.exports, path.dirname(source), source);
  const manager = new module.exports.CodeDockManager({ stateRoot: root, payloadRoot: root }, [executable]);
  const window = new FakeWindow(), contents = new FakeContents();
  const request = (action: Parameters<CodeDockManager["request"]>[2]) => manager.request(contents as never, window as never, action);
  const sync = (visible: boolean) => manager.sync(contents.id, window as never, { x: 0, y: 32, width: 1200, height: 768 }, visible);
  t.after(async () => { control.exit = true; control.failExit = false; await manager.close(); });
  const cacheManaged = () => {
    const commit = "a".repeat(40), managed = path.join(root, "versions", commit, "Code.exe");
    fs.mkdirSync(path.dirname(managed), { recursive: true }); fs.writeFileSync(managed, "test");
    fs.writeFileSync(path.join(root, "managed.json"), JSON.stringify({ commit }));
    return managed;
  };
  return { manager, window, contents, request, sync, helpers, launches, control, root, downloads, cacheManaged };
}

test("repeated open requests launch one dedicated workspace with an isolated theme profile", async t => {
  const f = fixture(t);
  f.request("open"); f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0]!.args[0], "--new-window");
  assert.deepEqual(JSON.parse(fs.readFileSync(f.launches[0]!.args[1]!, "utf8")), { folders: [] });
  assert.equal(f.launches[0]!.options.detached, true);
  assert.equal(f.launches[0]!.options.windowsHide, false);
  const env = f.launches[0]!.options.env as Record<string, string>;
  assert.equal(Object.keys(env).some(name => name !== "VSCODE_PORTABLE" && /^(?:ELECTRON_|VSCODE_|NODE_OPTIONS$)/.test(name)), false);
  assert.equal(env.VSCODE_PORTABLE, path.join(f.root, "profiles", "installed-stable"));
  assert.equal(f.launches[0]!.args[2], "--user-data-dir");
});

test("a Garden opens exactly its authenticated repository in the dedicated workspace", async t => {
  const f = fixture(t);
  const repository = path.join(f.root, "Project with spaces");
  fs.mkdirSync(repository); fs.writeFileSync(path.join(repository, ".git"), "gitdir: ../worktree");
  f.contents.url += "?garden=my-garden";
  f.contents.session.fetch = async () => Response.json({ repository: { gardenSlug: "my-garden", path: repository } });
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "repository docked");
  assert.deepEqual(JSON.parse(fs.readFileSync(f.launches[0]!.args[1]!, "utf8")), { folders: [{ path: await fs.promises.realpath(repository), name: "Project with spaces" }] });
});

test("an unavailable Garden never launches an empty or different repository", async t => {
  const f = fixture(t); f.contents.url += "?garden=missing";
  f.contents.session.fetch = async () => Response.json({ error: "This Garden could not be found." }, { status: 404 });
  f.request("open");
  await until(() => f.request("status").phase === "error", "repository rejected");
  assert.equal(f.launches.length, 0);
  assert.match(f.request("status").error!, /Garden could not be found/);
});

test("Breadboard theme changes update the open Code profile without relaunching its editor", async t => {
  const f = fixture(t); f.manager.setTheme("dark"); f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  const settings = path.join(f.launches[0]!.args[3]!, "User", "settings.json");
  assert.equal(JSON.parse(fs.readFileSync(settings, "utf8"))["workbench.colorTheme"], "Dark Modern");
  fs.writeFileSync(settings, '{"editor.fontSize":19,"workbench.colorTheme":"Dark Modern"}');
  f.manager.setTheme("light");
  const next = JSON.parse(fs.readFileSync(settings, "utf8"));
  assert.equal(next["workbench.colorTheme"], "Light Modern");
  assert.equal(next["editor.fontSize"], 19);
  assert.equal(next["window.autoDetectColorScheme"], false);
  assert.equal(f.launches.length, 1);
});

test("an installed editor's update lock offers a managed download and releases the helper", async t => {
  const f = fixture(t); f.control.attach = false; f.control.editorExit = 1;
  f.control.diagnostic = "Error: Code is currently being updated. Please wait for the update to complete before launching.";
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "error", "startup error");
  assert.match(f.request("status").error!, /installed VS Code is updating.*Download a local copy/);
  assert.equal(f.request("status").canDownloadFallback, true);
  assert.equal(f.launches.length, 1);
  assert.equal(f.downloads.length, 0, "a download waits for the user's button click");
  assert.ok(f.helpers[0]!.requests.some(request => request.op === "exit"));
  assert.equal(f.window.destroyed, false);
});

const updating = { attach: false, editorExit: 1, diagnostic: "Error: Code is currently being updated. Please wait for the update to complete before launching." };
const running = { attach: true, editorExit: null, diagnostic: "" };

test("an installed update lock reuses the managed copy and keeps the Garden repository", async t => {
  const f = fixture(t), managed = f.cacheManaged();
  const repository = path.join(f.root, "My garden repo");
  fs.mkdirSync(repository); fs.mkdirSync(path.join(repository, ".git"));
  f.contents.url += "?garden=my-garden";
  f.contents.session.fetch = async () => Response.json({ repository: { gardenSlug: "my-garden", path: repository } });
  f.control.launchOutcomes = [updating, running];
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "managed fallback docked");
  assert.equal(f.launches.length, 2);
  assert.equal(f.launches[1]!.executable, managed);
  assert.equal(f.request("status").installation, "managed");
  assert.equal(f.request("status").canDownloadFallback, undefined);
  assert.equal(f.request("status").error, undefined);
  const expected = { folders: [{ path: await fs.promises.realpath(repository), name: "My garden repo" }] };
  for (const launch of f.launches) assert.deepEqual(JSON.parse(fs.readFileSync(launch.args[1]!, "utf8")), expected);
  assert.equal((f.launches[1]!.options.env as Record<string, string>).VSCODE_PORTABLE, path.join(f.root, "profiles", "managed-stable"));
  assert.ok(f.helpers[0]!.requests.some(request => request.op === "exit"));
  assert.equal(f.downloads.length, 0);
  assert.equal(f.window.destroyed, false);
});

test("a failed managed fallback stops after one retry", async t => {
  const f = fixture(t); f.cacheManaged();
  f.control.launchOutcomes = [updating, { attach: false, editorExit: 2, diagnostic: "Cannot open editor" }];
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "error", "fallback error");
  assert.equal(f.launches.length, 2);
  assert.match(f.request("status").error!, /could not start \(exit 2\)/);
  assert.equal(f.request("status").canDownloadFallback, undefined);
  assert.equal(f.request("status").installation, "managed");
  for (const helper of f.helpers) assert.ok(helper.requests.some(request => request.op === "exit"));
});

test("ordinary installed startup failures do not silently switch installations", async t => {
  const f = fixture(t); f.cacheManaged();
  f.control.launchOutcomes = [{ attach: false, editorExit: 2, diagnostic: "Cannot open editor" }];
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "error", "ordinary startup error");
  assert.equal(f.launches.length, 1);
  assert.equal(f.request("status").canDownloadFallback, undefined);
  assert.match(f.request("status").error!, /could not start/);
});

test("a download action uses a newly cached copy without contacting the network", async t => {
  const f = fixture(t);
  f.control.launchOutcomes = [updating, running];
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "error", "download offered");
  const managed = f.cacheManaged();
  f.request("download");
  await until(() => f.request("status").phase === "docked", "cached copy docked");
  assert.equal(f.launches.length, 2);
  assert.equal(f.launches[1]!.executable, managed);
  assert.equal(f.downloads.length, 0);
});

test("fallback waits for successful native release", async t => {
  const f = fixture(t); f.cacheManaged();
  f.control.launchOutcomes = [updating, running]; f.control.failExit = true;
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "error", "release blocked");
  assert.match(f.request("status").error!, /still attached/);
  assert.equal(f.launches.length, 1);
  assert.equal(f.manager.has(f.contents.id), true);
  assert.equal(f.window.destroyed, false);
});

test("native visibility follows selection and resizing without relaunching Code", async t => {
  const f = fixture(t); f.request("open"); f.sync(false);
  await until(() => f.request("status").phase === "docked", "docked");
  f.sync(true); f.sync(false);
  f.manager.sync(f.contents.id, f.window as never, { x: 350, y: 32, width: 500, height: 600 }, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  const layouts = f.helpers[0]!.requests.filter(request => request.op === "layout");
  assert.ok(layouts.some(request => request.visible === false));
  assert.deepEqual(Object.fromEntries(["x", "y", "width", "height", "visible"].map(key => [key, layouts.at(-1)![key]])), { x: 350, y: 32, width: 500, height: 600, visible: true });
  assert.equal(f.launches.length, 1);
});

test("closing the parent waits for native restoration acknowledgement", async t => {
  const f = fixture(t); f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  f.control.exit = false; f.window.close();
  const helper = f.helpers[0]!;
  await until(() => helper.requests.some(request => request.op === "exit"), "release requested");
  assert.equal(f.window.destroyed, false);
  assert.equal(helper.requests.find(request => request.op === "exit")!.closeEditor, true,
    "closing Breadboard closes its docked editor instead of leaving a stray VS Code window");
  helper.reply(helper.requests.find(request => request.op === "exit")!);
  await until(() => f.window.destroyed, "parent close after release");
  assert.equal(f.manager.has(f.contents.id), false);
});

test("a presented Code tab gives keyboard focus to its visible native editor", async t => {
  const f = fixture(t);
  f.request("status"); assert.equal(f.manager.focus(f.contents.id), false);
  f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  assert.equal(f.manager.focus(f.contents.id), true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.helpers[0]!.requests.at(-1)!.focus, true);
  f.sync(false); assert.equal(f.manager.focus(f.contents.id), false);
  f.manager.sync(f.contents.id, f.window as never, { x: 0, y: 32, width: 600, height: 768 }, true, false);
  assert.equal(f.manager.focus(f.contents.id), false, "a visible split partner must not take focus from the selected pane");
});

test("failed native release keeps the parent and editor session alive for retry", async t => {
  const f = fixture(t); f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  f.control.failExit = true; f.window.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.window.destroyed, false);
  assert.equal(f.manager.has(f.contents.id), true);
  f.control.failExit = false; f.window.close();
  await until(() => f.window.destroyed, "successful retry");
});

test("navigation during launch cancels docking instead of attaching over the next page", async t => {
  const f = fixture(t); f.control.attach = false; f.request("open"); f.sync(true);
  await until(() => !!f.helpers[0]?.requests.some(request => request.op === "attach"), "attach pending");
  f.contents.emit("did-start-navigation", {}, "https://breadboard.test/plan", false, true);
  await until(() => !f.manager.has(f.contents.id), "navigation released session");
  assert.ok(f.helpers[0]!.requests.some(request => request.op === "exit"));
  assert.equal(f.launches.length, 1);
});

test("an explicitly undocked editor is not reported as crashed when the helper exits", async t => {
  const f = fixture(t); f.request("open"); f.sync(true);
  await until(() => f.request("status").phase === "docked", "docked");
  f.request("detach");
  await until(() => f.request("status").phase === "detached", "detached");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.request("status").phase, "detached");
});
