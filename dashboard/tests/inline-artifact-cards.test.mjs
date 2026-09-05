import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const cards = fs.readFileSync(
  new URL("../src/app/components/hermes/inline-artifact-cards.tsx", import.meta.url),
  "utf8",
);
const viewer = fs.readFileSync(
  new URL("../src/app/components/hermes/artifact-viewer.tsx", import.meta.url),
  "utf8",
);
const runtimePanel = fs.readFileSync(
  new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
  "utf8",
);
const gardenWorkspace = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const artifactPanel = fs.readFileSync(
  new URL("../src/app/components/hermes/artifact-panel.tsx", import.meta.url),
  "utf8",
);
const gardenArtifactDock = fs.readFileSync(
  new URL("../src/app/components/hermes/garden-artifact-dock.tsx", import.meta.url),
  "utf8",
);
const chatSessionsRoute = fs.readFileSync(
  new URL("../src/app/api/chat-sessions/route.ts", import.meta.url),
  "utf8",
);
const chatSessionRoute = fs.readFileSync(
  new URL("../src/app/api/chat-sessions/[sessionId]/route.ts", import.meta.url),
  "utf8",
);
const agentSession = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const activityPanel = fs.readFileSync(
  new URL("../src/app/components/hermes/activity-panel.tsx", import.meta.url),
  "utf8",
);
const artifactPdfPage = fs.readFileSync(
  new URL("../src/app/artifacts/[artifactId]/pdf/page.tsx", import.meta.url),
  "utf8",
);
const nativePdfViewer = fs.readFileSync(
  new URL(
    "../src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx",
    import.meta.url,
  ),
  "utf8",
);
const globals = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const terminal = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);

test("created artifacts render as persistent response-owned file cards", () => {
  assert.match(cards, /\/api\/hermes\/artifacts\?\$\{query\}/);
  assert.match(cards, /ARTIFACT_BROWSER_EVENT/);
  assert.match(cards, /Files created by this response/);
  assert.match(cards, /artifact\.assistantMessageId === ownerMessageId/);
  assert.match(cards, /Open \$\{artifact\.title\}/);
  assert.doesNotMatch(cards, />\s*Download\s*</);
  assert.doesNotMatch(cards, /Delete artifact/);
  assert.match(cards, /artifact\.previewAvailable \|\| artifact\.downloadAvailable/);
  assert.match(
    cards,
    /artifact\.status === "ready"/,
  );
});

test("ready video artifacts stay compact until the artifact is opened", () => {
  // Source attachments are playable in the user message. Generated video
  // artifacts use the same compact placeholder as other files so a large media
  // player does not take over the assistant response.
  assert.doesNotMatch(cards, /function InlineVideoArtifact/);
  assert.doesNotMatch(cards, /artifact\.kind === "video"[\s\S]*?<InlineVideoArtifact/);
  assert.match(cards, /artifact\.previewAvailable \|\| artifact\.downloadAvailable \? \([\s\S]*?context\.openArtifact\(artifact\.id\)/);
  assert.match(viewer, /artifact\.kind === "video" && onEditVideo/);
});

test("download-only artifact cards still open the viewer", () => {
  // Office files may not have an inline preview, but their viewer still owns
  // Download and Edit. The response card must therefore remain actionable.
  assert.match(
    cards,
    /artifact\.previewAvailable \|\| artifact\.downloadAvailable \? \([\s\S]*?onClick=\{\(\) => void context\.openArtifact\(artifact\.id\)\}/,
  );
});

test("clicking an open artifact closes it from inline cards and the archive", () => {
  assert.match(
    cards,
    /setOpenId\(\(current\) => \(current === id \? null : id\)\)/,
  );
  assert.match(cards, /onClick=\{\(\) => void context\.openArtifact\(artifact\.id\)\}/);
  assert.match(cards, /context\.openId === artifact\.id \? "Close" : "Open"/);
  assert.match(
    artifactPanel,
    /const toggleOpenArtifact = useCallback\(\(id: string\) => \{\s*setOpenId\(\(current\) => \(current === id \? null : id\)\)/,
  );
  assert.match(artifactPanel, /else toggleOpenArtifact\(artifact\.id\)/);
});

test("the whole image artifact opens while redundant Open and Edit actions stay absent", () => {
  const imageCard = cards.slice(
    cards.indexOf("function InlineImageArtifact"),
    cards.indexOf("export function InlineArtifactCardsProvider"),
  );
  assert.match(imageCard, /absolute inset-0 z-\[1\] cursor-pointer/);
  assert.match(imageCard, /onClick=\{\(\) => void context\.openArtifact\(artifact\.id\)\}/);
  assert.match(imageCard, /bb-neu-artifact-preview-tilted[^\n]*-rotate-3/);
  assert.doesNotMatch(imageCard, />\s*(?:Open|Close|Edit)\s*</);
  assert.doesNotMatch(imageCard, />\s*Download\s*</);
  assert.doesNotMatch(imageCard, /Delete artifact/);
});

test("artifact cards stay in the owning response lane without card-level download or delete", () => {
  assert.match(cards, /className="bb-inline-artifact-list mt-3 space-y-2"/);
  assert.match(globals, /\.bb-inline-artifact-list \{\s*width: 100%;/);
  assert.doesNotMatch(
    globals,
    /\.bb-inline-artifact-list[\s\S]{0,240}?calc\(100% \+ 8rem\)/,
  );
  assert.match(
    gardenWorkspace,
    /className="bb-garden-assistant-response flex w-full max-w-\[90%\] flex-col gap-2"[\s\S]*?<GenerativeUiRenderer[\s\S]*?<InlineArtifactCards/,
  );
  assert.match(
    gardenWorkspace,
    /className="bb-garden-assistant-response w-full max-w-\[90%\]">\s*<InlineArtifactCards ownerMessageId=\{null\}/,
  );
  assert.doesNotMatch(cards, /deleteArtifactRequest|handleDelete|deletingId|deleteError/);
});

test("in-progress and failed artifacts do not render artifact UI", () => {
  assert.match(agentSession, /kind: "artifact"/);
  assert.match(agentSession, /`Building \$\{title\}…`/);
  assert.match(activityPanel, /item\.kind === "artifact"/);
  assert.match(
    activityPanel,
    /stateLabel \?\?[\s\S]*?artifactState\?\.label \?\?[\s\S]*?responseActive/,
  );
  assert.match(
    cards,
    /artifact\.status === "ready"/,
  );
  assert.doesNotMatch(cards, /InlineArtifactLoadingCard|ArtifactBloomLoader/);
});

test("response actions sit below response-owned artifacts on every artifact chat surface", () => {
  for (const transcript of [runtimePanel, gardenWorkspace]) {
    // Both transcripts are virtualized, so the row body is the list's
    // `renderItem` rather than a `messages.map`.
    const messagesStart = transcript.indexOf("renderItem={");
    const ownerCard = transcript.indexOf("<InlineArtifactCards", messagesStart);
    const actions = transcript.indexOf("<AssistantMessageActions", ownerCard);
    assert.ok(messagesStart >= 0);
    assert.ok(ownerCard > messagesStart);
    assert.ok(actions > ownerCard);
  }
});

test("a run card's own actions land below the artifacts too", () => {
  // Inline run cards render their action row from deep inside the card, which
  // put it above the artifact cards the transcript appends after the message.
  // Each transcript offers a slot at the end of the message; the row goes there.
  const actions = fs.readFileSync(
    new URL("../src/app/components/assistant-message-actions.tsx", import.meta.url),
    "utf8",
  );
  assert.match(actions, /MessageActionsSlotContext/);
  assert.match(actions, /return slot \? createPortal\(actions, slot\) : actions;/);

  for (const transcript of [runtimePanel, gardenWorkspace]) {
    // Both transcripts are virtualized, so the row body is the list's
    // `renderItem` rather than a `messages.map`.
    const messagesStart = transcript.indexOf("renderItem={");
    const slotOpen = transcript.indexOf("<MessageActionsSlot", messagesStart);
    const ownerCard = transcript.indexOf("<InlineArtifactCards", messagesStart);
    const slotClose = transcript.indexOf("</MessageActionsSlot>", ownerCard);
    assert.ok(slotOpen > messagesStart);
    assert.ok(slotOpen < ownerCard);
    assert.ok(slotClose > ownerCard);
  }
});

test("a chat's artifacts are asked for with its messages, not after they render", () => {
  // The provider only mounts once the transcript has messages to wrap, so the
  // request used to start a full round trip late and the cards popped in after
  // the chat looked finished. The prefetch runs whether or not messages exist.
  assert.match(cards, /export function primeInlineArtifacts[\s\S]{0,120}Promise<PresentedArtifact\[\]>/);
  assert.match(
    runtimePanel,
    /const artifactsReady = useInlineArtifactPrefetch\(\{\s*conversationId: surface !== "quartz_ai" \? sessionId : null,\s*\}\)/,
  );
  // Opening or restoring a chat asks for both at once, rather than waiting for
  // the transcript to arrive before the artifacts are even requested.
  assert.match(
    agentSession,
    /primeInlineArtifacts\(\s*\{ conversationId: id \},\s*\{ revalidate: true \},\s*\);[\s\S]*loadHermesSessionDetail\(surface, id/,
  );
  assert.doesNotMatch(
    agentSession.slice(
      agentSession.indexOf("const openSession = useCallback("),
      agentSession.indexOf("const refreshSession = useCallback("),
    ),
    /reuseRecentPrefetch:\s*true/,
  );
  assert.match(
    agentSession,
    /primeInlineArtifacts\(\s*\{ conversationId: selected\.id \},\s*\{ revalidate: true \},\s*\);\s*const restored = await loadHermesSessionDetail/,
  );
  // Answers are kept per query so a mounting provider paints from them at once,
  // and joins a request already in flight instead of asking again.
  assert.match(cards, /const artifactCache = new Map</);
  assert.match(cards, /artifactCache\.get\(query\) \?\? \[\]/);
  assert.match(cards, /const MAX_CACHED_ARTIFACT_QUERIES = 32;/);
  assert.match(cards, /while \(artifactCache\.size > MAX_CACHED_ARTIFACT_QUERIES\)/);
  assert.match(cards, /artifactCache\.delete\(oldest\);/);
  assert.match(cards, /const pending = artifactRequests\.get\(query\);/);
});

test("chat rows stay covered until their artifact snapshot is ready", () => {
  assert.match(
    cards,
    /export function useInlineArtifactPrefetch[\s\S]{0,120}?boolean/,
  );
  assert.match(cards, /const queryChanged = readiness\.query !== query;/);
  assert.match(cards, /revalidate: true/);
  assert.match(
    cards,
    /return !query \|\| \(!queryChanged && readiness\.query === query && readiness\.ready\);/,
  );

  assert.match(
    runtimePanel,
    /const conversationLoading =\s*loadingTranscript \|\| \(!visibleConversationJustCreated && !artifactsReady\);/,
  );
  const runtimeGate = runtimePanel.slice(
    runtimePanel.indexOf("{conversationLoading ? ("),
    runtimePanel.indexOf("<InlineArtifactCardsProvider"),
  );
  assert.match(runtimeGate, /<BreadboardLoader/);
  assert.match(runtimeGate, /messages\.length === 0/);

  assert.match(
    gardenWorkspace,
    /const chatContentLoading =\s*loadingChats \|\| \(!visibleChatJustCreated && !inlineArtifactsReady\);/,
  );
  assert.match(
    gardenWorkspace,
    /if \(loadingChats\) \{[\s\S]{0,220}?<Spinner className="h-5 w-5"/,
  );
  assert.match(gardenWorkspace, /loadingChats=\{chatContentLoading\}/);
});

test("gadgets use the standard artifact placeholder until opened", () => {
  assert.doesNotMatch(cards, /import InlineGadget|isGadgetArtifact/);
  assert.match(cards, /<ArtifactFileIcon kind=\{artifact\.kind\} \/>/);
  assert.match(viewer, /if \(isGadget\) \{\s*return <InlineGadget artifact=\{artifact\} \/>/);
});

test("both runtime and legacy garden chats pin artifact cards to their owning message", () => {
  assert.match(
    runtimePanel,
    /<InlineArtifactCardsProvider[\s\S]*conversationId=\{surface !== "quartz_ai" \? sessionId : null\}[\s\S]*renderItem=\{[\s\S]*<InlineArtifactCards[\s\S]*ownerMessageId=\{[\s\S]*message\.artifactMessageId \?\? message\.id \?\? null/,
  );
  assert.match(
    gardenWorkspace,
    /<InlineArtifactCardsProvider[\s\S]*legacyChatSessionId=\{chatSessionId\}[\s\S]*renderItem=\{[\s\S]*<InlineArtifactCards[\s\S]*ownerMessageId=\{\s*msg\.artifactMessageId \?\? msg\.id \?\? null/,
  );
  assert.match(agentSession, /artifactMessageId:\s*payload\.assistantMessageId/);
  assert.match(gardenWorkspace, /assistantMsg\.artifactMessageId = event\.assistantMessageId/);
  assert.match(chatSessionsRoute, /id: `msg_\$\{message\.canonical_message_id\}`/);
  assert.match(
    chatSessionRoute,
    /INSERT INTO chat_messages[\s\S]*canonical_message_id[\s\S]*prior\?\.canonical_message_id \?\? null/,
  );
});

test("markdown artifacts can be added to the Garden artifacts folder", () => {
  assert.match(viewer, /"Add to garden"/);
  assert.match(viewer, /fetch\("\/api\/documents"/);
  assert.match(viewer, /folder: ARTIFACTS_FOLDER/);
  assert.match(viewer, /const ARTIFACTS_FOLDER = "artifacts"/);
  assert.match(viewer, /GARDEN_DOCUMENTS_CHANGED_EVENT/);
  assert.match(gardenWorkspace, /window\.addEventListener\(\s*GARDEN_DOCUMENTS_CHANGED_EVENT/);
  assert.match(gardenWorkspace, /setExpandedFolders/);
  assert.match(gardenWorkspace, /void fetchDocuments\(\)/);
});

test("PDF artifact clicks open Breadboard's native full-page PDF viewer", () => {
  assert.match(viewer, /export function artifactPdfHref/);
  assert.match(
    viewer,
    /return `\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}\/pdf\?\$\{query\.toString\(\)\}`/,
  );
  assert.match(cards, /const pdfHref = artifactPdfHref\(artifact\)/);
  assert.match(cards, /<a href=\{pdfHref\}/);
  assert.match(artifactPdfPage, /<PdfViewerClient/);
  assert.match(artifactPdfPage, /sourceUrl=\{sourceUrl\}/);
  assert.match(artifactPdfPage, /readOnly=\{!editable\}/);
  assert.match(nativePdfViewer, /sourceUrl\?: string/);
  assert.match(nativePdfViewer, /readOnly\?: boolean/);
  assert.match(nativePdfViewer, /readOnly \? "PDF artifact" : "PDF source"/);
});

test("document surfaces and full-window editors fill the dock body edge to edge", () => {
  assert.match(
    viewer,
    /artifact\.kind === "markdown"[\s\S]*?<ArtifactDocumentViewport>[\s\S]*?<article[\s\S]*?<ChatMarkdown content=\{text\}/,
  );
  // Document viewports and full-window visual editors own their scrolling and
  // chrome, so the dock body must not add a second inset around them.
  assert.match(
    viewer,
    /usesDocumentViewer \|\|\s*\(editingDocument && \(usesVvvebEditor \|\| usesGenOfficeEditor\)\)[\s\S]*?\?\s*"overflow-hidden p-0"\s*:\s*artifact\.kind === "document" && !editingDocument\s*\?\s*"overflow-auto p-0"\s*:\s*"overflow-auto px-5 py-4"/,
  );
});

test("an artifact opened in the Terminal fills a lane inside the dock, not the window", () => {
  // The Terminal is a dock along the bottom of the page, so an artifact opened
  // from it belongs inside that dock — a viewport-pinned panel would float free
  // of the chat it came from and cover the app above it.
  assert.match(terminal, /<ArtifactDockHostProvider host=\{artifactLane\}>/);
  assert.match(terminal, /ref=\{setArtifactLane\}[\s\S]*?className="bb-artifact-lane"/);
  assert.match(viewer, /const dockHost = useArtifactDockHost\(\)/);
  assert.match(viewer, /if \(dockHost\) return createPortal\(panel, dockHost\)/);

  // The lane and the transcript each take half of what the dock has left, and
  // the lane costs nothing until something is opened into it.
  assert.match(globals, /\.bb-artifact-lane \{[\s\S]*?flex: 1 1 0%;/);
  assert.match(globals, /\.bb-artifact-lane:empty \{\s*display: none;/);
  assert.match(terminal, /<div className="relative flex min-w-0 flex-1 flex-col">/);

  // A surface with a lane must not also make the shell give up width for a
  // panel that is already inside it.
  assert.match(
    viewer,
    /useReservedDockWidth\(Boolean\(artifact\) && !dockHost && !expanded, DOCK_WIDTH\)/,
  );
});

test("an archive replaces Terminal's side panel but uses Garden's wider reading lane", () => {
  // Terminal's archive already occupies the right-side dock. Opening a row
  // replaces it locally instead of appending a third column to the dock.
  assert.match(
    artifactPanel,
    /const useInheritedViewerHost =\s*sourceSurface !== "dashboard_terminal" && inheritedViewerHost !== null/,
  );
  assert.match(
    artifactPanel,
    /aria-hidden=\{openArtifact && !useInheritedViewerHost \? undefined : true\}/,
  );
  assert.match(
    artifactPanel,
    /host=\{useInheritedViewerHost \? inheritedViewerHost : viewerHost\}/,
  );

  // The archive is one accordion near the bottom of the right rail. Its viewer
  // inherits the rail-owned host instead of replacing only that accordion.
  assert.match(artifactPanel, /const inheritedViewerHost = useArtifactDockHost\(\)/);
  assert.match(
    gardenWorkspace,
    /\{\/\* Body \*\/\}\s*<div className="relative flex flex-1 min-h-0">\s*<GardenArtifactDock>[\s\S]*?<ChatTranscript[\s\S]*?<KnowledgeGraph[\s\S]*?<\/GardenArtifactDock>/,
  );

  // The left edge follows the pointer while the right edge stays anchored, and
  // its last width survives a reload. The untouched default remains half of
  // the viewport, giving documents a real reading surface on first open.
  assert.match(gardenArtifactDock, /const DEFAULT_WIDTH = "max\(24rem, 50vw\)"/);
  assert.match(gardenArtifactDock, /const WIDTH_KEY = "breadboard:garden:artifact-dock-width"/);
  assert.match(
    gardenArtifactDock,
    /active\.startWidth \+ active\.startX - event\.clientX/,
  );
  assert.match(gardenArtifactDock, /setPointerCapture\(event\.pointerId\)/);
  assert.match(gardenArtifactDock, /role="separator"[\s\S]*?aria-label="Resize artifact viewer"/);
  assert.match(gardenArtifactDock, /ArrowLeft[\s\S]*?ArrowRight/);
  assert.match(
    gardenArtifactDock,
    /bb-garden-artifact-shell absolute inset-y-0 right-0 z-30 flex/,
  );
  assert.match(gardenArtifactDock, /<ArtifactDockHostProvider host=\{dockHost\}>/);

  // The shell cannot intercept the learning map while no artifact is open.
  assert.match(
    globals,
    /\.bb-garden-artifact-shell:not\(\s*:has\(> \.bb-garden-artifact-lane > \.bb-artifact-dock\)\s*\) \{\s*display: none;/,
  );
  assert.match(globals, /\.bb-garden-artifact-lane:empty \{\s*display: none;/);

  // Garden uses the shared right-edge dock entrance. The old left-edge
  // override made the panel appear to emerge from the middle of the page.
  assert.doesNotMatch(gardenWorkspace, /data-artifact-dock-origin="left"/);
  assert.doesNotMatch(globals, /bb-artifact-dock-in-from-left/);
  assert.match(
    globals,
    /@keyframes bb-artifact-dock-in \{[\s\S]*?transform: translateX\(100%\);[\s\S]*?transform: translateX\(0\);/,
  );
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.bb-artifact-dock \{\s*animation: bb-artifact-dock-fade-in 160ms ease;/,
  );
});

test("a full-page surface with no lane pins the dock beside the page instead", () => {
  // An artifact is read while the conversation about it continues, so even the
  // free-floating dock is a panel beside the chat, not a dialog over it.
  assert.doesNotMatch(viewer, /aria-modal/);
  assert.match(viewer, /bb-artifact-dock bb-artifact-dock-floating fixed inset-y-0 right-0/);
  assert.match(viewer, /lg:w-\[var\(--bb-artifact-dock-width\)\]/);
  // An even split, the same one the Terminal's lane gives.
  assert.match(viewer, /const DOCK_WIDTH = "max\(24rem, 50vw\)"/);
  // Narrow viewports have no width to share, so there — and only there — the
  // dock covers the app and carries a scrim to dismiss it.
  assert.match(viewer, /bb-modal-backdrop fixed inset-0 z-\[69\] lg:hidden/);

  // The shell gives the width up rather than being covered by the panel.
  assert.match(viewer, /root\.dataset\.artifactDock = "open"/);
  assert.match(viewer, /root\.style\.setProperty\("--bb-artifact-dock-width", width\)/);
  assert.match(
    globals,
    /html\[data-artifact-dock="open"\] body \{\s*padding-right: var\(--bb-artifact-dock-width\);/,
  );
  // A viewport-positioned bottom dock cannot be moved by page padding.
  assert.match(
    globals,
    /html\[data-artifact-dock="open"\] \[data-terminal-dock\] \{\s*right: var\(--bb-artifact-dock-width\);/,
  );
  assert.match(terminal, /data-terminal-dock/);

  // The archive and the transcript each own a viewer, so the reserved width is
  // reference counted: the last dock to close hands it back.
  assert.match(viewer, /openDocks -= 1;\s*if \(openDocks > 0\) return;/);
});
