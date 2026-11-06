import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";

test("chat approvals apply every independent revision, retry safely, and preserve conflicts and ownership", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-decisions-"));
  const root = path.join(dir, "content");
  fs.mkdirSync(path.join(root, "physics", "notes"), { recursive: true });
  const file = path.join(root, "physics", "notes", "filters.md");
  fs.writeFileSync(file, "# Filters\nLow pass\nHigh pass\nBand pass\n");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE conversation_messages(id INTEGER, conversation_id INTEGER, role TEXT);
    CREATE TABLE hermes_proposals(id INTEGER PRIMARY KEY, garden_id TEXT, page_slug TEXT,
    status TEXT, kind TEXT, payload TEXT, assistant_message_id INTEGER, created_by_user_id INTEGER);
    INSERT INTO conversation_messages VALUES (10, 100, 'assistant'), (20, 200, 'assistant');`);
  const add = (id, originalText, patchOrReplacement, owner = 10, user = 1, garden = "physics") => db.prepare(
    "INSERT INTO hermes_proposals VALUES (?, ?, 'notes/filters', 'pending', 'page_revision', ?, ?, ?)"
  ).run(id, garden, JSON.stringify({ originalText, patchOrReplacement }), owner, user);
  add(1, "Low pass", "Low pass explained");
  add(2, "High pass", "High pass explained");
  add(3, "Band pass", "Band pass explained");
  add(4, "Already changed", "Conflict");
  add(5, "# Filters", "Wrong chat", 20);
  add(6, "# Filters", "Wrong user", 10, 2);
  add(7, "# Filters", "Wrong garden", 10, 1, "chemistry");
  globalThis.__proposalDecisionDb = db;
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  try {
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL("../src/lib/hermes/proposal-decisions.ts", import.meta.url))],
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "isolated-authoring", setup(builder) {
        builder.onResolve({ filter: /\/(db|session-service|runtime-store|knowledge|quartz-publish|garden-mutation-lease|sync|sync-worker)\.ts$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
          args.path.endsWith("/db.ts") ? "export default globalThis.__proposalDecisionDb;"
          : args.path.endsWith("/session-service.ts") ? `export function authorizeGardenAccess(user,slug){return {isOwner:user===1,slug,clusterId:1}}`
          : args.path.endsWith("/runtime-store.ts") ? `const db=globalThis.__proposalDecisionDb;export const getProposalById=id=>db.prepare('SELECT * FROM hermes_proposals WHERE id=?').get(id);export const setProposalStatus=(id,status)=>db.prepare('UPDATE hermes_proposals SET status=? WHERE id=?').run(status,id);`
          : args.path.endsWith("/knowledge.ts") ? `import fs from 'node:fs';import path from 'node:path';export const slugify=s=>s;export const normalizeTopicTags=()=>[];export const refreshClusterIndex=()=>{};export const walkClusterMarkdown=dir=>fs.readdirSync(path.join(dir,'notes')).map(entry=>({entry,filePath:path.join(dir,'notes',entry),relPath:'notes/'+entry,folder:'notes'}));`
          : args.path.endsWith("/quartz-publish.ts") ? `export const publishQuartzAfterMutation=async()=>{};`
          : args.path.endsWith("/garden-mutation-lease.ts") ? `export const assertGardenMutationWritePaths=()=>{};export const withGardenMutationLease=async(_dir,_operation,action)=>action();`
          : `export const enqueueGardenSync=()=>{};export const ensureSyncWorkerStarted=()=>{};`
        }));
      } }],
    });
    const loaded = { exports: {} };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
    const { decideGardenProposals } = loaded.exports;
    const input = { userId: 1, gardenId: "physics", conversationId: 100, decision: "apply" };
    const result = await decideGardenProposals({ ...input, proposalIds: [1, 2, 3, 4, 5, 6, 7] });
    assert.equal(result.complete, false);
    assert.deepEqual(result.results.map(r => r.status), ["applied", "applied", "applied", "failed", "failed", "failed", "failed"]);
    const expected = "# Filters\nLow pass explained\nHigh pass explained\nBand pass explained\n";
    assert.equal(fs.readFileSync(file, "utf8"), expected);
    assert.equal((await decideGardenProposals({ ...input, proposalIds: [1, 2, 3, 3] })).complete, true);
    assert.equal(fs.readFileSync(file, "utf8"), expected);
    assert.deepEqual(db.prepare("SELECT status FROM hermes_proposals WHERE id>=4").all().map(r=>r.status), Array(4).fill("pending"));
    assert.equal((await decideGardenProposals({ ...input, proposalIds: [4], decision: "reject" })).complete, true);
    assert.equal((await decideGardenProposals({ ...input, proposalIds: [4] })).complete, false);
    await assert.rejects(decideGardenProposals({ ...input, proposalIds: [] }), /1 and 20/);
    await assert.rejects(decideGardenProposals({ ...input, proposalIds: [1.5] }), /1 and 20/);
  } finally {
    db.close(); delete globalThis.__proposalDecisionDb;
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only authenticated chat surfaces expose proposal decisions", () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) assert.ok(allowedToolsForSurface(surface).includes("garden_decide_proposals"));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("garden_decide_proposals"));
});
