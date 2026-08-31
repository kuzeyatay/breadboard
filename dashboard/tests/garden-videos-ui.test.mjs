import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

const componentSource = fs.readFileSync(
  new URL("../src/app/components/garden-video-import.tsx", import.meta.url),
  "utf8",
);

test("garden sidebar renders the Video & audio accordion directly after Links", () => {
  const linksSection = source.indexOf('aria-label="Add link"');
  const mediaSection = source.indexOf('aria-label="Add video or audio"', linksSection);

  assert.ok(linksSection >= 0, "Links accordion should exist");
  assert.ok(mediaSection > linksSection, "Video & audio should render after Links");
  assert.match(source, /const \[mediaExpanded, setMediaExpanded\] = useState\(false\)/);
  assert.match(source, /Video &amp; audio/);
});

test("the media panel hosts the functional transcription component", () => {
  const mediaSection = source.indexOf("{mediaExpanded && (");
  assert.ok(mediaSection >= 0);
  assert.match(source, /<GardenVideoImport\s/);
  assert.match(source, /onSourceCreated=\{handleMediaSourceCreated\}/);
  // The panel keeps its stable anchor id for accessibility.
  assert.match(componentSource, /id="garden-media-panel"/);
  assert.match(componentSource, /No video or audio yet\./);
});

test("Links and Video & audio open modal composers like Documents", () => {
  assert.match(source, /aria-label="Add link"/);
  assert.match(source, /setLinkComposerOpen\(true\)/);
  assert.match(source, /id="garden-link-composer-title"/);
  assert.match(source, /role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(source, /aria-label="Add video or audio"/);
  assert.match(source, /setMediaComposerOpen\(true\)/);
  assert.match(source, /composerOpen=\{mediaComposerOpen\}/);
  assert.match(source, /composerPresentation="modal"/);
  assert.match(source, /onComposerClose=\{\(\) => setMediaComposerOpen\(false\)\}/);
  assert.match(componentSource, /isOwner && composerOpen/);
  assert.match(componentSource, /bb-modal-backdrop fixed inset-0 z-50/);
  assert.match(componentSource, /aria-labelledby="garden-media-composer-title"/);
});

test("source library headings use title case instead of forced uppercase", () => {
  assert.doesNotMatch(source, /bb-neu-accordion[^\n]*uppercase/);
});

test("media sources use document-like rows without type badges or failed attempts", () => {
  assert.match(
    componentSource,
    /group px-4 py-2 transition-colors hover:bg-gray-900/,
  );
  assert.doesNotMatch(
    componentSource,
    /shrink-0 text-\[10px\] uppercase tracking-wider text-gray-600/,
  );
  assert.match(
    componentSource,
    /job\.status !== "failed" && job\.status !== "cancelled"/,
  );

  const documentRows = source.slice(
    source.indexOf("function renderMarkdownRows"),
    source.indexOf("type FolderTreeNode"),
  );
  assert.doesNotMatch(
    documentRows,
    /M19\.5 14\.25v-2\.625/,
    "document rows should not carry a redundant page icon",
  );
});

test("Learn groups selectable sources as documents, links, videos, and audio", () => {
  assert.match(source, /Sources \{learnTeachingSourceSlugs\.length\}/);
  assert.match(source, /Select documents, links, video transcripts, and/);
  assert.match(source, /const LEARN_SOURCE_KINDS: LearnSourceKind\[\] = \[/);
  for (const kind of ["document", "link", "video", "audio"]) {
    assert.match(source, new RegExp(`"${kind}"`));
  }
});
