import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {assertOffline, migrateDataLocation} from "./migrate-data-location.mjs";
import {DATA_MIGRATION_LOCK, resolveDataRoot, validateDataRoot} from "../src/main/data-location.ts";

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-data-migration-"));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const profile = path.join(base, "profile"), source = path.join(profile, "Data"), destination = path.join(base, "new-data");
  fs.mkdirSync(path.join(source, "database"), {recursive: true});
  fs.mkdirSync(path.join(source, "runtime-v2"));
  const db = new DatabaseSync(path.join(source, "database", "brain.db"));
  db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('preserved');"); db.close();
  const jobs = new DatabaseSync(path.join(source, "runtime-v2", "runtime-v2.sqlite3"));
  jobs.exec("CREATE TABLE runtime_jobs (job_id TEXT, state TEXT, user_id INTEGER, owner_principal TEXT);"); jobs.close();
  fs.writeFileSync(path.join(source, "artifact.txt"), "unchanged original artifact");
  return {profile, source, destination};
}

test("stage is non-destructive; offline activation verifies databases and preserves originals", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  assert.equal((await migrateDataLocation(options)).activated, false);
  assert.equal(resolveDataRoot(f.profile), f.source);
  fs.writeFileSync(path.join(f.source, "artifact.txt"), "new content while app was open");
  fs.writeFileSync(path.join(f.source, "temporary.txt"), "stale staging file");
  await migrateDataLocation(options);
  fs.unlinkSync(path.join(f.source, "temporary.txt"));
  const result = await migrateDataLocation({...options, activate: true});
  assert.equal(result.errors.length, 0);
  assert.equal(resolveDataRoot(f.profile), f.destination);
  assert.equal(resolveDataRoot(f.profile, true), f.source, "QA ignores the production storage preference");
  assert.equal(fs.readFileSync(path.join(f.destination, "artifact.txt"), "utf8"), "new content while app was open");
  assert.equal(fs.readFileSync(path.join(f.source, "artifact.txt"), "utf8"), "new content while app was open");
  assert.equal(fs.existsSync(path.join(f.destination, "temporary.txt")), false);
  assert.equal(fs.readFileSync(path.join(result.quarantine, "temporary.txt"), "utf8"), "stale staging file");
});

test("active Runtime jobs or a live owner prevent activation", async t => {
  const f = fixture(t);
  const db = new DatabaseSync(path.join(f.source, "runtime-v2", "runtime-v2.sqlite3"));
  db.exec("INSERT INTO runtime_jobs VALUES ('learn-active', 'running', 1, 'user:1')"); db.close();
  await assert.rejects(migrateDataLocation({userDataDir: f.profile, destination: f.destination, activate: true}), /unfinished/u);
  assert.equal(fs.existsSync(path.join(f.profile, DATA_MIGRATION_LOCK)), false);
  fs.mkdirSync(path.join(f.source, "runtime"));
  fs.writeFileSync(path.join(f.source, "runtime", "endpoints.json"), JSON.stringify({pid: process.pid}));
  assert.throws(() => assertOffline(f.source), /still running/u);
});

test("activation locks out launches and unsafe destinations are rejected", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile, DATA_MIGRATION_LOCK), "{}");
  assert.throws(() => resolveDataRoot(f.profile), /finishing its data migration/u);
  assert.equal(resolveDataRoot(f.profile, true), f.source);
  fs.unlinkSync(path.join(f.profile, DATA_MIGRATION_LOCK));
  assert.throws(() => validateDataRoot("relative/path", false), /absolute local/u);
  assert.throws(() => validateDataRoot(path.parse(f.source).root), /drive root/u);
  if (process.platform === "win32") assert.throws(() => validateDataRoot("\\\\server\\share\\Data", false), /absolute local/u);
  await assert.rejects(migrateDataLocation({userDataDir: f.profile, destination: path.join(f.source, "nested")}), /overlap/u);
  fs.mkdirSync(f.destination);
  fs.writeFileSync(path.join(f.destination, "unrelated.txt"), "do not overwrite");
  await assert.rejects(migrateDataLocation({userDataDir: f.profile, destination: f.destination}), /empty or owned/u);
});

test("redirected data roots and staged files cannot escape the migration", async t => {
  const f = fixture(t);
  const link = path.join(path.dirname(f.destination), "redirected");
  fs.symlinkSync(f.source, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => validateDataRoot(link), /symlink|junction|direct path/u);
  await assert.rejects(migrateDataLocation({userDataDir: f.profile, destination: link}), /symlink|junction|direct path/u);
});

test("internal dependency links are preserved inside the new data root", async t => {
  const f = fixture(t);
  const dependencies = path.join(f.source, "dependencies");
  fs.mkdirSync(dependencies);
  fs.writeFileSync(path.join(dependencies, "entry.js"), "fixture");
  fs.symlinkSync(dependencies, path.join(f.source, "package-link"), process.platform === "win32" ? "junction" : "dir");
  await migrateDataLocation({userDataDir: f.profile, destination: f.destination, activate: true});
  assert.equal(fs.readFileSync(path.join(f.destination, "package-link", "entry.js"), "utf8"), "fixture");
  assert.equal(fs.realpathSync(path.join(f.destination, "package-link")), path.join(f.destination, "dependencies"));
});

test("internal dependency file symlinks retain their copied target", async t => {
  const f = fixture(t);
  try { fs.symlinkSync(path.join(f.source, "artifact.txt"), path.join(f.source, "artifact-link.txt"), "file"); }
  catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    t.skip("This Windows account does not permit file symlinks.");
    return;
  }
  await migrateDataLocation({userDataDir: f.profile, destination: f.destination, activate: true});
  assert.equal(fs.realpathSync(path.join(f.destination, "artifact-link.txt")), path.join(f.destination, "artifact.txt"));
  assert.equal(fs.readFileSync(path.join(f.destination, "artifact-link.txt"), "utf8"), "unchanged original artifact");
});

test("empty directories and links to them survive activation; stale directory trees are retained outside the root", async t => {
  const f = fixture(t);
  const empty = path.join(f.source, "empty", "nested");
  fs.mkdirSync(empty, {recursive: true});
  fs.symlinkSync(empty, path.join(f.source, "empty-link"), process.platform === "win32" ? "junction" : "dir");
  const stale = path.join(f.source, "retired", "nested");
  fs.mkdirSync(stale, {recursive: true});
  fs.writeFileSync(path.join(stale, "old.txt"), "retained");
  await migrateDataLocation({userDataDir: f.profile, destination: f.destination});
  fs.rmSync(path.join(f.source, "retired"), {recursive: true});
  const result = await migrateDataLocation({userDataDir: f.profile, destination: f.destination, activate: true});
  assert.equal(fs.statSync(path.join(f.destination, "empty", "nested")).isDirectory(), true);
  assert.equal(fs.realpathSync(path.join(f.destination, "empty-link")), path.join(f.destination, "empty", "nested"));
  assert.equal(fs.existsSync(path.join(f.destination, "retired")), false);
  assert.equal(fs.readFileSync(path.join(result.quarantine, "retired", "nested", "old.txt"), "utf8"), "retained");
});

test("an offline queued maintenance tick can move but queued user work cannot", async t => {
  const f = fixture(t);
  const db = new DatabaseSync(path.join(f.source, "runtime-v2", "runtime-v2.sqlite3"));
  db.exec("INSERT INTO runtime_jobs VALUES ('scheduled', 'queued', NULL, 'internal:runtime-scheduler')");
  assert.doesNotThrow(() => assertOffline(f.source));
  db.exec("INSERT INTO runtime_jobs VALUES ('user-work', 'queued', 1, 'user:1')");
  db.close();
  assert.throws(() => assertOffline(f.source), /unfinished/u);
});

test("activation repairs its own staged link to an omitted empty directory", async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.source, "empty"));
  fs.symlinkSync(path.join(f.source, "empty"), path.join(f.source, "empty-link"), process.platform === "win32" ? "junction" : "dir");
  const options = {userDataDir: f.profile, destination: f.destination};
  await migrateDataLocation(options);
  fs.rmdirSync(path.join(f.destination, "empty"));
  await migrateDataLocation({...options, activate: true});
  assert.equal(fs.statSync(path.join(f.destination, "empty-link")).isDirectory(), true);
});

test("dangling staged links outside the owned destination are rejected", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await migrateDataLocation(options);
  fs.symlinkSync(path.join(path.dirname(f.destination), "unrelated-missing"), path.join(f.destination, "bad-link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(migrateDataLocation({...options, activate: true}), /external symlink|junction/u);
  assert.equal(resolveDataRoot(f.profile), f.source);
});

test("an interrupted stage resumes its closed inventory checkpoint; activation still refreshes the source", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await assert.rejects(migrateDataLocation({...options, onProgress(progress) {
    if (progress.phase === "copy") throw new Error("fixture interrupted before copy");
  }}), /fixture interrupted/u);
  const checkpoint = path.join(f.destination, ".breadboard-migration-inventory.jsonl");
  fs.appendFileSync(checkpoint, '{"entry":'); // An interrupted final write is discarded, not the complete prefix.
  fs.writeFileSync(path.join(f.source, "new-after-scan.txt"), "fresh on activation");
  let resumed = false;
  await migrateDataLocation({...options, onProgress(progress) { resumed ||= progress.resumedDirectories > 0; }});
  assert.equal(resumed, true);
  await migrateDataLocation({...options, activate: true});
  assert.equal(fs.readFileSync(path.join(f.destination, "new-after-scan.txt"), "utf8"), "fresh on activation");
});

test("an inventory checkpoint cannot be reused for a different source or destination", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await assert.rejects(migrateDataLocation({...options, onProgress(progress) {
    if (progress.phase === "copy") throw new Error("fixture interrupted");
  }}), /fixture interrupted/u);
  const checkpoint = path.join(f.destination, ".breadboard-migration-inventory.jsonl");
  const lines = fs.readFileSync(checkpoint, "utf8").split("\n");
  lines[0] = JSON.stringify({...JSON.parse(lines[0]), destination: path.join(f.destination, "another")});
  fs.writeFileSync(checkpoint, lines.join("\n"));
  await assert.rejects(migrateDataLocation(options), /another migration/u);
});

test("only the exact Runtime process scratch contents are omitted; canonical inputs and similarly named folders survive", async t => {
  const f = fixture(t);
  for (const relative of ["runtime-v2/temp", "runtime-v2/temp-like", "user/temp", "runtime/jobs/job_1/inputs/blob_1"]) {
    fs.mkdirSync(path.join(f.source, relative), {recursive: true});
    fs.writeFileSync(path.join(f.source, relative, "payload"), relative);
  }
  await migrateDataLocation({userDataDir: f.profile, destination: f.destination, activate: true});
  assert.deepEqual(fs.readdirSync(path.join(f.destination, "runtime-v2/temp")), []);
  assert.equal(fs.readFileSync(path.join(f.source, "runtime-v2/temp/payload"), "utf8"), "runtime-v2/temp");
  for (const relative of ["runtime-v2/temp-like", "user/temp", "runtime/jobs/job_1/inputs/blob_1"]) {
    assert.equal(fs.readFileSync(path.join(f.destination, relative, "payload"), "utf8"), relative);
  }
});

test("a source parent redirected after inventory is deferred instead of copying through it", async t => {
  const f = fixture(t);
  const directory = path.join(f.source, "moving");
  const outside = path.join(path.dirname(f.source), "outside");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "content.txt"), "source");
  const result = await migrateDataLocation({userDataDir: f.profile, destination: f.destination, onProgress(progress) {
    if (progress.phase !== "copy") return;
    fs.renameSync(directory, outside);
    fs.symlinkSync(outside, directory, process.platform === "win32" ? "junction" : "dir");
  }});
  assert.ok(result.errors.some(error => /direct path/u.test(error.error)));
  assert.equal(fs.existsSync(path.join(f.destination, "moving", "content.txt")), false);
  assert.equal(fs.readFileSync(path.join(outside, "content.txt"), "utf8"), "source");
});

test("unchanged files reuse successful SHA receipts during offline activation", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  const staged = await migrateDataLocation(options);
  assert.equal(staged.reused, 0);
  const activated = await migrateDataLocation({...options, activate: true});
  assert.equal(activated.reused, 3);
  assert.equal(activated.errors.length, 0);
});

for (const modified of ["source", "target"]) test(`restored mtime does not hide modified ${modified} content from receipt validation`, async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await migrateDataLocation(options);
  const artifact = path.join(modified === "source" ? f.source : f.destination, "artifact.txt");
  const previous = fs.statSync(artifact);
  const original = fs.readFileSync(artifact, "utf8");
  const changed = "x".repeat(Buffer.byteLength(original));
  fs.writeFileSync(artifact, changed);
  fs.utimesSync(artifact, previous.atime, previous.mtime);
  const result = await migrateDataLocation({...options, activate: true});
  assert.equal(result.reused, 2);
  assert.ok(result.copied >= 1);
  assert.equal(fs.readFileSync(path.join(f.destination, "artifact.txt"), "utf8"), modified === "source" ? changed : original);
});

test("a replaced target file with restored mtime cannot reuse the old identity receipt", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await migrateDataLocation(options);
  const artifact = path.join(f.destination, "artifact.txt");
  const previous = fs.statSync(artifact), original = fs.readFileSync(artifact);
  fs.renameSync(artifact, path.join(f.destination, "old-artifact.txt"));
  fs.writeFileSync(artifact, original);
  fs.utimesSync(artifact, previous.atime, previous.mtime);
  const result = await migrateDataLocation({...options, activate: true});
  assert.equal(result.reused, 2);
  assert.deepEqual(fs.readFileSync(artifact), original);
  assert.equal(fs.existsSync(path.join(f.destination, "old-artifact.txt")), false);
});

test("corrupt verification receipts are preserved and force fresh hashes", async t => {
  const f = fixture(t);
  const options = {userDataDir: f.profile, destination: f.destination};
  await migrateDataLocation(options);
  const receipt = path.join(f.destination, ".breadboard-migration-verified.jsonl");
  const lines = fs.readFileSync(receipt, "utf8").trimEnd().split("\n");
  lines[1] = JSON.stringify({...JSON.parse(lines[1]), relative: "../outside"});
  fs.writeFileSync(receipt, lines.join("\n") + "\n");
  let invalidated = false;
  const result = await migrateDataLocation({...options, activate: true, onProgress(progress) { invalidated ||= progress.invalidated === true; }});
  assert.equal(invalidated, true);
  assert.equal(result.reused, 0);
  assert.ok(fs.readdirSync(f.destination).some(name => name.startsWith(".breadboard-migration-verified.jsonl.invalid-")));
});
