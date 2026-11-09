import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { GestureController } from "../src/main/gesture-controller";
import { DEFAULT_GESTURE_SETTINGS, isGestureSettings, isGestureControlAction, isGestureControlPage } from "../src/shared/gesture-control";

test("gesture IPC accepts only the exact dashboard gesture page and fixed actions", () => {
  const dashboard = "http://127.0.0.1:3500";
  assert.ok(isGestureControlPage(`${dashboard}/gestures?theme=dark`, dashboard));
  for (const url of ["https://example.com/gestures", `${dashboard}/new-tab`, `${dashboard}/gestures/x`, "not a URL"]) {
    assert.equal(isGestureControlPage(url, dashboard), false);
  }
  assert.equal(isGestureControlPage(`${dashboard}/gestures`, null), false);
  for (const action of ["state", "start", "pause", "stop", "save-settings"]) assert.ok(isGestureControlAction(action));
  for (const action of ["resume", "exec", {}, null]) assert.equal(isGestureControlAction(action), false);
});

async function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "breadboard-gestures-"));
  const descriptor = path.join(root, "aircursor", ".install-tmp", "breadboard-controller.json");
  const settingsFile = path.join(root, "aircursor", "settings.json");
  await mkdir(path.dirname(descriptor), { recursive: true });
  await mkdir(path.join(root, "aircursor", ".venv", "Scripts"), { recursive: true });
  await writeFile(path.join(root, "aircursor", ".venv", "Scripts", "pythonw.exe"), "test placeholder");
  await writeFile(path.join(root, "aircursor", "start_external.pyw"), "test placeholder");
  const token = "a".repeat(64);
  const commands: string[] = [];
  const state = { phase: "running", paused: true, status: "PAUSED", detail: "", display: "DISPLAY2", image: null,
    settings: { ...DEFAULT_GESTURE_SETTINGS }, settingsRevision: "" };
  const behavior = { rejectReload: false };
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/snapshot") { response.end(JSON.stringify(state)); return; }
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", async () => {
      const { action } = JSON.parse(body);
      commands.push(action);
      if (action === "pause") state.paused = true;
      if (action === "reload-settings") {
        if (behavior.rejectReload) { response.statusCode = 400; response.end('{}'); return; }
        const saved = JSON.parse(await readFile(settingsFile, "utf8"));
        state.settings = Object.fromEntries(Object.keys(DEFAULT_GESTURE_SETTINGS).map(key => [key, saved[key] ?? DEFAULT_GESTURE_SETTINGS[key as keyof typeof DEFAULT_GESTURE_SETTINGS]])) as typeof state.settings;
        state.settingsRevision = saved.settings_revision ?? "";
      }
      if (action === "stop") {
        void unlink(descriptor).then(() => response.end('{"ok":true}'));
      } else response.end('{"ok":true}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const publish = () => writeFile(descriptor, JSON.stringify({ version: 1, port, pid: 1234, token }));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("breadboard-gestures-"));
    await rm(root, { recursive: true, force: true });
  });
  return { root, descriptor, commands, state, publish, settingsFile, behavior };
}

test("reuses running controller, hides native preview, and never exposes its secret", async t => {
  const f = await fixture(t);
  await f.publish();
  const controller = new GestureController({ appRoot: f.root, platform: "win32",
    launch: () => { throw new Error("must not start a second camera"); } });
  const state = await controller.request("start");
  assert.equal(state.phase, "running");
  assert.equal(state.paused, true);
  assert.equal("token" in state, false);
  assert.deepEqual(f.commands, ["embed"]);
  f.state.paused = false;
  assert.equal((await controller.request("pause")).paused, true);
  await controller.close();
  assert.deepEqual(f.commands, ["embed", "pause"]); // Adopted standalone camera stays owned by its launcher.
});

test("concurrent opens launch once, start paused, and owned helper stops on app exit", async t => {
  const f = await fixture(t);
  let launches = 0;
  const controller = new GestureController({ appRoot: f.root, platform: "win32", launch: (executable, args, cwd) => {
    launches++;
    assert.equal(executable, path.join(f.root, "aircursor", ".venv", "Scripts", "pythonw.exe"));
    assert.deepEqual(args, [path.join(cwd, "start_external.pyw"), "--embedded"]);
    void f.publish();
    return new EventEmitter() as ChildProcess;
  } });
  const results = await Promise.all([controller.request("start"), controller.request("start")]);
  assert.equal(launches, 1);
  assert.ok(results.every(state => state.paused && state.phase === "running"));
  await controller.close();
  assert.equal(f.commands.at(-1), "stop");
  assert.equal((await controller.request("state")).phase, "stopped");
});

test("explicit stop also closes an adopted camera", async t => {
  const f = await fixture(t);
  await f.publish();
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  assert.equal((await controller.request("stop")).phase, "stopped");
  assert.deepEqual(f.commands, ["stop"]);
});

test("untrusted descriptor cannot select a URL, port or unauthenticated service", async t => {
  const f = await fixture(t);
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  for (const invalid of [{ url: "https://example.com" }, { version: 1, port: 80, pid: 1, token: "a".repeat(64) },
    { version: 1, port: 9000, pid: 1, token: "bad" }]) {
    await writeFile(f.descriptor, JSON.stringify(invalid));
    assert.equal((await controller.request("state")).phase, "stopped");
  }
  assert.deepEqual(f.commands, []);
});

test("unsupported installation is reported without launching", async () => {
  const controller = new GestureController({ appRoot: ".", platform: "darwin" });
  const state = await controller.request("start");
  assert.equal(state.available, false);
  assert.match(state.error!, /not installed/);
});

test("settings validation rejects nonfinite values, unsafe actions, types and protected fields", () => {
  assert.ok(isGestureSettings(DEFAULT_GESTURE_SETTINGS));
  for (const patch of [{ pointer_gain: NaN }, { smoothing: 101 }, { fist_start_hold_ms: 0 },
    { v_action: "exec" }, { preferred_hand: ["Auto"] }, { pinch_action: ["left_click"] },
    { cad_zoom: "false" }, { v_while_paused: "true" }, { bent_while_paused: 1 },
    { straight_while_paused: null }, { monitor: "primary" }]) {
    assert.equal(isGestureSettings({ ...DEFAULT_GESTURE_SETTINGS, ...patch }), false);
  }
});

test("saves while stopped and preserves the camera and external monitor identity", async t => {
  const f = await fixture(t);
  await writeFile(f.settingsFile, JSON.stringify({ camera_index: 2, monitor: "DISPLAY2", monitor_device_id: "acer-hardware-id", start_paused: false }));
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  const settings = { ...DEFAULT_GESTURE_SETTINGS, pointer_gain: 0.6, smoothing: 75, v_action: "scroll_down" as const, v_while_paused: true };
  const saved = await controller.request("save-settings", settings);
  assert.equal(saved.phase, "stopped");
  assert.deepEqual(saved.settings, settings);
  assert.ok(saved.settingsRevision);
  const file = JSON.parse(await readFile(f.settingsFile, "utf8"));
  assert.equal(file.monitor, "DISPLAY2");
  assert.equal(file.monitor_device_id, "acer-hardware-id");
  assert.equal(file.camera_index, 2);
  assert.equal(file.start_paused, true);
  const reopened = new GestureController({ appRoot: f.root, platform: "win32" });
  assert.deepEqual((await reopened.request("state")).settings, settings);
});

test("saving live settings pauses first and waits for the camera to apply the saved revision", async t => {
  const f = await fixture(t);
  await f.publish();
  f.state.paused = false;
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  const settings = { ...DEFAULT_GESTURE_SETTINGS, pinch_action: "right_click" as const, bent_action: "voice" as const, bent_while_paused: true };
  const result = await controller.request("save-settings", settings);
  assert.equal(result.error, undefined);
  assert.deepEqual(f.commands, ["pause", "reload-settings"]);
  assert.equal(result.paused, true);
  assert.equal(result.settingsRevision, JSON.parse(await readFile(f.settingsFile, "utf8")).settings_revision);
  assert.deepEqual(result.settings, settings);
});

test("a failed live apply restores the prior settings and reports failure", async t => {
  const f = await fixture(t);
  const original = JSON.stringify({ ...DEFAULT_GESTURE_SETTINGS, monitor: "DISPLAY2" });
  await writeFile(f.settingsFile, original);
  await f.publish();
  f.behavior.rejectReload = true;
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  const result = await controller.request("save-settings", { ...DEFAULT_GESTURE_SETTINGS, pointer_gain: 2 });
  assert.match(result.error!, /previous settings were kept/);
  assert.equal(await readFile(f.settingsFile, "utf8"), original);
  assert.equal(result.paused, true);
});

test("invalid settings cannot write the configuration or send a camera command", async t => {
  const f = await fixture(t);
  await f.publish();
  await writeFile(f.settingsFile, "{}");
  const controller = new GestureController({ appRoot: f.root, platform: "win32" });
  const result = await controller.request("save-settings", { ...DEFAULT_GESTURE_SETTINGS, monitor: "primary" });
  assert.match(result.error!, /Invalid gesture settings/);
  assert.equal(await readFile(f.settingsFile, "utf8"), "{}");
  assert.deepEqual(f.commands, []);
});
