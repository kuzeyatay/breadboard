import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { isCodeDockAction, isCodeDockPage } from "../src/shared/code-dock";
import { assertVSCodeHash, findVSCode, findManagedVSCode, installVSCode, isMicrosoftDownload, readVSCodeRelease, resolveVSCodeStorage, saveVSCodeSelection, vscodeCandidates } from "../src/main/vscode-installation";
import { createDesktopApi, PRELOAD_IPC_CHANNELS } from "../src/preload/preload";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";

test("only the dashboard's exact Code route can invoke docking", () => {
  for (const page of ["https://breadboard.test/code", "https://breadboard.test/code/?x=1"]) assert.equal(isCodeDockPage(page, "https://breadboard.test/dashboard"), true);
  for (const page of ["https://evil.test/code", "https://breadboard.test.evil.test/code", "https://breadboard.test/browser", "https://breadboard.test/code/other", "file:///code", "invalid"]) assert.equal(isCodeDockPage(page, "https://breadboard.test"), false);
  assert.equal(isCodeDockPage("https://breadboard.test/code", null), false);
  assert.equal(isCodeDockAction({ type: "open", executable: "malware.exe" }), false);
  assert.equal(isCodeDockAction("exec"), false);
  assert.equal(isCodeDockAction("download"), true);
  assert.equal(isCodeDockAction({ type: "layout", top: 69.5 }), true);
  for (const top of [-1, 513, NaN, Infinity, "69"]) assert.equal(isCodeDockAction({ type: "layout", top }), false);
  assert.equal(isCodeDockAction({ type: "layout", top: 69, executable: "other.exe" }), false);
});

test("configured bulk storage holds managed payloads while metadata stays with active state", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-storage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, "active"), bulk = path.join(root, "bulk");
  fs.mkdirSync(bulk);
  const storage = resolveVSCodeStorage(profile, bulk);
  assert.equal(storage.stateRoot, path.join(profile, "code"));
  assert.equal(storage.payloadRoot, path.join(bulk, "code"));
  const executable = path.join(storage.payloadRoot, "versions", release.version, "Code.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, "test");
  const installed = await installVSCode(storage, () => {}, async () => new Response(JSON.stringify(release)), undefined, "x64");
  assert.equal(installed.executable, executable);
  assert.equal(findVSCode(storage, [])?.executable, executable);
  assert.equal(fs.existsSync(path.join(storage.stateRoot, "managed.json")), true);
  assert.equal(fs.existsSync(path.join(storage.stateRoot, "versions")), false);
  assert.deepEqual(fs.readdirSync(path.join(storage.payloadRoot, "versions")), [release.version]);
  assert.equal(resolveVSCodeStorage(profile).payloadRoot, storage.stateRoot);
});

test("disconnected configured storage fails before download and never falls back to active data", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-offline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = resolveVSCodeStorage(path.join(root, "active"), path.join(root, "disconnected"));
  let requests = 0;
  await assert.rejects(installVSCode(storage, () => {}, async () => { requests++; return new Response(); }), /Reconnect it/);
  assert.throws(() => findVSCode(storage, []), /Reconnect it/);
  assert.throws(() => findManagedVSCode(storage), /Reconnect it/);
  assert.equal(requests, 0);
  assert.equal(fs.existsSync(storage.stateRoot), false);
  assert.equal(fs.existsSync(storage.bulkRoot!), false);
});

test("preload exposes the same constrained Code channel as main", async () => {
  assert.deepEqual(PRELOAD_IPC_CHANNELS, IPC_CHANNELS);
  const calls: unknown[] = [];
  const api = createDesktopApi({ invoke: async (...args) => { calls.push(args); return { phase: "missing" }; }, on: () => undefined });
  assert.deepEqual(await api.codeDock("status"), { phase: "missing" });
  assert.deepEqual(calls, [["breadboard:code-dock", "status"]]);
});

test("discovery supports user/system installations and PATH bin directories", () => {
  const env = { LOCALAPPDATA: "C:\\User Space\\Local", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", PATH: '"D:\\Tools\\VS Code\\bin"' };
  const result = vscodeCandidates(env);
  assert.ok(result.includes(path.join(env.LOCALAPPDATA, "Programs/Microsoft VS Code/Code.exe")));
  assert.ok(result.includes(path.join(env.ProgramFiles, "Microsoft VS Code/Code.exe")));
  assert.ok(result.includes("D:\\Tools\\VS Code\\Code.exe"));
});

test("installed VS Code wins over a managed copy; stale choices fall back", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, "installed/Code.exe"), managed = path.join(root, "versions", "a".repeat(40), "Code.exe");
  for (const file of [installed, managed]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "test"); }
  fs.writeFileSync(path.join(root, "managed.json"), JSON.stringify({ commit: "a".repeat(40) }));
  assert.equal(findVSCode({ stateRoot: root, payloadRoot: root }, [installed])?.kind, "installed");
  assert.equal(findManagedVSCode({ stateRoot: root, payloadRoot: root })?.executable, managed);
  saveVSCodeSelection(root, installed);
  assert.equal(findVSCode({ stateRoot: root, payloadRoot: root }, [])?.executable, installed);
  fs.unlinkSync(installed);
  assert.equal(findVSCode({ stateRoot: root, payloadRoot: root }, [])?.kind, "managed");
  fs.writeFileSync(path.join(root, "managed.json"), JSON.stringify({ commit: "../../outside" }));
  assert.equal(findVSCode({ stateRoot: root, payloadRoot: root }, []), null);
  assert.equal(findManagedVSCode({ stateRoot: root, payloadRoot: root }), null);
});

test("custom selection rejects arbitrary executable names and missing files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const other = path.join(root, "other.exe"); fs.writeFileSync(other, "test");
  assert.throws(() => saveVSCodeSelection(root, other), /Code.exe/);
  assert.throws(() => saveVSCodeSelection(root, "Code.exe"));
  assert.throws(() => saveVSCodeSelection(root, path.join(root, "Code.exe")));
});

const release = { url: "https://vscode.download.prss.microsoft.com/release.zip", version: "a".repeat(40), sha256hash: "b".repeat(64) };
test("release metadata pins Microsoft HTTPS, a commit directory, and SHA-256", () => {
  assert.deepEqual(readVSCodeRelease(release), release);
  for (const url of ["http://vscode.download.prss.microsoft.com/a.zip", "https://vscode.download.prss.microsoft.com.evil.test/a.zip", "https://evil.test/a.zip", "file:///x", "https://user:pass@update.code.visualstudio.com/a", "https://update.code.visualstudio.com:8888/a"]) {
    assert.equal(isMicrosoftDownload(url), false);
    assert.throws(() => readVSCodeRelease({ ...release, url }));
  }
  assert.throws(() => readVSCodeRelease({ ...release, version: "../../escape" }));
  assert.throws(() => readVSCodeRelease({ ...release, sha256hash: undefined }));
  assert.throws(() => assertVSCodeHash("a".repeat(64), release.sha256hash), /integrity/);
});

test("a corrupt archive never extracts or registers a managed installation", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const phases: string[] = [];
  const fetcher: typeof fetch = async input => String(input).includes("/api/update/")
    ? new Response(JSON.stringify(release)) : new Response("corrupt archive");
  await assert.rejects(installVSCode({ stateRoot: root, payloadRoot: root }, phase => phases.push(phase), fetcher, undefined, "x64"), /integrity/);
  assert.equal(phases.includes("extracting"), false);
  assert.equal(fs.existsSync(path.join(root, "managed.json")), false);
  assert.deepEqual(fs.readdirSync(path.join(root, "versions")), []);
});

test("a redirected download cannot leave Microsoft hosts", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requested: string[] = [];
  const fetcher: typeof fetch = async input => { requested.push(String(input)); return new Response(null, { status: 302, headers: { location: "https://evil.test/vscode.zip" } }); };
  await assert.rejects(installVSCode({ stateRoot: root, payloadRoot: root }, () => {}, fetcher, undefined, "x64"), /Microsoft/);
  assert.equal(requested.length, 1);
  assert.equal(findVSCode({ stateRoot: root, payloadRoot: root }, []), null);
});

test("cancellation cannot promote a downloaded archive to an installation", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-code-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const abort = new AbortController();
  const body = Buffer.from("archive");
  const fetcher: typeof fetch = async input => {
    if (String(input).includes("/api/update/")) return new Response(JSON.stringify({ ...release, sha256hash: createHash("sha256").update(body).digest("hex") }));
    abort.abort(); return new Response(body);
  };
  await assert.rejects(installVSCode({ stateRoot: root, payloadRoot: root }, () => {}, fetcher, abort.signal, "x64"), /abort/i);
  assert.equal(fs.existsSync(path.join(root, "managed.json")), false);
});
