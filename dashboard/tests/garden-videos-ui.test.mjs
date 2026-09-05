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

const mediaRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/gardens/[gardenId]/media/[sourceSlug]/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("garden sidebar separates list expansion from add-dialog launchers", () => {
  const linksSection = source.indexOf('aria-label="Open links dialog"');
  const mediaSection = source.indexOf(
    'aria-label="Open video and audio dialog"',
    linksSection,
  );

  assert.ok(linksSection >= 0, "Links launcher should exist");
  assert.ok(mediaSection > linksSection, "Video & audio should render after Links");
  assert.match(source, /const \[linkDialogOpen, setLinkDialogOpen\] = useState\(false\)/);
  assert.match(source, /const \[mediaDialogOpen, setMediaDialogOpen\] = useState\(false\)/);
  assert.match(source, /const \[linksExpanded, setLinksExpanded\] = useState\(false\)/);
  assert.match(source, /const \[mediaExpanded, setMediaExpanded\] = useState\(false\)/);
  assert.match(source, /Video &amp; audio/);
  assert.match(
    source,
    /onClick=\{\(\) => setLinksExpanded\(\(value\) => !value\)\}[\s\S]*?aria-controls="garden-links-panel"/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setMediaExpanded\(\(value\) => !value\)\}[\s\S]*?aria-controls="garden-media-items"/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setLinkDialogOpen\(true\)\}[\s\S]{0,400}?aria-label="Open links dialog"/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setMediaDialogOpen\(true\)\}[\s\S]{0,400}?aria-label="Open video and audio dialog"/,
  );
  assert.match(source, /linksExpanded \? "" : "rotate-180"/);
  assert.match(source, /mediaExpanded \? "" : "rotate-180"/);
  assert.match(source, /flex shrink-0 items-center gap-1\.5 pr-4/);
  assert.match(
    source,
    /className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:text-\[var\(--botanical\)\]"[\s\S]{0,200}?aria-label="Open links dialog"/,
  );
  assert.match(
    source,
    /className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:text-\[var\(--botanical\)\]"[\s\S]{0,200}?aria-label="Open video and audio dialog"/,
  );
  assert.match(source, /id="garden-links-panel"/);
  assert.match(componentSource, /id="garden-media-items"/);
  assert.match(source, /No saved links yet\./);
  assert.match(componentSource, /No video or audio yet\./);
});

test("the media dialog hosts the functional transcription component", () => {
  assert.match(source, /<GardenVideoImport\s/);
  assert.match(source, /open=\{mediaDialogOpen\}/);
  assert.match(source, /expanded=\{mediaExpanded\}/);
  assert.match(source, /onClose=\{\(\) => setMediaDialogOpen\(false\)\}/);
  assert.match(source, /onExpand=\{\(\) => setMediaExpanded\(true\)\}/);
  assert.match(source, /onSourceCreated=\{handleMediaSourceCreated\}/);
  assert.match(componentSource, /id="garden-media-panel"/);
  assert.doesNotMatch(componentSource, /if \(!open\) return null/);
  assert.match(componentSource, /\{expanded \? jobProgress : null\}[\s\S]*?\{open \? \(/);
});

test("Links and media keep composers in dialogs while progress moves under their bars", () => {
  assert.match(source, /onClick=\{\(\) => setLinkDialogOpen\(true\)\}/);
  assert.match(source, /id="garden-link-composer-title"/);
  assert.match(source, /role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(source, /id="garden-links-panel"/);
  assert.match(source, /savedLinks\.map/);
  assert.match(source, /activeLinkImportTasks\.map/);
  assert.match(source, /View link import progress for/);
  assert.match(source, /onClick=\{\(\) => setMediaDialogOpen\(true\)\}/);
  assert.match(componentSource, /bb-modal-backdrop fixed inset-0 z-50/);
  assert.match(componentSource, /aria-labelledby="garden-media-composer-title"/);
  assert.doesNotMatch(componentSource, />Imports</);
  assert.match(componentSource, /No video or audio yet\./);
  assert.match(componentSource, /\{expanded \? jobProgress : null\}/);
  assert.match(componentSource, /View transcription progress for/);
  assert.match(componentSource, /bb-neu-accordion-panel/);

  const libraryStart = source.indexOf("const renderDocumentLibrary");
  const library = source.slice(
    libraryStart,
    source.indexOf("\n  return (", libraryStart),
  );
  assert.match(library, /savedLinks\.map/);
  assert.match(library, /linksLoading/);

  const linkComposer = source.slice(
    source.indexOf("{linkDialogOpen ? ("),
    source.indexOf("{selectedLinkImportTask ? ("),
  );
  assert.doesNotMatch(linkComposer, /savedLinks\.map/);
});

test("media controls use the botanical palette instead of cyan", () => {
  assert.doesNotMatch(componentSource, /(?:cyan|blue)-/);
  assert.match(componentSource, /text-\[var\(--botanical\)\]/);
  assert.match(
    componentSource,
    /bg-\[color-mix\(in_srgb,var\(--botanical\)_8%,transparent\)\]/,
  );
});

test("recordings share the document select and highlight control", () => {
  assert.match(source, /flagColor: doc\.flagColor/);
  assert.match(source, /selectedSourceSlugs=\{selectedDocumentSlugs\}/);
  assert.match(source, /flagColors=\{FLAG_COLORS\}/);
  assert.match(source, /openFlagPaletteSlug=\{openFlagPaletteSlug\}/);
  assert.match(source, /savingFlagSlug=\{savingFlagSlug\}/);
  assert.match(
    source,
    /onColorButtonClick=\{\(sourceSlug\) =>\s*handleDocumentColorButtonClick\(sourceSlug, true\)/,
  );
  assert.match(source, /void handleDocumentFlag\(sourceSlug, flagColor\)/);
  assert.match(componentSource, /function SourceColorSelect/);
  assert.match(componentSource, /Recording highlight; selected for chat/);
  assert.match(componentSource, /Click once to select for chat\./);
  assert.match(componentSource, /Double-click to choose a highlight color\./);
  assert.match(componentSource, /aria-pressed=\{selected\}/);
  assert.match(componentSource, /\{selected \? \([\s\S]*?stroke="rgb\(3 7 18\)"[\s\S]*?stroke="white"/);
  assert.match(componentSource, /selectedSourceSlugs\.includes\(source\.slug\)/);
  assert.match(
    componentSource,
    /border-l-\[var\(--botanical\)\] bg-\[color-mix\(in_srgb,var\(--botanical\)_8%,transparent\)\]/,
  );
});

test("completed recordings live under Video & audio with exact names and a single playback transport", () => {
  assert.match(source, /const mediaSourceDocuments = sourceDocuments\.filter/);
  assert.match(source, /const documentSourceDocuments = sourceDocuments\.filter/);
  assert.match(source, /mediaSources=\{gardenMediaSources\}/);
  assert.match(source, /Documents[\s\S]*?documentSourceDocuments\.length/);
  assert.match(source, /Video &amp; audio[\s\S]*?gardenMediaSources\.length/);
  assert.match(componentSource, /filteredMediaSources\.map\(\(source\) =>/);
  assert.match(componentSource, /<OverflowMarquee>\{filename\}<\/OverflowMarquee>/);
  assert.match(
    source,
    /<OverflowMarquee>\{displayTitle\}<\/OverflowMarquee>/,
  );
  assert.match(
    source,
    /<OverflowMarquee className="text-xs text-gray-300 group-hover:text-white">\s*\{file\.name\}\s*<\/OverflowMarquee>/,
  );
  assert.match(componentSource, /const description = mediaSourceDescription\(source\)/);
  assert.match(componentSource, /function AudioSourceRow/);
  assert.match(componentSource, /<audio[\s\S]*?preload="metadata"/);
  assert.doesNotMatch(componentSource, /<audio[^>]*\scontrols(?:\s|>)/);
  assert.match(
    componentSource,
    /aria-label=\{isPlaying \? `Pause \$\{filename\}` : `Play \$\{filename\}`\}/,
  );
  assert.match(componentSource, /className=\{styles\.scrubber\}/);
  assert.match(
    componentSource,
    /aria-label=\{`\$\{playing \? "Close player for" : "Open player for"\} \$\{filename\}`\}/,
  );
  assert.match(componentSource, /<video[\s\S]*?controls autoPlay preload="metadata"/);
  assert.match(
    componentSource,
    /\/api\/gardens\/\$\{encodeURIComponent\(clusterSlug\)\}\/media\//,
  );
  assert.match(mediaRouteSource, /requireReadableClusterFromSlug\(gardenId\)/);
  assert.match(mediaRouteSource, /source\?\.sourceMedia/);
  assert.match(mediaRouteSource, /"Accept-Ranges": "bytes"/);
  assert.match(mediaRouteSource, /"Content-Range":/);
});

test("video and audio sources use the same searchable library pattern as documents", () => {
  assert.match(componentSource, /const \[mediaSearch, setMediaSearch\] = useState\(""\)/);
  assert.match(componentSource, /placeholder="Search video and audio"/);
  assert.match(componentSource, /aria-label="Search video and audio"/);
  assert.match(componentSource, /const filteredMediaSources =/);
  assert.match(componentSource, /mediaSourceSearchText\(source\)/);
  assert.match(componentSource, /No video or audio matches \{mediaSearch\.trim\(\)\}/);
  assert.match(componentSource, /aria-label="Clear media search"/);
});

test("source library headings use title case instead of forced uppercase", () => {
  assert.doesNotMatch(source, /bb-neu-accordion[^\n]*uppercase/);
});

test("media progress mirrors document processing and hides terminal jobs", () => {
  assert.match(
    componentSource,
    /group flex w-full items-center gap-2\.5 px-3 py-2 text-left/,
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
  assert.match(componentSource, /selectedJob\.errorMessage/);
  assert.match(
    componentSource,
    /setSelectedJobId\(provisionalId\);[\s\S]*?onClose\(\);[\s\S]*?setSubmitting\(true\)/,
  );
  assert.match(componentSource, /setSelectedJobId\(acceptedJob\.id\)/);
  assert.match(componentSource, /Transcription status/);
  assert.match(componentSource, /Continue in background/);
  assert.match(componentSource, /selectedJobStages\.map/);

  const statusDialog = componentSource.slice(
    componentSource.indexOf("{selectedJob ? ("),
  );
  assert.doesNotMatch(statusDialog, /Drop video or audio here/);
  assert.doesNotMatch(statusDialog, />Transcribe media</);

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

test("link imports immediately open dedicated status and keep a live sidebar row", () => {
  assert.match(source, /interface LinkImportTask/);
  assert.match(source, /status: "importing" \| "completed" \| "failed"/);
  assert.match(
    source,
    /setLinkImportTasks\([\s\S]*?setLinkDialogOpen\(false\);[\s\S]*?setSelectedLinkImportId\(taskId\)/,
  );
  assert.match(source, /setLinksExpanded\(true\)/);
  assert.match(source, /activeLinkImportTasks\.map/);
  assert.match(source, /onClick=\{\(\) => setSelectedLinkImportId\(task\.id\)\}/);
  assert.match(source, /Link import status/);
  assert.match(source, /The page is being fetched, converted to Markdown/);
  assert.match(source, /Continue in background/);

  const statusDialog = source.slice(source.indexOf("{selectedLinkImportTask ? ("));
  assert.doesNotMatch(statusDialog, /aria-label="Link name"/);
  assert.doesNotMatch(statusDialog, />Save link</);
});

test("Learn groups selectable sources as documents, links, videos, and audio", () => {
  assert.match(source, /Sources \{learnTeachingSourceSlugs\.length\}/);
  assert.match(source, /Select documents, links, video transcripts, and/);
  assert.match(source, /const LEARN_SOURCE_KINDS: LearnSourceKind\[\] = \[/);
  for (const kind of ["document", "link", "video", "audio"]) {
    assert.match(source, new RegExp(`"${kind}"`));
  }
});
