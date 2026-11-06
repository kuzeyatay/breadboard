import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createSpotifySessionProfile } from "../scripts/runtime-v2-spotify-profile.mjs";

const bundle = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, ".."),
    contents: 'export * from "./scripts/runtime-v2-spotify-playback-service.mjs"; export * from "node:child_process";',
  },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "session-lifecycle-boundary", setup(builder) {
    builder.onLoad({ filter: /runtime-v2-spotify-playback-service\.mjs$/ }, ({ path: filename }) => {
      const source = fs.readFileSync(filename, "utf8");
      return { loader: "js", contents: source.slice(0, source.lastIndexOf("void main().catch")) + "\nexport {launchSession, closeSession, sessions, failures};" };
    });
    builder.onResolve({ filter: /^node:child_process$/ }, () => ({ path: "child-process", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `
      import {EventEmitter} from "node:events";
      export const launches=[];
      let failure=null;
      export function failNextSpawn(mode){failure=mode;}
      export function spawn(executable,args,options){
        const mode=failure;failure=null;
        if(mode==='sync')throw Error('spawn failed');
        const child=new EventEmitter();child.exitCode=null;child.signalCode=null;
        child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');};
        launches.push({args,options,child});
        queueMicrotask(()=>{
          if(mode==='async'){child.exitCode=1;child.emit('error',Error('spawn failed'));}
          else child.emit('spawn');
        });
        return child;
      }
    ` }));
  } }],
});
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function useMockBrowser(t) {
  const previous = process.env.BREADBOARD_SPOTIFY_BROWSER_PATH;
  process.env.BREADBOARD_SPOTIFY_BROWSER_PATH = process.execPath;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_SPOTIFY_BROWSER_PATH;
    else process.env.BREADBOARD_SPOTIFY_BROWSER_PATH = previous;
  });
}

test("service renewals reuse a session, but relaunches cannot attach to a restored browser", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-lifecycle-"));
  useMockBrowser(t);
  const configuration = { dataRoot: root, dashboardOrigin: "http://127.0.0.1:9" };
  const input = { userId: 7, viewId: "test-view", ticket: "test-ticket" };
  t.after(async () => {
    for (const session of runtime.sessions.values()) await runtime.closeSession(session);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const count = runtime.launches.length;
  await runtime.launchSession(configuration, input);
  const first = runtime.sessions.get(7);
  const firstDirectory = first.profile.directory;
  assert.ok(runtime.launches.at(-1).args.includes(`--user-data-dir=${firstDirectory}`));
  await runtime.launchSession(configuration, { ...input, viewId: "second-view" });
  assert.equal(runtime.launches.length, count + 1);
  await runtime.closeSession(first);
  assert.equal(fs.existsSync(firstDirectory), false);

  // Model Windows restoring the previous browser after Runtime has lost it.
  fs.mkdirSync(firstDirectory);
  fs.writeFileSync(path.join(firstDirectory, "SingletonLock"), "restored browser");
  await runtime.launchSession(configuration, input);
  const replacement = runtime.sessions.get(7);
  assert.notEqual(replacement.profile.directory, firstDirectory);
  assert.ok(runtime.launches.at(-1).args.includes(`--user-data-dir=${replacement.profile.directory}`));
  await runtime.closeSession(replacement);
  assert.equal(fs.existsSync(replacement.profile.directory), false);
  assert.equal(fs.readFileSync(path.join(firstDirectory, "SingletonLock"), "utf8"), "restored browser");
});

test("failed browser launches release their bridge and temporary profile", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-failed-launch-"));
  useMockBrowser(t);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [index, mode] of ["sync", "async"].entries()) {
    const userId = 20 + index;
    runtime.failNextSpawn(mode);
    await assert.rejects(runtime.launchSession(
      { dataRoot: root, dashboardOrigin: "http://127.0.0.1:9" },
      { userId, viewId: "test-view", ticket: "test-ticket" },
    ), /could not start/u);
    assert.equal(runtime.sessions.has(userId), false);
    assert.deepEqual(fs.readdirSync(path.join(root, "database", "spotify-browser-player", `user-${userId}`)), []);
  }
});

test("each audio browser owns a fresh profile even when an earlier browser survives", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, "database", "spotify-browser-player", "user-7");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "Preferences"), "existing browser profile");

  const orphan = createSpotifySessionProfile(root, 7);
  fs.writeFileSync(path.join(orphan.directory, "SingletonLock"), "old browser");
  const replacement = createSpotifySessionProfile(root, 7);
  const otherUser = createSpotifySessionProfile(root, 8);
  assert.notEqual(replacement.directory, orphan.directory);
  assert.notEqual(replacement.directory, legacy);
  assert.equal(path.dirname(replacement.directory), legacy);
  assert.notEqual(path.dirname(otherUser.directory), legacy);

  fs.mkdirSync(path.join(replacement.directory, "Default"));
  fs.writeFileSync(path.join(replacement.directory, "Default", "Preferences"), "temporary");
  await replacement.cleanup();
  await replacement.cleanup();
  assert.equal(fs.existsSync(replacement.directory), false);
  assert.equal(fs.readFileSync(path.join(orphan.directory, "SingletonLock"), "utf8"), "old browser");
  assert.equal(fs.readFileSync(path.join(legacy, "Preferences"), "utf8"), "existing browser profile");
  await orphan.cleanup();
  await otherUser.cleanup();
});

test("session profile cleanup refuses a replaced directory link", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-session-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb-spotify-outside-"));
  const profile = createSpotifySessionProfile(root, 7);
  t.after(() => {
    if (fs.existsSync(profile.directory) && fs.lstatSync(profile.directory).isSymbolicLink()) fs.unlinkSync(profile.directory);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "keep"), "keep");
  fs.rmdirSync(profile.directory);
  fs.symlinkSync(outside, profile.directory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(profile.cleanup(), /profile is indirect/u);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "keep");
});
