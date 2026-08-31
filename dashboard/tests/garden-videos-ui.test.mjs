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

test("garden sidebar renders Links and Video & audio as dialog launchers", () => {
  const linksSection = source.indexOf('aria-label="Open links dialog"');
  const mediaSection = source.indexOf(
    'aria-label="Open video and audio dialog"',
    linksSection,
  );

  assert.ok(linksSection >= 0, "Links launcher should exist");
  assert.ok(mediaSection > linksSection, "Video & audio should render after Links");
  assert.match(source, /const \[linkDialogOpen, setLinkDialogOpen\] = useState\(false\)/);
  assert.match(source, /const \[mediaDialogOpen, setMediaDialogOpen\] = useState\(false\)/);
  assert.doesNotMatch(source, /linksExpanded|mediaExpanded/);
  assert.match(source, /Video &amp; audio/);

  const linksLauncher = source.slice(linksSection, mediaSection);
  const mediaLauncher = source.slice(
    mediaSection,
    source.indexOf("<GardenVideoImport", mediaSection),
  );
  for (const launcher of [linksLauncher, mediaLauncher]) {
    assert.match(
      launcher,
      /rotate-180 text-gray-600[\s\S]*?d="m4\.5 15\.75 7\.5-7\.5 7\.5 7\.5"/,
      "dialog launcher should always include its dropdown chevron",
    );
  }
});

test("the media dialog hosts the functional transcription component", () => {
  assert.match(source, /<GardenVideoImport\s/);
  assert.match(source, /open=\{mediaDialogOpen\}/);
  assert.match(source, /onClose=\{\(\) => setMediaDialogOpen\(false\)\}/);
  assert.match(source, /onSourceCreated=\{handleMediaSourceCreated\}/);
  assert.match(componentSource, /id="garden-media-panel"/);
  assert.match(componentSource, /if \(!open\) return null/);
});

test("Links and media keep their forms, lists, and progress inside dialogs", () => {
  assert.match(source, /onClick=\{\(\) => setLinkDialogOpen\(true\)\}/);
  assert.match(source, /id="garden-link-composer-title"/);
  assert.match(source, /role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(source, /Saved links/);
  assert.match(source, /savedLinks\.map/);
  assert.match(source, /onClick=\{\(\) => setMediaDialogOpen\(true\)\}/);
  assert.match(componentSource, /bb-modal-backdrop fixed inset-0 z-50/);
  assert.match(componentSource, /aria-labelledby="garden-media-composer-title"/);
  assert.doesNotMatch(componentSource, />Imports</);
  assert.doesNotMatch(componentSource, /No video or audio yet\./);
  assert.match(componentSource, /\{jobProgress\}/);
  assert.doesNotMatch(componentSource, /bb-neu-accordion-panel/);

  const libraryStart = source.indexOf("const renderDocumentLibrary");
  const library = source.slice(
    libraryStart,
    source.indexOf("\n  return (", libraryStart),
  );
  assert.doesNotMatch(library, /savedLinks\.map|linksLoading|statusLabel/);
});

test("media controls use the botanical palette instead of cyan", () => {
  assert.doesNotMatch(componentSource, /(?:cyan|blue)-/);
  assert.match(componentSource, /text-\[var\(--botanical\)\]/);
  assert.match(
    componentSource,
    /bg-\[color-mix\(in_srgb,var\(--botanical\)_8%,transparent\)\]/,
  );
});

test("source library headings use title case instead of forced uppercase", () => {
  assert.doesNotMatch(source, /bb-neu-accordion[^\n]*uppercase/);
});

test("media progress mirrors document processing and hides terminal jobs", () => {
  assert.match(
    componentSource,
    /rounded-lg bg-gray-800\/50 px-3 py-2/,
  );
  assert.match(
    componentSource,
    /job\.originalFilename \?\? job\.sourceTitle \?\? "Media transcription"/,
  );
  assert.match(
    componentSource,
    /\.filter\(\(job\) => !isTerminalJob\(job\)\)[\s\S]*?\.slice\(0, 6\)/,
  );
  assert.doesNotMatch(componentSource, /job\.status === "cancelled"/);
  assert.doesNotMatch(componentSource, /stages\.map/);
  assert.match(componentSource, /const acceptedJob = data\.job \?\? null/);
  assert.match(
    componentSource,
    /Promise<[\s\S]*?PublicVideoTranscriptionJob\[\] \| null[\s\S]*?>/,
  );
  assert.match(componentSource, /if \(nextJobs\) applyJobs\(nextJobs\)/);
  assert.match(componentSource, /if \(refreshedJobs\) \{/);
  assert.match(
    componentSource,
    /!refreshedJobs\.some\(\(job\) => job\.id === acceptedJob\.id\)/,
  );
  assert.match(
    componentSource,
    /The upload was accepted but no transcription job was created\./,
  );
  assert.doesNotMatch(componentSource, /job\.errorMessage/);

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
