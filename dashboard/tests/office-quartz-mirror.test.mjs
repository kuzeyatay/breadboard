// Office documents in a Garden's Files keep a Quartz note in step: written on
// import, rewritten on a new version, moved with the file, removed on trash,
// and never written when it would show a private file in a public Garden.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-office-mirror-"));
process.env.BREADBOARD_DATA_DIR = path.join(root, "data");
process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
process.env.QUARTZ_AUTO_PUBLISH = "off";
for (const garden of ["notes", "shared"]) fs.mkdirSync(path.join(process.env.QUARTZ_CONTENT_PATH, garden), { recursive: true });

// knowledge.ts and the publisher pull in the whole app; record their calls instead.
const calls = { refresh: 0, publish: 0 };
globalThis.__officeMirrorCalls = calls;
const stubs = {
  "../knowledge.ts": "export function refreshClusterIndex() { globalThis.__officeMirrorCalls.refresh++; }",
  "../quartz-publish.ts": "export async function publishQuartzAfterMutation() { globalThis.__officeMirrorCalls.publish++; }",
};
const dashboard = path.resolve(import.meta.dirname, "..");
const bundle = await build({
  stdin: { contents: 'export { default as db } from "./src/lib/db.ts"; export { gardenFiles } from "./src/lib/garden-files/repository.ts"; export { syncOfficeMirrors, officeMarkdown } from "./src/lib/office/quartz-mirror.ts";', resolveDir: dashboard, loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
  plugins: [{ name: "office-mirror-stubs", setup(b) {
    b.onResolve({ filter: /.*/ }, args => stubs[args.path] === undefined ? undefined : { path: args.path, namespace: "stub" });
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: stubs[args.path], loader: "ts" }));
  } }],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", "__filename", "__dirname", bundle.outputFiles[0].text)(createRequire(path.join(dashboard, "package.json")), loaded, loaded.exports, path.join(dashboard, "bundle.cjs"), dashboard);
const { db, gardenFiles, syncOfficeMirrors, officeMarkdown } = loaded.exports;
after(() => { try { db.close(); } catch { /* already closed */ } fs.rmSync(root, { recursive: true, force: true }); });

db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (900, 'office-mirror', 'office-mirror@example.test', 'x')").run();
db.prepare("INSERT INTO clusters (id, user_id, name, slug, visibility) VALUES (900, 900, 'Notes', 'notes', 'private'), (901, 900, 'Shared', 'shared', 'public')").run();
const scope = { gardenId: "notes", clusterId: 900, ownerId: 900, userId: 900 };
const store = gardenFiles();
const note = (relPath, garden = "notes") => path.join(process.env.QUARTZ_CONTENT_PATH, garden, relPath);

async function add(target, relPath, text) {
  const stage = await store.stage(new Blob([text]).stream());
  return store.import(target, relPath, stage);
}

test("markdown conversion keeps HTML headings as headings", async () => {
  const { markdown } = await officeMarkdown("page.html", Buffer.from("<h1>Plan</h1><p>Ship it.</p>"));
  assert.match(markdown, /^# Plan/m);
  assert.match(markdown, /Ship it\./);
});

test("a document's note follows its versions, moves and trash", async () => {
  let file = await add(scope, "Office/Lab plan.md", "# Lab plan\n\nFirst draft.");
  await syncOfficeMirrors(store, scope);
  const first = fs.readFileSync(note("Office/lab-plan-md.md"), "utf8");
  assert.match(first, /title: "Lab plan"/);
  assert.match(first, /garden_file_id: /);
  assert.match(first, /First draft\./);

  const stage = await store.stage(new Blob(["# Lab plan\n\nSecond draft."]).stream());
  file = store.save(scope, file.id, file.revision, stage);
  await syncOfficeMirrors(store, scope);
  assert.match(fs.readFileSync(note("Office/lab-plan-md.md"), "utf8"), /Second draft\./);

  file = store.move(scope, file.id, file.revision, "Archive/Lab plan.md");
  await syncOfficeMirrors(store, scope);
  assert.equal(fs.existsSync(note("Office/lab-plan-md.md")), false);
  assert.match(fs.readFileSync(note("Archive/lab-plan-md.md"), "utf8"), /Second draft\./);

  store.trash(scope, file.id, file.revision);
  await syncOfficeMirrors(store, scope);
  assert.equal(fs.existsSync(note("Archive/lab-plan-md.md")), false);
});

test("a Spaces design in a folder links its image by its full content path, the way Quartz resolves it", async () => {
  // Quartz resolves from the content root; "../assets" from Spaces/ lost the Garden folder and broke the image.
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const stage = await store.stage(new Blob([png]).stream());
  const file = store.import(scope, "Spaces/Poster.png", stage);
  await syncOfficeMirrors(store, scope);
  const text = fs.readFileSync(note("Spaces/poster-png.md"), "utf8");
  assert.match(text, new RegExp(`\\]\\(notes/assets/office/${file.id}/figure-1\\.png\\)`));
  assert.doesNotMatch(text, /\.\.\/assets/);
  assert.ok(fs.existsSync(note(`assets/office/${file.id}/figure-1.png`)));
});

test("a private file in a public Garden gets no note until it is shared", async () => {
  const shared = { gardenId: "shared", clusterId: 901, ownerId: 900, userId: 900 };
  let file = await add(shared, "Office/Secret.md", "# Secret\n\nPrivate notes.");
  await syncOfficeMirrors(store, shared);
  assert.equal(fs.existsSync(note("Office/secret-md.md", "shared")), false);
  file = store.share(shared, file.id, file.revision, "garden");
  await syncOfficeMirrors(store, shared);
  assert.ok(fs.existsSync(note("Office/secret-md.md", "shared")));
});

test("each change refreshes the Garden index and publishes Quartz", () => {
  assert.ok(calls.refresh >= 4);
  assert.equal(calls.publish, calls.refresh);
});
