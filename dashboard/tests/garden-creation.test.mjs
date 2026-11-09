import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const stubs = {
  "@/lib/db": "export default globalThis.__gardenCreation.database;",
  "next/server": `export const NextResponse = Response;
    export const after = callback => globalThis.__gardenCreation.after.push(callback);`,
  "next/cache": "export const revalidatePath = path => globalThis.__gardenCreation.revalidated.push(path);",
  "@/lib/server-auth": `export async function requireUserId() {
    if (!globalThis.__gardenCreation.authorized) throw Object.assign(Error('Unauthorized'), {status:401});
    return 7;
  }
  export const routeErrorResponse = error => Response.json({error:error.message}, {status:error.status || 500});`,
  "@/lib/knowledge": `export function countClusterMarkdown() { throw Error('Unexpected directory walk'); }
    export function refreshClusterIndex(contentPath, slug) {
      const state = globalThis.__gardenCreation;
      if (!state.leased) throw Error('Missing creation lease');
      state.indexed.push(slug);
    }`,
  "@/lib/garden-card-note-count": `export function gardenCardNoteCount() {
    throw Error('Creation must not reload all garden cards');
  }`,
  "@/lib/quartz-garden-index": `export async function refreshPrivateQuartzIndexCooperatively(userId) {
    const state = globalThis.__gardenCreation;
    if (!state.responded) throw Error('Library scan ran before the response');
    if (state.leased) throw Error('Library scan holds creation lease');
    state.libraryRefreshes.push(userId);
    if (state.failRefresh) throw Error('Library unavailable');
  }
  export const refreshPrivateQuartzIndex = () => { throw Error('Unexpected synchronous library scan'); };
  export const refreshOrganizationQuartzIndex = () => {};
  export const refreshPublicQuartzIndex = () => {};`,
  "@/lib/quartz-publish": `export function publishQuartzAfterMutation(reason, options) {
    const state = globalThis.__gardenCreation;
    state.publications.push({reason, options});
    return new Promise(resolve => { state.finishPublication = resolve; });
  }`,
  "@/lib/garden-mutation-lease": `export function acquireGardenMutationLease() {
    const state = globalThis.__gardenCreation;
    if (state.busy) throw Error('Garden busy');
    state.leased = true;
    return {release() {state.leased = false;}};
  }`,
  "@/lib/organizations/store": "export const memberRole = () => null; export const organizationClusterClause = () => '0';",
  "@/lib/code-index/garden": "export const prepareGraftIndex = () => {};",
  "@/lib/garden-deletion": "export const deleteOwnedGarden = () => {}; export const finalizeGardenDeletion = () => {};",
};

const bundleFor = (entry, modules = stubs) => build({
  entryPoints: [path.join(root, entry)],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "garden-creation-fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => modules[args.path] === undefined ? undefined : { path: args.path, namespace: "fixture" });
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: modules[args.path], loader: "ts" }));
  } }],
});
const bundle = await bundleFor("src/app/api/clusters/route.ts");
const libraryBundle = await bundleFor("src/lib/quartz-garden-index.ts", {
  ...stubs,
  "@/lib/knowledge": `export const GARDEN_SUMMARY_FRESHNESS_MS = 10000;
    export const scanClusterKnowledge = () => {throw Error('Unexpected synchronous scan');};
    export const scanClusterKnowledgeCooperatively = (...args) => globalThis.__gardenCreation.scanGarden(...args);`,
});

function loadBundle(bundle) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "garden-creation-"));
  const previousContent = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = path.toNamespacedPath(directory);
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL, description TEXT, visibility TEXT DEFAULT 'private',
      border_color TEXT, folder TEXT, organization_id INTEGER,
      card_width INTEGER DEFAULT 392, card_height INTEGER DEFAULT 244,
      chat_accessible INTEGER DEFAULT 0, fork_allowed INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0, last_viewed_at TEXT, repo_path TEXT,
      graft_enabled INTEGER DEFAULT 1, thought_topology_enabled INTEGER DEFAULT 1,
      thought_topology_revision INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE cluster_folders (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      position INTEGER, UNIQUE(user_id, name)
    );
  `);
  const state = { database, after: [], revalidated: [], authorized: true, leased: false,
    indexed: [], libraryRefreshes: [], publications: [], responded: false };
  globalThis.__gardenCreation = state;
  const routes = loadBundle(bundle);
  t.after(() => {
    state.finishPublication?.();
    database.close();
    if (previousContent === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previousContent;
    delete globalThis.__gardenCreation;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ...routes, state, directory, database };
}

const request = body => new Request("http://localhost/api/clusters", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("creation returns the persisted nested garden without scanning the library or waiting for publication", { timeout: 5000 }, async t => {
  const { POST, state, database, directory } = fixture(t);
  // The response must not depend on the number or size of existing gardens.
  const insert = database.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (7, ?, ?)");
  for (let index = 0; index < 300; index++) insert.run(`Existing ${index}`, `existing-${index}`);
  const started = performance.now();
  const response = await POST(request({ name: "Neuro: Comp", description: "Signals: spikes\nand learning", folder: " EE year 2 / Semester 1 " }));
  const { slug, cluster } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(slug, "neuro-comp");
  assert.equal(cluster.id, 301);
  assert.equal(cluster.name, "Neuro: Comp");
  assert.equal(cluster.folder, "EE year 2/Semester 1");
  assert.equal(cluster.noteCount, 0);
  assert.equal(cluster.isOwner, true);
  assert.equal(cluster.repo_connected, false);
  assert.equal(cluster.thought_topology_enabled, true);
  assert.equal(cluster.visibility, "private");
  assert.equal(cluster.card_width, 392);
  assert.equal(cluster.card_height, 244);
  assert.equal(database.prepare("SELECT slug FROM clusters WHERE id = ?").get(cluster.id).slug, slug);
  assert.deepEqual(database.prepare("SELECT name FROM cluster_folders ORDER BY id").all().map(row => row.name), ["EE year 2", "EE year 2/Semester 1"]);
  const source = fs.readFileSync(path.join(directory, slug, "_index.md"), "utf8");
  const metadata = parse(source.split("---")[1]);
  assert.equal(metadata.title, "Neuro: Comp");
  assert.equal(metadata.description, "Signals: spikes\nand learning");
  assert.deepEqual(state.indexed, [slug]);
  assert.equal(state.leased, false);
  assert.deepEqual(state.libraryRefreshes, []);
  assert.deepEqual(state.publications, []);
  assert.equal(state.after.length, 1);
  t.diagnostic(`Create response with 300 existing gardens: ${(performance.now() - started).toFixed(1)} ms (isolated database/filesystem fixture)`);

  state.responded = true;
  let published = false;
  const deferred = state.after[0]().then(() => { published = true; });
  await Promise.resolve();
  assert.deepEqual(state.libraryRefreshes, [7]);
  assert.deepEqual(state.publications, [{ reason: `create cluster ${slug}`, options: { userId: 7, gardenSlug: slug } }]);
  assert.equal(published, false, "the response is already available while publication remains pending");
  state.finishPublication();
  await deferred;
});

test("top-level gardens and repeated names retain their unique persisted identities", async t => {
  const { POST, database } = fixture(t);
  const first = await (await POST(request({ name: "Neuro Comp" }))).json();
  const second = await (await POST(request({ name: "Neuro Comp" }))).json();
  assert.equal(first.slug, "neuro-comp");
  assert.equal(second.slug, "neuro-comp-2");
  assert.notEqual(first.cluster.id, second.cluster.id);
  assert.equal(first.cluster.folder, null);
  assert.equal(database.prepare("SELECT count(*) AS count FROM clusters").get().count, 2);
});

test("authentication and invalid form submissions cannot create a garden", async t => {
  const { POST, state, database } = fixture(t);
  state.authorized = false;
  assert.equal((await POST(request({ name: "Neuro Comp" }))).status, 401);
  state.authorized = true;
  for (const body of [{ name: " " }, { name: "x".repeat(121) }, { name: "Neuro Comp", description: "x".repeat(2001) }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  state.busy = true;
  assert.equal((await POST(request({ name: "Neuro Comp" }))).status, 500);
  assert.equal(database.prepare("SELECT count(*) AS count FROM clusters").get().count, 0);
  assert.equal(state.after.length, 0);
});

test("a failed library refresh cannot turn a saved garden into a failed creation", async t => {
  const { POST, state, database } = fixture(t);
  const response = await POST(request({ name: "Neuro Comp" }));
  const { cluster } = await response.json();
  state.responded = true;
  state.failRefresh = true;
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  await state.after[0]();
  assert.equal(response.status, 201);
  assert.equal(database.prepare("SELECT name FROM clusters WHERE id = ?").get(cluster.id).name, "Neuro Comp");
  assert.equal(logged.length, 1);
  assert.deepEqual(state.publications, []);
});

test("background library preparation yields between gardens and writes every nested library index", async t => {
  const { state, database, directory } = fixture(t);
  database.exec(`
    INSERT INTO clusters (user_id, name, slug, folder, created_at) VALUES
      (7, 'Neuro Comp', 'neuro-comp', 'EE year 2/Semester 1', '2026-11-08'),
      (7, 'Circuits', 'circuits', 'EE year 2', '2026-11-07'),
      (7, 'Missing source', 'missing', NULL, '2026-11-06'),
      (8, 'Someone else', 'not-mine', NULL, '2026-11-08');
    INSERT INTO cluster_folders (user_id, name) VALUES (7, 'EE year 2'), (7, 'EE year 2/Semester 1');
  `);
  const scans = [];
  state.scanGarden = (contentPath, slug, options) => new Promise((resolve, reject) => {
    assert.equal(options.maxStaleMs, 10000);
    scans.push({ slug, resolve, reject });
  });
  const library = loadBundle(libraryBundle);
  let finished = false;
  const rebuilding = library.refreshPrivateQuartzIndexCooperatively(7).then(slug => {
    finished = true;
    return slug;
  });
  const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
  await yieldTurn();
  assert.deepEqual(scans.map(scan => scan.slug), ["neuro-comp"]);
  assert.equal(finished, false);
  const stats = { documents: 1, topics: 1, textbookPages: 1, conceptPages: 0,
    conceptNodes: 0, learningPages: 1, generatedNotes: 0, links: 2, words: 120 };
  scans[0].resolve({ stats });
  await yieldTurn();
  assert.deepEqual(scans.map(scan => scan.slug), ["neuro-comp", "circuits"]);
  scans[1].resolve({ stats });
  await yieldTurn();
  assert.deepEqual(scans.map(scan => scan.slug), ["neuro-comp", "circuits", "missing"]);
  database.exec(`
    DELETE FROM clusters WHERE slug = 'circuits';
    UPDATE clusters SET name = 'Neuro Comp renamed' WHERE slug = 'neuro-comp';
    INSERT INTO clusters (user_id, name, slug, folder) VALUES
      (7, 'New during refresh', 'new-during-refresh', 'EE year 2/Semester 1');
  `);
  scans[2].reject(Error("Source unavailable"));
  const slug = await rebuilding;
  assert.equal(slug, "private-library/user-7");
  const index = fs.readFileSync(path.join(directory, slug, "_index.md"), "utf8");
  assert.match(index, /Gardens: 3/);
  assert.match(index, /Indexed words: 120/);
  assert.match(index, /Neuro Comp renamed/);
  assert.match(index, /New during refresh/);
  assert.doesNotMatch(index, /Someone else|Circuits/);
  for (const folder of ["EE year 2", "EE year 2/Semester 1"]) {
    const token = Buffer.from(folder).toString("base64url");
    const contents = fs.readFileSync(path.join(directory, slug, `cluster-${token}`, "_index.md"), "utf8");
    assert.match(contents, /Neuro Comp/);
    if (folder.endsWith("Semester 1")) assert.doesNotMatch(contents, /Circuits/);
  }
});
