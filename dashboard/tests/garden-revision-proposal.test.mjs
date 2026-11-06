import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { applyGardenRevision, prepareGardenRevision, createGardenRevision } from "../src/lib/garden-revision.ts";
import { ApiError } from "../src/lib/hermes/route-core.ts";
import { teachingReviewHash } from "../src/lib/teaching-plan.ts";
import { gardenProposalDecisionFixture } from "./helpers/garden-proposal-decision-fixture.mjs";

test('patch review ranges contain additions only, with exact CRLF and Unicode offsets', () => {
  const original = '\uFEFFTitle 🧭\r\nFirst\r\nKeep\r\nLast\r\n';
  const patch = '@@ -1,4 +1,6 @@\n \uFEFFTitle 🧭\n-First\n+New first\n+\n+Its explanation\n Keep\n-Last\n+New last\n';
  const prepared = prepareGardenRevision(original, patch);
  assert.equal(prepared.content, '\uFEFFTitle 🧭\r\nNew first\r\n\r\nIts explanation\r\nKeep\r\nNew last\r\n');
  assert.deepEqual(prepared.addedRanges.map(range => prepared.content.slice(range.start, range.end)),
    ['New first\r\n\r\nIts explanation', 'New last']);
  assert.deepEqual(prepareGardenRevision('Before\nDelete\nAfter', '@@ -1,3 +1,2 @@\n Before\n-Delete\n After\n\\ No newline at end of file').addedRanges, []);
});

test('reviewed prose returns to exact targeted hunks and preserves independent edits', () => {
  const current = '\uFEFF---\r\ntitle: Keep\r\n---\r\nHeading\r\nFirst\r\n' + 'Context\r\n'.repeat(9) + 'Second\r\nEnd';
  const revised = current.replace('First', 'The first explanation.\r\n\r\nIts worked example.').replace('Second', 'The second explanation.');
  const patch = createGardenRevision(current, revised);
  assert.equal(applyGardenRevision(current, patch), revised);
  assert.equal(applyGardenRevision('Independent prefix\r\n' + current + '\r\nIndependent ending', patch, undefined, { relocateHunks: true }),
    'Independent prefix\r\n' + revised + '\r\nIndependent ending');
  assert.throws(() => applyGardenRevision(current.replace('First', 'A conflicting edit'), patch, undefined, { relocateHunks: true }),
    error => error.status === 409);
});

test("replacement scope is explicit, including full-body rewrites, while metadata stays intact", () => {
  const current = '---\ntitle: Fields\nknowledge_type: learning-page\n---\n\nOld introduction\n';
  assert.equal(applyGardenRevision(current, "# Fields\n\nAtoms and charge.", "Old introduction"), current.slice(0, current.indexOf("Old introduction")) + "# Fields\n\nAtoms and charge.\n");
  assert.equal(applyGardenRevision("Old", "New", "Old"), "New");
  assert.throws(() => applyGardenRevision(current, "  "), /empty/);
});

test("the reported paragraph replacement cannot overwrite the note", () => {
  const paragraph = 'A field is a nonempty set $F$, together with two binary operations.';
  const revised = 'A field is a nonempty set $F$, where a **set** is a collection of distinct objects called **elements**, together with two binary operations.';
  const prefix = '\uFEFF---\r\ntitle: Fields\r\n---\r\n\r\n### Fields, vectors, scalar fields, and vector fields\r\n\r\n';
  const suffix = '\r\n\r\nAxioms\r\n\r\n## Vector spaces\r\n$V = \\mathbb R^3$\r\n\r\n## Scalar and vector fields\r\nEverything else stays.  \r\n';
  const current = prefix + paragraph + suffix;
  assert.equal(applyGardenRevision(current, revised, paragraph), prefix + revised + suffix);
  for (const unsafe of [revised, 'Replace the opening paragraph under `### Fields, vectors, scalar fields, and vector fields` with:\n\n' + revised, '```markdown\n' + revised + '\n```']) {
    assert.throws(() => applyGardenRevision(current, unsafe), error => error.code === 'revision_target_required');
  }
});

test("targeted edits preserve literal Markdown and support insertion and deletion without guessing", () => {
  const current = 'Before\n\nOld\n\nAfter';
  assert.equal(applyGardenRevision(current, 'Old\n\nAn example: $S = \\{1,2\\}$; 1 is an element.', 'Old'), current.replace('Old', 'Old\n\nAn example: $S = \\{1,2\\}$; 1 is an element.'));
  assert.equal(applyGardenRevision(current, '', 'Old\n\n'), 'Before\n\nAfter');
  assert.equal(applyGardenRevision(current, "```js\n'$&'\n```", 'Old'), "Before\n\n```js\n'$&'\n```\n\nAfter");
  for (const target of ['Missing', 'Old ']) assert.throws(() => applyGardenRevision(current, 'New', target), error => error.code === 'revision_conflict');
  assert.throws(() => applyGardenRevision(current, 'New', ''), error => error.code === 'empty_revision_target');
  assert.throws(() => applyGardenRevision('Old\nOld', 'New', 'Old'), error => error.code === 'revision_conflict');
  assert.throws(() => applyGardenRevision('aaa', 'b', 'aa'), error => error.code === 'revision_conflict');
  assert.equal(applyGardenRevision('Old\nOld\nAfter', 'New\nAfter', 'Old\nAfter'), 'Old\nNew\nAfter');
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

test("stale numbered diffs relocate exact source blocks without trusting old line numbers", () => {
  const base = '# Page\nFirst\n\nSecond\n\nThird\n';
  const current = base.replace('First', 'First revised\nExtra explanation');
  const patch = '@@ -4 +4,2 @@\n-Second\n+Second revised\n+More detail\n@@ -6 +7 @@\n-Third\n+Third revised';
  const relocate = { relocateHunks: true };
  const expected = current.replace('Second', 'Second revised\nMore detail').replace('Third', 'Third revised');
  assert.equal(applyGardenRevision(current, patch, undefined, relocate), expected);
  assert.equal(applyGardenRevision(current.replaceAll('\n', '\r\n'), patch, undefined, relocate), expected.replaceAll('\n', '\r\n'));
  assert.throws(() => applyGardenRevision(current, patch), error => error.code === 'revision_conflict');
  for (const [page, invalid] of [
    [current.replace('Second', 'Already edited'), patch],
    [current + 'Second\n', patch],
    [current, patch.replace('-4 +4,2', '-4,2 +4,2')],
    [current, patch.replace('-6 +7', '-6 +8')],
    [current, '@@ -4,0 +5 @@\n+Unanchored insertion'],
    [current, '@@ -4 +4 @@\n-Second\n+Changed\n@@ -4 +4 @@\n-Third\n+Changed'],
    [current, '@@ -4 +4 @@\n-Third\n+Changed\n@@ -6 +6 @@\n-Second\n+Changed'],
    [current, patch + '\n--- a/other.md\n+++ b/other.md\n@@ -1 +1 @@\n-old\n+new'],
  ]) {
    assert.throws(() => applyGardenRevision(page, invalid, undefined, relocate), error => error.status === 409 && error.code === 'revision_conflict');
  }
  assert.equal(applyGardenRevision(current, '@@ -4 +4,2 @@\n Second\n+Anchored insertion', undefined, relocate), current.replace('Second', 'Second\nAnchored insertion'));
  assert.equal(applyGardenRevision(current, '@@ -4 +3,0 @@\n-Second', undefined, relocate), current.replace('Second\n', ''));
});

test("fresh proposals still reject sentence fragments and reformatted equations in diffs", () => {
  const sentence = 'Vector addition assigns a sum to each pair of vectors.';
  const equation = '\\mathbf u+\\mathbf v\n=\n\\mathbf v+\\mathbf u,';
  const current = '---\ntitle: Fields\n---\n\nLet $F$ be a field. ' + sentence + ' These operations satisfy the following axioms.\n\n$$\n' + equation + '\n$$\n\nUnchanged ending.\n';
  for (const malformed of [
    '@@\n-' + sentence + '\n+Vector addition assigns a vector sum.',
    '@@\n-\\mathbf u+\\mathbf v\n-=\\mathbf v+\\mathbf u,\n+\\vec{u}+\\vec{v}=\\vec{v}+\\vec{u},',
    '@@\n-' + equation.replaceAll('\n', '\n-').replace(/,$/, '.') + '\n+New equation',
  ]) {
    assert.throws(() => applyGardenRevision(current, malformed), error => error.code === 'revision_conflict' && /complete source lines/.test(error.message));
  }
  const replacement = '\\vec{u}+\\vec{v}\n=\n\\vec{v}+\\vec{u},';
  assert.equal(applyGardenRevision(current, replacement, equation), current.replace(equation, replacement));
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
              : `export const assertGardenMutationWritePaths=()=>{};export async function withGardenMutationLease(_dir,_operation,action){const f=globalThis.__gardenRevisionFixture;f.leased=true;try{return await action()}finally{f.leased=false}}`,
        }));
      } }],
    });
    const loaded = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
    const { reviseGardenDocument } = loaded.exports;
    const base = '# Fields\nOld introduction\n\n## Rest\nOld ending\n';
    const baseHash = teachingReviewHash(base, null);
    const edit = { userId: 1, clusterSlug: 'physics', pageSlug: 'unit/fields', teachingBaseHash: baseHash };
    fs.writeFileSync(file, base);
    await reviseGardenDocument({ ...edit, originalText: 'Old introduction', patchOrReplacement: 'Atoms and charge\nWith an example' });
    await reviseGardenDocument({ ...edit, patchOrReplacement: '@@ -5 +5,2 @@\n-Old ending\n+Revised ending\n+An exercise' });
    await reviseGardenDocument({ ...edit, patchOrReplacement: '@@\n-## Rest\n+## Explanation' });
    const combined = '# Fields\nAtoms and charge\nWith an example\n\n## Explanation\nRevised ending\nAn exercise\n';
    assert.equal(fs.readFileSync(file, 'utf8'), combined, 'All three reviews from the same base apply without discarding earlier edits');
    const independentWrites = fixture.refreshes;
    await assert.rejects(reviseGardenDocument({ ...edit, originalText: 'Old introduction', patchOrReplacement: 'Conflicting edit' }), error => error.code === 'revision_conflict');
    await assert.rejects(reviseGardenDocument({ ...edit, originalText: base, patchOrReplacement: 'Stale whole-page replacement' }), error => error.code === 'revision_conflict');
    assert.equal(fs.readFileSync(file, 'utf8'), combined);
    assert.equal(fixture.refreshes, independentWrites);
    fs.writeFileSync(file, '# Fields\nOld introduction\n');
    fixture.refreshes = 0;
    fixture.publishes = [];
    const input = { userId: 1, clusterSlug: "physics", pageSlug: "unit/fields", patchOrReplacement: "@@\n-Old introduction\n+Atoms and charge" };
    const document = await Promise.race([reviseGardenDocument(input), new Promise((_,reject)=>setTimeout(()=>reject(Error('Apply waited for publication')),500))]);
    assert.equal(fs.readFileSync(file, "utf8"), "# Fields\nAtoms and charge\n");
    assert.equal(document.slug, "unit/fields");
    assert.equal(fixture.publishes.length, 1);
    assert.deepEqual(fixture.publishes[0][1], { userId: 1, gardenSlug: "physics" });
    fixture.fail = true;
    const saved = await reviseGardenDocument({ ...input, originalText: "Atoms and charge", patchOrReplacement: "Saved despite failed publication" });
    assert.equal(fs.readFileSync(file, "utf8"), saved.content);
    assert.equal(saved.content, "# Fields\nSaved despite failed publication\n");
    const writes = fixture.refreshes;
    for (const invalid of [{ patchOrReplacement: 'Replace the introduction with: New' }, { originalText: 'Atoms and charge', patchOrReplacement: 'Stale edit' }]) {
      await assert.rejects(reviseGardenDocument({ ...input, ...invalid }));
      assert.equal(fs.readFileSync(file, "utf8"), saved.content);
      assert.equal(fixture.refreshes, writes);
    }
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
      getProposalById: () => ({ garden_id: "physics", page_slug: "unit/fields", status: "pending", kind: "page_revision", payload: JSON.stringify({ patchOrReplacement: "New introduction", originalText: "Old introduction" }) }),
      readJsonBody: async request => request.json(),
      reviseGardenDocument: async input => { sequence.push("write"); assert.equal(input.patchOrReplacement, "New introduction"); assert.equal(input.originalText, "Old introduction"); if (fail) throw Error("write failed"); return { slug: "unit/fields" }; },
      setProposalStatus: (_id, status) => sequence.push(status), NextResponse: { json: value => Response.json(value) },
      apiErrorResponse: error => Response.json({ error: error.message }, { status: 500 }),
    };
    dependencies.decideGardenProposal = gardenProposalDecisionFixture(dependencies);
    const serviceTree = ts.createSourceFile("proposal-decisions.ts", fs.readFileSync(new URL("../src/lib/hermes/proposal-decisions.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const serviceHandler = serviceTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "decideGardenProposal");
    const serviceJs = ts.transpileModule(serviceHandler.getText(serviceTree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    dependencies.decideGardenProposal = new Function(...Object.keys(dependencies), `${serviceJs};return decideGardenProposal`)(...Object.values(dependencies));
    const post = new Function(...Object.keys(dependencies), `${js};return POST`)(...Object.values(dependencies));
    const response = await post(new Request("http://localhost/proposal", { method: "POST", body: JSON.stringify({ decision: "apply" }) }), { params: Promise.resolve({ gardenId: "physics", proposalId: "2" }) });
    assert.equal(response.status, fail ? 500 : 200);
    assert.deepEqual(sequence, fail ? ["write"] : ["write", "applied"]);
  }
});

test("retrying an already decided proposal never writes or creates another note", async () => {
  const file = new URL("../src/app/api/gardens/[gardenId]/proposals/[proposalId]/route.ts", import.meta.url);
  const tree = ts.createSourceFile("route.ts", fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const handler = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
  const js = ts.transpileModule(handler.getText(tree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const kind of ['note', 'page_revision']) for (const status of ['applied', 'rejected']) for (const decision of ['apply', 'reject']) {
    const writes = [];
    const dependencies = {
      requireUserId: async () => 1, authorizeGardenAccess: () => ({ isOwner: true, slug: 'physics' }),
      getProposalById: () => ({ garden_id: 'physics', page_slug: 'unit/fields', status, kind, payload: JSON.stringify({ title: 'Fields', content: 'New note' }) }),
      readJsonBody: async request => request.json(),
      createGardenDocument: async () => { writes.push('create'); return {}; },
      reviseGardenDocument: async () => { writes.push('revise'); return {}; },
      setProposalStatus: () => writes.push('decide'), ApiError,
      NextResponse: { json: value => Response.json(value) },
      apiErrorResponse: error => Response.json({ error: error.message, code: error.code }, { status: error.status ?? 500 }),
    };
    dependencies.decideGardenProposal = gardenProposalDecisionFixture(dependencies);
    const serviceTree = ts.createSourceFile("proposal-decisions.ts", fs.readFileSync(new URL("../src/lib/hermes/proposal-decisions.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const serviceHandler = serviceTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "decideGardenProposal");
    const serviceJs = ts.transpileModule(serviceHandler.getText(serviceTree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    dependencies.decideGardenProposal = new Function(...Object.keys(dependencies), `${serviceJs};return decideGardenProposal`)(...Object.values(dependencies));
    const post = new Function(...Object.keys(dependencies), `${js};return POST`)(...Object.values(dependencies));
    const response = await post(new Request('http://localhost/proposal', { method: 'POST', body: JSON.stringify({ decision }) }), { params: Promise.resolve({ gardenId: 'physics', proposalId: '2' }) });
    const repeatedDecision = status === (decision === 'apply' ? 'applied' : 'rejected');
    assert.equal(response.status, repeatedDecision ? 200 : 409, `${kind}: ${status} -> ${decision}`);
    assert.deepEqual(writes, []);
  }
});
