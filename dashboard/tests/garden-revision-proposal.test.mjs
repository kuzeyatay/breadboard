import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { applyGardenRevision } from "../src/lib/garden-revision.ts";

test("replacement previews apply as Markdown while retaining hidden page metadata", () => {
  const current = '---\ntitle: Fields\nknowledge_type: learning-page\n---\n\nOld introduction\n';
  assert.equal(applyGardenRevision(current, "# Fields\n\nAtoms and charge."), current.slice(0, current.indexOf("Old introduction")) + "# Fields\n\nAtoms and charge.\n");
  assert.equal(applyGardenRevision("Old", "```markdown\nNew\n```"), "New\n");
  assert.equal(applyGardenRevision(current, "---\ntitle: Revised\n---\nNew"), "---\ntitle: Revised\n---\nNew\n");
  assert.throws(() => applyGardenRevision(current, "  "), /empty/);
});

test("unified revisions preserve the rest of the page and reject mismatched or multiple-file patches", () => {
  const current = "# Fields\n\nOld introduction\n\n## Rest\nUnchanged\n";
  const patch = "--- a/fields.md\n+++ b/fields.md\n@@ -3,1 +3,2 @@\n-Old introduction\n+Atoms and charge\n+Electric and magnetic fields\n";
  assert.equal(applyGardenRevision(current, patch), current.replace("Old introduction", "Atoms and charge\nElectric and magnetic fields"));
  assert.equal(applyGardenRevision(current.replaceAll("\n", "\r\n"), patch).includes("\r\n"), true);
  assert.throws(() => applyGardenRevision(current.replace("Old introduction", "Someone edited this"), patch), /does not match/);
  assert.throws(() => applyGardenRevision(current, patch.replace("-3,1", "-3,2")), /does not match/);
  assert.throws(() => applyGardenRevision(current, patch + "--- a/other.md\n+++ b/other.md\n@@ -1 +1 @@\n-old\n+new"), /does not match/);
  assert.throws(() => applyGardenRevision(current, "*** Begin Patch\n*** Delete File: fields.md\n*** End Patch"), /does not match/);
  assert.equal(applyGardenRevision("old", "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n"), "new\n");
  assert.equal(applyGardenRevision("old\n", "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n"), "new");
  assert.equal(applyGardenRevision("old\n \n", "@@ -1,2 +1,2 @@\n-old\n+new\n  \n"), "new\n \n");
});

test("context-only revisions match exact, unique blocks while preserving metadata and untouched sections", () => {
  const current = '---\ntitle: Fields\n---\n\n# Fields\nOld introduction\n\n## Rest\nCoordinates\nUnchanged\n';
  const patch = "@@\n-Old introduction\n+Atoms and charge\n+Electric and magnetic fields\n@@\n-Coordinates\n+Coordinates and basis vectors";
  const expected = current.replace("Old introduction", "Atoms and charge\nElectric and magnetic fields").replace("Coordinates", "Coordinates and basis vectors");
  assert.equal(applyGardenRevision(current, patch), expected);
  assert.equal(applyGardenRevision(current.replaceAll("\n", "\r\n"), patch), expected.replaceAll("\n", "\r\n"));
  assert.equal(applyGardenRevision(current, "```diff\n" + patch + "\n```"), expected);
  assert.equal(applyGardenRevision("start\nend\n", "@@\n start\n+inserted\n end"), "start\ninserted\nend\n");
  for (const invalid of [
    patch.replace("-Old introduction", "-Stale introduction"),
    "@@\n+Unanchored insertion",
    "@@\n-Coordinates\n+New\n@@\n-Old introduction\n+Out of order",
    "@@\n-Old introduction\n+New\n--- a/other.md\n+++ b/other.md\n@@\n-Coordinates\n+Other",
    "@@\n-Old introduction\n+New\nMalformed patch line",
  ]) {
    assert.throws(() => applyGardenRevision(current, invalid), error => error.status === 409 && error.code === "revision_conflict");
  }
  assert.throws(() => applyGardenRevision("same\nsame\n", "@@\n-same\n+ambiguous"), /does not match/);
});

for (const namespaced of [false, true]) {
test(`the Garden writer saves promptly despite a stalled or failed publication (${namespaced ? "Windows extended" : "ordinary"} paths)`, { skip: namespaced && process.platform !== "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-revision-"));
  const root = path.join(dir, "content"), garden = path.join(root, "physics");
  fs.mkdirSync(path.join(garden, "unit"), { recursive: true });
  const file = path.join(garden, "unit", "fields.md");
  fs.writeFileSync(file, "# Fields\nOld introduction\n");
  const fixture = { refreshes: 0, publishes: [], fail: false, stalled: true, leased: false };
  globalThis.__gardenRevisionFixture = fixture;
  const priorRoot = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = namespaced ? path.toNamespacedPath(root) : root;
  try {
    const result = await build({
      entryPoints: [new URL("../src/lib/garden-documents.ts", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, "")],
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "publication-fixture", setup(builder) {
        builder.onResolve({ filter: /\/(knowledge|quartz-publish|garden-mutation-lease)\.ts$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
          args.path.includes("knowledge") ? `import fs from 'node:fs';import path from 'node:path';
            export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-');export const normalizeTopicTags=()=>[];
            export const refreshClusterIndex=()=>globalThis.__gardenRevisionFixture.refreshes++;
            export const walkClusterMarkdown=dir=>fs.readdirSync(path.join(dir,'unit')).filter(n=>n.endsWith('.md')).map(entry=>({entry,filePath:path.join(dir,'unit',entry),relPath:'unit/'+entry,folder:'unit'}));`
            : args.path.includes("quartz-publish") ? `export async function publishQuartzAfterMutation(...args){const f=globalThis.__gardenRevisionFixture;if(f.leased)throw Error('publication held the lease');f.publishes.push(args);if(f.fail)throw Error('publication failed');if(f.stalled)return new Promise(()=>{})}`
              : `export async function withGardenMutationLease(_dir,_operation,action){const f=globalThis.__gardenRevisionFixture;f.leased=true;try{return await action()}finally{f.leased=false}}`,
        }));
      } }],
    });
    const loaded = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
    const { reviseGardenDocument } = loaded.exports;
    const input = { userId: 1, clusterSlug: "physics", pageSlug: "unit/fields", patchOrReplacement: "@@\n-Old introduction\n+Atoms and charge" };
    const document = await Promise.race([reviseGardenDocument(input), new Promise((_,reject)=>setTimeout(()=>reject(Error('Apply waited for publication')),500))]);
    assert.equal(fs.readFileSync(file, "utf8"), "# Fields\nAtoms and charge\n");
    assert.equal(document.slug, "unit/fields");
    assert.equal(fixture.publishes.length, 1);
    assert.deepEqual(fixture.publishes[0][1], { userId: 1, gardenSlug: "physics" });
    fixture.fail = true;
    const saved = await reviseGardenDocument({ ...input, patchOrReplacement: "Saved despite failed publication" });
    assert.equal(fs.readFileSync(file, "utf8"), saved.content);
    await assert.rejects(reviseGardenDocument({ ...input, pageSlug: "../fields" }), /Invalid revision/);
    await assert.rejects(reviseGardenDocument({ ...input, pageSlug: "missing" }), /one existing page/);
    // A linked folder must not turn a valid-looking page slug into a write
    // outside this Garden, including when the configured root is namespaced.
    const outside = path.join(dir, "outside");
    fs.renameSync(path.join(garden, "unit"), outside);
    fs.symlinkSync(outside, path.join(garden, "unit"), "junction");
    await assert.rejects(reviseGardenDocument(input), /Invalid revision destination/);
    assert.equal(fs.readFileSync(path.join(outside, "fields.md"), "utf8"), saved.content);
  } finally {
    if (priorRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = priorRoot;
    delete globalThis.__gardenRevisionFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
}

test("Apply marks a revision decided only after its canonical write succeeds", async () => {
  const file = new URL("../src/app/api/gardens/[gardenId]/proposals/[proposalId]/route.ts", import.meta.url);
  const tree = ts.createSourceFile("route.ts", fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const handler = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
  const js = ts.transpileModule(handler.getText(tree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fail of [false, true]) {
    const sequence = [];
    const dependencies = {
      requireUserId: async () => 1, authorizeGardenAccess: () => ({ isOwner: true, slug: "physics", clusterId: 1 }),
      getProposalById: () => ({ garden_id: "physics", page_slug: "unit/fields", status: "pending", kind: "page_revision", payload: JSON.stringify({ patchOrReplacement: "New introduction" }) }),
      readJsonBody: async request => request.json(),
      reviseGardenDocument: async input => { sequence.push("write"); assert.equal(input.patchOrReplacement, "New introduction"); if (fail) throw Error("write failed"); return { slug: "unit/fields" }; },
      setProposalStatus: (_id, status) => sequence.push(status), NextResponse: { json: value => Response.json(value) },
      apiErrorResponse: error => Response.json({ error: error.message }, { status: 500 }),
    };
    const post = new Function(...Object.keys(dependencies), `${js};return POST`)(...Object.values(dependencies));
    const response = await post(new Request("http://localhost/proposal", { method: "POST", body: JSON.stringify({ decision: "apply" }) }), { params: Promise.resolve({ gardenId: "physics", proposalId: "2" }) });
    assert.equal(response.status, fail ? 500 : 200);
    assert.deepEqual(sequence, fail ? ["write"] : ["write", "applied"]);
  }
});
