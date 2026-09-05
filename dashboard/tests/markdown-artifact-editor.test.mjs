import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");
const page = source("../src/app/artifacts/[artifactId]/markdown/page.tsx");
const editor = source("../src/app/artifacts/[artifactId]/markdown/markdown-artifact-editor.tsx");
const assistantRoute = source("../src/app/api/hermes/artifacts/[artifactId]/markdown/ai/route.ts");
const store = source("../src/lib/hermes/artifact-store.ts");
const renderer = source("../src/lib/hermes/artifact-renderers.ts");
const artifactTool = source("../../hermes-config/tool/artifact.ts");

test("Markdown Edit opens the dedicated editor inside the current window", () => {
  assert.match(viewer, /artifactMarkdownEditorHref/);
  assert.match(viewer, /\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}\/markdown/);
  assert.match(viewer, /onClick=\{\(\) => setMarkdownEditorOpen\(true\)\}/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /<MarkdownArtifactEditor[\s\S]*?onClose=\{\(\) => setMarkdownEditorOpen\(false\)\}/);
  assert.doesNotMatch(viewer, /window\.open\([\s\S]*?breadboard-markdown/);
  assert.match(editor, /onClose\?: \(\) => void/);
  assert.match(editor, /<ConfirmDialog/);
  assert.match(editor, /cancelLabel="Keep editing"/);
  assert.match(editor, /confirmLabel="Discard changes"/);
  assert.doesNotMatch(editor, /window\.confirm\(/);
});

test("the editor is user-scoped and reuses Breadboard's chat UI", () => {
  assert.match(page, /getServerSession\(authOptions\)/);
  assert.match(page, /getArtifactForUser/);
  assert.match(page, /artifact\.kind !== "markdown"/);
  assert.match(editor, /<AssistantComposer/);
  assert.match(editor, /<ChatMarkdown content=\{content\}/);
  assert.match(editor, /Bread Markdown assistant/);
  assert.match(editor, /method: "PUT"/);
  assert.match(editor, /expectedVersion: expectedArtifact\.version/);
  assert.match(editor, /broadcastArtifactUpdate\(body\.artifact\)/);
});

test("Bread edits use the open source and reject damaged Markdown", () => {
  assert.match(assistantRoute, /Current Markdown:/);
  assert.match(assistantRoute, /content is the complete updated Markdown document/);
  assert.match(assistantRoute, /normalizeProducedMarkdown\(parsed\.content\)/);
  assert.match(assistantRoute, /markdownIntegrityIssue\(content\)/);
});

test("storage and rendering normalize Markdown before it can become an artifact", () => {
  assert.match(store, /normalizeProducedMarkdown\(content\)/);
  assert.match(store, /throw new ArtifactStoreError\(400, "invalid_markdown_encoding", issue\)/);
  assert.match(store, /validateContent\(input\.content, input\.rendererId\)/);
  assert.match(renderer, /markdownIntegrityIssue\(normalizeProducedMarkdown\(content\)\)/);
  assert.match(renderer, /kind === "markdown" \? normalizeProducedMarkdown\(content\) : content/);
});

test("artifact tool contracts tell producers to preserve JSON-escaped LaTeX", () => {
  assert.match(artifactTool, /delimit all LaTeX with \$\.\.\.\$ or \$\$\.\.\.\$\$/);
  assert.ok(
    artifactTool.match(/JSON-escape every LaTeX backslash/g)?.length >= 3,
    "create and revision tools keep LaTeX backslashes intact",
  );
});
