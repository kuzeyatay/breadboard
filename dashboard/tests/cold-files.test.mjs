import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import Database from "better-sqlite3";

async function load(entry) {
  const bundle = await build({ entryPoints: [path.resolve(import.meta.dirname, entry)], bundle: true, platform: "node", format: "cjs", packages: "external", write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
const cold = await load("../src/lib/storage/cold-files.ts");
const { nativeWorkspaceFile } = await load("../src/lib/storage/workspace-native.ts");
const DAY = 86_400_000, old = Date.now() - 30 * DAY;

function fixture(t) {
  const base = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(base, "breadboard-cold-test-")), db = new Database(":memory:");
  cold.ensureColdFileSchema(db);
  t.after(() => { db.close(); assert.ok(path.basename(root).startsWith("breadboard-cold-test-")); fs.rmSync(root, { recursive: true, force: true }); });
  const write = (relative, bytes, mtime = old) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return file;
  };
  const enqueue = relative => cold.enqueueColdFile(db, relative, fs.lstatSync(path.join(root, relative), { bigint: true }));
  const row = relative => db.prepare("SELECT * FROM storage_cold_files WHERE relative_path=?").get(relative);
  return { root, db, write, enqueue, row };
}
const text = (size = 64 * 1024) => Buffer.from("<p>the same boilerplate again</p>\n".repeat(Math.ceil(size / 34)).slice(0, size));

test("only owned, compressible, non-live files can enter the warm tier", () => {
  for (const ok of ["quartz/public/ec-2/page.html", "quartz/content/notes.md", "runtime/scriberr/transcripts/a.json",
    "cad-projects/arm/part.step", "artifacts/1/x/v2/out.svg", "runtime/hermes/sessions/log.jsonl"]) assert.ok(cold.coldFileEligible(ok), ok);
  for (const no of [
    "quartz/public/ec-2/assets/lecture.mp3",           // already compressed media
    "quartz/content/book.pdf",
    "runtime-v2/runtime-v2.sqlite3",                   // runtime-owned, live
    "runtime/jobs/job_1/result.json",                  // runtime-owned
    "runtime/hermes-workspaces/conversations/a/a/x.md",// has its own worker
    "database/spotify-browser-player/Default/x.json",  // browser profile
    "runtime/hermes/state.db", "runtime/hermes/state.db-wal",
    "agent-runtime/node_modules/x/index.js",           // executable code
    "humanizer/models/model.json", "runtime/scriberr/models/a.json",
    "quartz/public/x/.restore-1.tmp", "Partitions/a/b.json", "Local Storage/leveldb/000.log",
  ]) assert.equal(cold.coldFileEligible(no), false, no);
});

test("the scanner records candidates without touching them, and a change re-queues", (t) => {
  const { write, enqueue, row, root, db } = fixture(t);
  const file = write("quartz/public/a.html", text());
  const before = fs.readFileSync(file), mtime = fs.statSync(file).mtimeMs;
  enqueue("quartz/public/a.html");
  assert.equal(row("quartz/public/a.html").state, "pending");
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  db.prepare("UPDATE storage_cold_files SET state='compressed',saved_bytes=9").run();
  enqueue("quartz/public/a.html");                       // unchanged: verdict kept
  assert.equal(row("quartz/public/a.html").state, "compressed");
  write("quartz/public/a.html", text(70 * 1024));        // edited: back in the queue
  enqueue("quartz/public/a.html");
  assert.equal(row("quartz/public/a.html").state, "pending");

  write("quartz/public/small.html", text(1024)); enqueue("quartz/public/small.html");
  write("quartz/public/b.mp3", text()); enqueue("quartz/public/b.mp3");
  const shared = write("quartz/content/c.md", text());
  fs.linkSync(shared, path.join(root, "quartz/public/c.md"));
  enqueue("quartz/content/c.md");
  for (const skipped of ["quartz/public/small.html", "quartz/public/b.mp3", "quartz/content/c.md"]) assert.equal(row(skipped), undefined, skipped);
});

test("the worker compresses only files unchanged for the warm period, and never blocks on a busy file", async (t) => {
  const { write, enqueue, row, root, db } = fixture(t);
  write("quartz/public/old-1.html", text());
  write("quartz/public/busy.html", text(), old - DAY);
  write("quartz/public/recent.html", text(), Date.now() - 2 * DAY);
  write("quartz/public/moved-on.html", text());
  for (const name of ["old-1", "busy", "recent", "moved-on"]) enqueue(`quartz/public/${name}.html`);
  // Changed after it was queued: the worker must notice and leave it alone.
  write("quartz/public/moved-on.html", text(80 * 1024));
  const calls = [];
  const native = async ({ path: file, action }) => {
    calls.push([path.basename(file), action]);
    if (path.basename(file) === "busy.html" && action === "wof") throw new Error("The process cannot access the file because it is being used by another process.");
    return action === "inspect" ? fs.statSync(file).size : Math.floor(fs.statSync(file).size * 0.7);
  };
  const worker = new cold.ColdFileWorker(native, "win32");
  const saved = [];
  for (let i = 0; i < 6; i++) { saved.push(await worker.step(db, root, () => false)); worker.nextOperation = 0; }
  assert.equal(row("quartz/public/old-1.html").state, "compressed");
  assert.ok(row("quartz/public/old-1.html").saved_bytes > 0);
  assert.equal(row("quartz/public/busy.html").state, "pending");
  assert.match(row("quartz/public/busy.html").detail, /being used/u);
  assert.equal(row("quartz/public/recent.html").state, "pending");
  assert.equal(row("quartz/public/moved-on.html"), undefined);
  assert.ok(!calls.some(([name, action]) => name === "recent.html" || (name === "moved-on.html" && action === "wof")));
  assert.ok(saved.some(value => value > 0));
});

test("other platforms never invoke the native helper", async (t) => {
  const { write, enqueue, root, db } = fixture(t);
  write("quartz/public/a.html", text()); enqueue("quartz/public/a.html");
  const worker = new cold.ColdFileWorker(async () => { throw new Error("must not run"); }, "linux");
  assert.equal(await worker.step(db, root, () => false), 0);
});

test("Windows compresses in place: same bytes, same path and timestamp, edits still work", { skip: process.platform !== "win32" }, async (t) => {
  const { write, root } = fixture(t);
  const file = write("quartz/public/page.html", text(512 * 1024));
  const before = fs.readFileSync(file), mtime = fs.statSync(file).mtimeMs, ino = String(fs.statSync(file, { bigint: true }).ino);
  const released = await nativeWorkspaceFile({ root, path: file, identity: ino, action: "wof" });
  const allocated = await nativeWorkspaceFile({ root, path: file, identity: ino, action: "inspect" });
  assert.ok(released > 0, "space was released");
  assert.ok(allocated < before.length / 2, `allocated ${allocated} of ${before.length}`);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  fs.appendFileSync(file, "<!-- edited -->");
  assert.equal(fs.readFileSync(file, "utf8").endsWith("<!-- edited -->"), true);
});
