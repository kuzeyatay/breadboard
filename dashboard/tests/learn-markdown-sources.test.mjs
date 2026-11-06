import assert from "node:assert/strict";
import test from "node:test";
import { buildLearnMarkdownFolders, isLearnSelectableSource, toggleLearnSourceSelection } from "../src/lib/learn-source-selection.ts";
import { selectLearnSources, selectLearnSyllabus, excludeSyllabusFromSources } from "../src/lib/learn-utils.ts";

const doc = (slug, type, relPath = `${slug}.md`) => ({ slug, id: slug, title: slug, type, relPath, body: `Content of ${slug}.` });
const documents = [
  doc("reference", "source-document", "sources/reference.md"),
  doc("my-note", "user-note", "notes/my-note.md"),
  doc("plain", "note"),
  doc("saved", "learning-page", "generated/saved.md"),
  doc("nested", "generated-note", "generated/week-1/nested.md"),
  doc("guide", "user-note", "generated/week-1/guide.md"),
  doc("legacy", "knowledge-topic", "generated/legacy.md"),
  doc("lesson", "learning-page", "learning/lesson.md"),
  doc("internal", "internal-concept", "Internal/Concept Graph/internal.md"),
  doc("artifact", "artifact", "artifacts/artifact.md"),
  doc("map", "learning-map", "learning/Learning Map.md"),
];

test("Learn accepts authored Markdown and saved generated pages while excluding its own output and internal cards", () => {
  assert.deepEqual(documents.filter(isLearnSelectableSource).map((document) => document.slug),
    ["reference", "my-note", "plain", "saved", "nested", "guide", "artifact"]);
  assert.equal(isLearnSelectableSource(doc("old-save", "textbook-page", "generated\\old-save.md")), true);
  const selected = selectLearnSources(documents.filter(isLearnSelectableSource), ["my-note", "saved", "guide"]);
  const teaching = excludeSyllabusFromSources(selected, selectLearnSyllabus(selected, "guide"));
  assert.deepEqual(teaching.map(({ slug, body }) => ({ slug, body })), [
    { slug: "my-note", body: "Content of my-note." }, { slug: "saved", body: "Content of saved." },
  ]);
  assert.throws(() => selectLearnSources(documents.filter(isLearnSelectableSource), ["lesson"]), /no longer available/);
});

test("a generated folder includes nested Markdown and excludes hidden topic cards", () => {
  const tree = buildLearnMarkdownFolders(documents);
  const generated = tree.folders.find((folder) => folder.path === "generated");
  assert.deepEqual(generated.sourceIds, ["saved", "nested", "guide"]);
  assert.deepEqual(generated.folders[0].sourceIds, ["nested", "guide"]);
  assert.deepEqual(tree.documents.map((document) => document.slug), ["plain"]);
  assert.equal(tree.sourceIds.includes("reference"), false);
});

test("file and folder toggles preserve other selections, exclude the syllabus, and clear stale IDs", () => {
  const generatedIds = ["saved", "nested", "guide"];
  const selected = toggleLearnSourceSelection(documents, null, generatedIds, "guide");
  assert.deepEqual(selected, ["reference", "saved", "nested"]);
  const partial = toggleLearnSourceSelection(documents, selected, ["nested"], "guide");
  assert.deepEqual(partial, ["reference", "saved"]);
  const all = toggleLearnSourceSelection(documents, partial, generatedIds, "guide");
  assert.deepEqual(all, selected);
  assert.deepEqual(toggleLearnSourceSelection(documents, all, generatedIds, "guide"), ["reference"]);
  assert.deepEqual(toggleLearnSourceSelection(documents, ["deleted", "guide", "my-note"], ["saved"], "guide"), ["my-note", "saved"]);
  assert.deepEqual(toggleLearnSourceSelection(documents, [], ["my-note"], null), ["my-note"]);
});
