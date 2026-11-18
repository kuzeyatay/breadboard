import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cross-garden-"));
process.env.BREADBOARD_DATA_DIR = root;
await import("../scripts/learn-worker-import-hook.mjs");
const { lazyRetrievalGarden } = await import("../src/lib/hermes/garden-reader.ts");
const { retrieveAcrossGardens, graphEvidence, pastQuestionLinks } = await import("../src/lib/hermes/cross-garden-retrieval.ts");
const { createEphemeralRetrievalDatabase, indexedFingerprint } = await import("../src/lib/semantic-retrieval.ts");

const content = path.join(root, "content");
function page(garden, name, title, body) {
  const file = path.join(content, garden, "notes", `${name}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntitle: "${title}"\nknowledge_type: "user-note"\n---\n# ${title}\n${body}\n`);
}
page("math", "hyperplanes", "Hyperplanes", "A hyperplane is the set of points x with n . x = d for a nonzero normal vector n.");
page("math", "fields", "Definition of a field", "A definition: a field is a set with addition and multiplication.");
page("math", "normals", "Normal vectors", "The normal vector is perpendicular to every direction in the plane.");
page("ml", "perceptron", "Perceptron", "The perceptron decision boundary is a hyperplane w . x + b = 0.");
page("ml", "training", "Training loops", "A definition of an epoch: one pass over the training data.");
// As in real notes, "definition" is common and "hyperplane" rare.
for (const [garden, name] of [["math", "rank"], ["math", "span"], ["ml", "loss"], ["ml", "batch"]]) {
  page(garden, name, `${name} basics`, `The definition of ${name} follows from the definition above.`);
}
const otherGarden = (slug) => ({ slug, name: slug, rootPath: path.join(content, slug), resolve: () => lazyRetrievalGarden(content, { slug, name: slug }) });
const gardens = async () => Promise.all(["math", "ml"].map((slug) => lazyRetrievalGarden(content, { slug, name: slug })));

test("the open Garden is searched in full, another Garden only for passages naming the question", async () => {
  const database = createEphemeralRetrievalDatabase();
  const [math, ml] = await gardens();
  // First turn: ml has never been indexed, so it is refreshed off the turn and absent from it.
  const first = await retrieveAcrossGardens({ query: "What's the definition of a hyperplane", primary: [math], others: [otherGarden("ml")], database });
  assert.equal(first.chunks[0].pageTitle, "Hyperplanes", "the rare word outranks the common one");
  assert.ok(first.chunks.every((chunk) => chunk.gardenSlug === "math"));
  for (let wait = 0; wait < 100 && indexedFingerprint(database, "ml") !== ml.fingerprint; wait += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(indexedFingerprint(database, "ml"), ml.fingerprint, "the background refresh recorded the Garden");

  const second = await retrieveAcrossGardens({ query: "What's the definition of a hyperplane", primary: [math], others: [otherGarden("ml")], database });
  const other = second.chunks.slice(second.primaryCount).map((chunk) => chunk.pageTitle);
  assert.deepEqual(other, ["Perceptron"], "names the hyperplane; the epoch page shares only 'definition'");
  assert.ok(second.focused.some((chunk) => chunk.pageTitle === "Hyperplanes"));
  assert.ok(!second.focused.some((chunk) => chunk.pageTitle === "Definition of a field"));
  assert.deepEqual(second.notRetrieved, []);

  const absent = await retrieveAcrossGardens({ query: "what is an eigenvalue", primary: [math], others: [otherGarden("ml")], database });
  assert.deepEqual(absent.notInGardens, ["eigenvalue"]);
});

test("an unchanged Garden is not re-read; a changed one is", async () => {
  const database = createEphemeralRetrievalDatabase();
  let reads = 0;
  const counted = async () => {
    const garden = await lazyRetrievalGarden(content, { slug: "math", name: "math" });
    return { ...garden, loadNodes: () => { reads += 1; return garden.loadNodes(); } };
  };
  await retrieveAcrossGardens({ query: "hyperplane", primary: [await counted()], others: [], database });
  await retrieveAcrossGardens({ query: "hyperplane", primary: [await counted()], others: [], database });
  assert.equal(reads, 1);
  page("math", "affine", "Affine sets", "An affine set is a translated subspace, like a hyperplane.");
  const changed = await retrieveAcrossGardens({ query: "affine set", primary: [await counted()], others: [], database });
  assert.equal(reads, 2);
  assert.equal(changed.chunks[0].pageTitle, "Affine sets");
});

test("map links add the linked page's passage closest to the question, typed links first", async () => {
  const database = createEphemeralRetrievalDatabase();
  const [math] = await gardens();
  await retrieveAcrossGardens({ query: "hyperplane", primary: [math], others: [], database });
  const linked = graphEvidence({
    query: "definition of a hyperplane",
    database,
    exclude: new Set(["math\0notes/hyperplanes.md"]),
    links: [
      { gardenSlug: "math", relPath: "notes/fields.md", weight: 0.9, reads: "Hyperplanes and Fields are related.", typed: false },
      { gardenSlug: "math", relPath: "notes/normals.md", weight: 0.5, reads: "Hyperplanes depends on Normal vectors.", typed: true },
      { gardenSlug: "math", relPath: "notes/hyperplanes.md", weight: 1, reads: "self", typed: true },
    ],
    limit: 1,
  });
  assert.deepEqual(linked.map((chunk) => [chunk.pageTitle, chunk.relationshipPaths[0]]),
    [["Normal vectors", "Hyperplanes depends on Normal vectors."]]);
});

test("an earlier question like this one brings the page its answer cited", async () => {
  const database = createEphemeralRetrievalDatabase();
  const [math] = await gardens();
  await retrieveAcrossGardens({ query: "hyperplane", primary: [math], others: [], database });
  const edge = (chat, target, text) => ({ source: `chat:${chat}`, target, explanation: { state: "ready", text } });
  const topology = {
    nodes: [{ id: "n1", kind: "page", relPath: "notes/normals.md" }, { id: "n2", kind: "page", relPath: "notes/fields.md" }],
    edges: [
      edge(1, "n1", 'You asked "how do I find the hyperplane through three points" and the answer cited Normal vectors.'),
      edge(2, "n2", 'You asked "give me the definition of a field" and the answer cited Definition of a field.'),
      { source: "n1", target: "n2", explanation: { state: "ready", text: "a hyperplane map edge, not a chat" } },
    ],
  };
  const links = pastQuestionLinks({ query: "What's the definition of a hyperplane", gardenSlug: "math", topology, database });
  assert.deepEqual(links.map((link) => [link.relPath, link.typed]), [["notes/normals.md", true]]);
});
