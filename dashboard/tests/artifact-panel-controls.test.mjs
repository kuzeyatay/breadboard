import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  artifactMatchesSearch,
  filterArtifactsForArchive,
  filterArtifactsForSearch,
} from "../src/lib/hermes/artifact-search.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("the Terminal artifacts control lives in the rail and shows an active state", () => {
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");

  // Artifacts is one of the rail's panel entries, not a header button.
  assert.match(
    sidebar,
    /label="Artifacts"[\s\S]{0,200}active=\{openPanel === "artifacts"\}/,
  );
  // Flat list items: the open one is filled, the rest only fill on hover.
  assert.match(sidebar, /active\s*\n?\s*\?\s*"bg-\[var\(--paper-strong\)\] font-medium/);
  assert.match(sidebar, /:\s*"text-\[var\(--ink\)\] hover:bg-\[var\(--paper-strong\)\]"/);
  assert.doesNotMatch(sidebar, /label="Artifacts"[\s\S]{0,200}neu-button/);
  assert.match(sidebar, /aria-pressed=\{active\}/);
  assert.doesNotMatch(terminal, /Open conversation artifacts/);

  // The panel it opens is still the one beside the transcript.
  assert.match(terminal, /sidePanel === "artifacts" \? \(\s*<ArtifactPanel/);
});

test("creating an artifact refreshes its archive without opening artifact UI", () => {
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const floatingGarden = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const gardenWorkspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");

  assert.doesNotMatch(terminal, /autoOpenedArtifactRuns|setSidePanel\("artifacts"\)/);
  assert.doesNotMatch(floatingGarden, /openCreatedArtifact|setView\("artifacts"\)/);
  assert.doesNotMatch(gardenWorkspace, /artifactAutoOpenedRuns|setArtifactsExpanded\(true\)/);

  // An already-open archive still observes creation and updates its contents.
  assert.match(panel, /window\.addEventListener\(ARTIFACT_BROWSER_EVENT, listener\)/);
  assert.match(panel, /void refresh\(\)/);
});

test("the artifact viewer uses an icon download action and fits Office pages", () => {
  const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");
  const genOffice = source("../src/app/components/hermes/artifact-genoffice-editor.tsx");
  const genOfficeHost = source("../src/genoffice-static/main.tsx");
  const genOfficeApp = source("../src/vendor/genoffice/docs/src/renderer/App.tsx");

  assert.match(viewer, /aria-label=\{`Download \$\{artifact\.filename\}`\}/);
  assert.match(viewer, /title="Download"/);
  assert.doesNotMatch(
    viewer,
    /href=\{downloadUrl\}[\s\S]{0,400}>\s*Download\s*<\/a>/,
  );

  assert.match(viewer, /function ArtifactOfficeDocumentFrame/);
  assert.match(viewer, /Math\.min\(availableWidth \/ pageWidth, 1\)/);
  assert.match(viewer, /wrapper\.style\.overflow = "hidden"/);
  assert.match(viewer, /data-artifact-office-preview/);
  assert.match(
    viewer,
    /usesGenOfficeFallbackPreview[\s\S]*?<ArtifactGenOfficeEditor[\s\S]*?mode="preview"/,
  );
  assert.match(viewer, /usesGenOfficeEditor && artifact\?\.downloadAvailable && !artifact\.previewAvailable/);
  assert.match(genOffice, /mode\?: "edit" \| "preview"/);
  assert.match(genOffice, /data-genoffice-artifact-preview/);
  assert.match(genOfficeHost, /const readOnly = params\.get\('mode'\) === 'preview'/);
  assert.match(genOfficeHost, /<App readOnly=\{readOnly\} \/>/);
  // The preview must keep GenOffice's paginated print layout: Read Mode drops
  // the page gaps and flows the document as one sheet, so a read-only host
  // locks the editor without entering it.
  assert.doesNotMatch(genOfficeApp, /useState\(readOnly\)/);
  assert.match(genOfficeApp, /setEditable\(!readMode && !readOnly && !isProtected\)/);
  assert.match(genOfficeApp, /\$\{readOnly \? ' read-only' : ''\}/);
  assert.match(genOfficeApp, /readMode && !readOnly/);
  const genOfficeHostCss = source("../src/app/genoffice-docs/genoffice-host.css");
  assert.match(genOfficeHostCss, /body \.app\.read-only \.ribbon,[\s\S]*?display: none !important;/);
  assert.doesNotMatch(genOfficeHostCss, /\.app\.read-only \.doc-page-gap/);
  assert.match(
    viewer,
    /artifact\.kind === "document" && !editingDocument[\s\S]{0,120}\? "overflow-auto p-0"/,
  );
});

test("Garden artifact tabs use the archive icon without a duplicate panel header", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const floatingGarden = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const gardenWorkspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

  assert.match(panel, /hideHeader\?: boolean/);
  assert.match(panel, /\{!hideHeader \? \(/);
  assert.match(floatingGarden, /<ArtifactPanel[\s\S]*?compact[\s\S]*?hideHeader[\s\S]*?sourceSurface="garden_chat"/);
  assert.match(gardenWorkspace, /ArtifactArchiveIcon/);
  assert.match(
    gardenWorkspace,
    /<ArtifactArchiveIcon className="h-3\.5 w-3\.5 shrink-0" \/>[\s\S]*?Artifacts/,
  );
  assert.match(
    gardenWorkspace,
    /<ArtifactPanel[\s\S]{0,180}?compact[\s\S]{0,180}?hideHeader[\s\S]{0,180}?gardenSlug=\{clusterSlug\}[\s\S]{0,180}?sourceSurface="garden_chat"/,
  );
  assert.doesNotMatch(
    gardenWorkspace,
    /d="M6\.75 3\.75h7\.5l3 3v13\.5H6\.75V3\.75/,
  );
});

test("Artifacts has one shared search field across Terminal and Garden", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  assert.match(panel, /placeholder="Search artifacts"/);
  assert.match(panel, /aria-label="Search artifacts"/);
  assert.match(panel, /filterArtifactsForSearch\(archiveArtifacts, searchQuery\)/);
  assert.match(panel, /No artifacts match/);
  assert.match(panel, /Clear artifact search/);

  const image = {
    title: "Eindhoven at night",
    filename: "city-lights.png",
    kind: "image",
    renderer: "image-file",
    mimeType: "image/png",
    status: "ready",
    sourceSkill: "imagegen",
    sourceMcpServer: null,
    sourceMcpTool: null,
    sourceHermesTool: "artifact_image_generate",
    error: null,
    metadata: { style: "pastel skyline", nested: { ignored: true } },
  };
  const report = {
    ...image,
    title: "Quarterly report",
    filename: "results.pdf",
    kind: "pdf",
    renderer: "pdf",
    mimeType: "application/pdf",
    sourceSkill: "document-writer",
    sourceHermesTool: "artifact_document_create",
    metadata: {},
  };

  assert.equal(artifactMatchesSearch(image, "eindhoven imagegen"), true);
  assert.equal(artifactMatchesSearch(image, "pastel skyline"), true);
  assert.equal(artifactMatchesSearch(image, "quarterly"), false);
  assert.deepEqual(filterArtifactsForSearch([image, report], "pdf report"), [report]);
  assert.equal(filterArtifactsForSearch([image, report], "").length, 2);
});

test("the archive hides generating and failed artifacts", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const ready = { id: "ready", status: "ready" };
  const generating = { id: "generating", status: "generating" };
  const failed = { id: "failed", status: "failed" };

  assert.deepEqual(filterArtifactsForArchive([ready, generating, failed]), [ready]);
  assert.match(panel, /filterArtifactsForArchive\(artifacts\)/);
  assert.doesNotMatch(panel, />\s*Generating\s*</);
  assert.doesNotMatch(panel, />\s*Failed\s*</);
});

test("Terminal artifacts share Garden documents' square color and selection control", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");

  assert.match(panel, /handleArtifactColorButtonClick/);
  assert.match(panel, /pendingTimer !== undefined[\s\S]*?onToggleArtifactAttachment\(artifact\)/);
  assert.match(panel, /flex h-5 w-5 items-center justify-center/);
  assert.match(panel, /Click twice to select for chat/);
  assert.match(panel, /Click once to choose a color/);
  assert.match(panel, /ring-2 ring-\[var\(--botanical\)\]\/70/);
  assert.match(panel, /backgroundColor: highlight\?\.color \?\? "transparent"/);
  assert.match(panel, /<ArtifactColorPalette/);
  assert.match(terminal, /fetch\(artifactUrl\(artifact, "download"\)\)/);
  assert.match(terminal, /sourceArtifactId: artifact\.id/);
  assert.match(terminal, /attachedArtifactIds=\{attachedArtifactIds\}/);
  assert.match(terminal, /onToggleArtifactAttachment=\{toggleArtifactAttachment\}/);
});

test("the archive carries one menu instead of a control on every row", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");

  // No delete button under the cursor of a list people mostly read, and no
  // Refresh sitting in the header: both moved behind the dots.
  assert.doesNotMatch(panel, /aria-label=\{`Delete \$\{artifact\.title\}`\}/);
  assert.doesNotMatch(panel, /title="Delete artifact"/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void refresh\(\)\}[\s\S]{0,200}>\s*Refresh\s*<\/button>/);

  // The dots, the menu they open, and the three things it offers.
  assert.match(panel, /aria-label="More actions for Artifacts"/);
  assert.match(panel, /aria-label="Actions for Artifacts"/);
  assert.match(panel, /Select artifacts\s*<\/button>/);
  assert.match(panel, /Highlight artifacts\s*<\/button>/);
  assert.match(panel, /Refresh\s*<\/button>/);
  // Nothing in the list: picking or marking would have nothing to act on.
  assert.match(panel, /actionable=\{filteredArtifacts\.length > 0\}/);

  // The same dismissal and the same viewport placement as the rail's menus —
  // the archive scrolls too, so an absolutely-positioned menu would clip.
  assert.match(panel, /function useDismissOnOutside/);
  assert.match(panel, /useDismissOnOutside\(menuRef, onClose\)/);
  assert.match(panel, /className="fixed z-\[70\]/);
  assert.match(panel, /Math\.max\(8, Math\.min\(anchor\.bottom \+ 4, viewport\.height - MENU_HEIGHT - 8\)\)/);
  assert.match(panel, /buttonRef\.current\?\.getBoundingClientRect\(\)/);

  // A Garden tab hides the panel header, so the menu rides beside the search
  // field there rather than disappearing with the header.
  assert.match(panel, /\{hideHeader && mode === "idle" \? menuButton : null\}/);
});

test("artifacts are picked over and deleted in one sweep, never one row at a time", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");

  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /aria-label=\{`Select \$\{artifact\.title\}`\}/);
  // While picking, the row checks instead of opening — including a PDF, whose
  // link would otherwise navigate away mid-selection.
  assert.match(panel, /if \(mode === "selecting"\) toggleChecked\(artifact\.id\)/);
  assert.match(panel, /\{mode === "idle" && pdfHref \? \(/);

  // Checked ids are intersected with the visible list rather than mirrored into
  // a second copy, so a sweep can only remove what the user can see.
  assert.match(
    panel,
    /const selectedArtifacts = filteredArtifacts\.filter\(\(artifact\) => selectedIds\.has\(artifact\.id\)\)/,
  );
  assert.match(panel, /onSelectAll=\{\(\) => setSelectedIds\(new Set\(filteredArtifacts\.map\(\(item\) => item\.id\)\)\)\}/);

  // One confirmation for the sweep, deletes run one at a time, and a partial
  // result is reported rather than assumed away.
  assert.match(panel, /window\.confirm\(`Delete \$\{subject\}\?/);
  assert.match(panel, /for \(const artifact of selectedArtifacts\)/);
  assert.match(panel, /artifacts could not be deleted\./);

  // The mode is never alive but invisible.
  assert.match(panel, /if \(event\.key === "Escape"\) stopWorking\(\)/);
});

test("an artifact is marked with the same pen the rail uses, and never reordered by it", () => {
  const panel = source("../src/app/components/hermes/artifact-panel.tsx");
  const schema = source("../src/lib/hermes/artifact-schema.ts");
  const store = source("../src/lib/hermes/artifact-store.ts");
  const route = source("../src/app/api/hermes/artifacts/[artifactId]/route.ts");

  // Same palette, same pen, same "repeat the color to lift the mark" rule as
  // the terminal rail, so the two surfaces cannot drift apart.
  assert.match(panel, /const \[pen, setPen\] = useState<string \| null>\(CHAT_HIGHLIGHTS\[0\]\.id\)/);
  assert.match(panel, /artifact\.highlight === pen \? null : pen/);
  assert.match(panel, /aria-label="Eraser"/);
  assert.match(panel, /aria-label=\{`\$\{highlight\.label\} highlighter`\}/);
  assert.match(panel, /inset 3px 0 0 \$\{highlight\.color\}/);
  assert.match(panel, /color-mix\(in srgb, \$\{highlight\.color\} 15%, transparent\)/);
  // Applied locally first — waiting out a round trip between rows would make
  // the pen feel stuck — and put back if the write is refused.
  assert.match(panel, /await highlightArtifactRequest\(artifact, next\)/);
  assert.match(panel, /item\.id === artifact\.id \? \{ \.\.\.item, highlight: previous \}/);

  // The column exists, and marking is placement rather than activity: the
  // archive is ordered by updated_at, so the setter must not touch it.
  assert.match(
    schema,
    /ensureColumn\(database, "hermes_artifacts", "highlight", "highlight TEXT"\);/,
  );
  const setter = store.slice(
    store.indexOf("export function setArtifactHighlight"),
    store.indexOf("function failArtifact"),
  );
  assert.ok(setter.length > 0, "the store exposes a highlight setter");
  assert.doesNotMatch(setter, /updated_at/);
  // Ownership is re-checked in the setter rather than trusted from the caller.
  assert.match(setter, /getArtifactForUser\(\{/);
  // A slug from an older palette presents as unmarked rather than as a color
  // the archive cannot paint.
  assert.match(
    store,
    /highlight: isChatHighlight\(row\.highlight\) \? row\.highlight : null/,
  );

  // The route takes null to clear, refuses anything off the palette, and
  // re-checks garden access before it writes.
  assert.match(route, /export async function PATCH/);
  assert.match(route, /body\.highlight !== null && !isChatHighlight\(body\.highlight\)/);
  assert.match(route, /invalid_highlight/);
  assert.match(route, /if \(artifact\.garden_slug\) authorizeGardenAccess\(userId, artifact\.garden_slug\)/);
});
