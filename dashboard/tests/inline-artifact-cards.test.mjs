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

test("created artifacts render as persistent response-owned file cards", () => {
  assert.match(cards, /\/api\/hermes\/artifacts\?\$\{query\}/);
  assert.match(cards, /ARTIFACT_BROWSER_EVENT/);
  assert.match(cards, /Files created by this response/);
  assert.match(cards, /artifact\.assistantMessageId === ownerMessageId/);
  assert.match(cards, /Open \$\{artifact\.title\}/);
  assert.match(cards, />\s*Download\s*</);
  assert.match(cards, /artifact\.downloadAvailable/);
  assert.match(cards, /artifact\.previewAvailable/);
  assert.match(
    cards,
    /artifact\.status !== "archived"/,
  );
});

test("ready video artifacts stay compact until the artifact is opened", () => {
  // Source attachments are playable in the user message. Generated video
  // artifacts use the same compact placeholder as other files so a large media
  // player does not take over the assistant response.
  assert.doesNotMatch(cards, /function InlineVideoArtifact/);
  assert.doesNotMatch(cards, /artifact\.kind === "video"[\s\S]*?<InlineVideoArtifact/);
  assert.match(cards, /artifact\.previewAvailable \? \([\s\S]*?context\.setOpenId\(artifact\.id\)/);
  assert.match(viewer, /artifact\.kind === "video" && onEditVideo/);
});

test("in-progress artifact builds reserve their finished card with an animated bloom", () => {
  assert.match(agentSession, /kind: "artifact"/);
  assert.match(agentSession, /`Building \$\{title\}…`/);
  assert.match(activityPanel, /item\.kind === "artifact"/);
  assert.match(activityPanel, /stateLabel \?\? artifactState\?\.label \?\? "Thinking"/);
  assert.match(cards, /function ArtifactBloomLoader\(\)/);
  assert.match(cards, /motion-safe:animate-spin/);
  assert.match(cards, /Your artifact is taking shape/);
  assert.match(
    cards,
    /artifact\.status === "draft" \|\| artifact\.status === "generating"/,
  );
  assert.match(cards, /<InlineArtifactLoadingCard key=\{artifact\.id\}/);
});

test("response actions sit below response-owned artifacts on every artifact chat surface", () => {
  for (const transcript of [runtimePanel, gardenWorkspace]) {
    const messagesStart = transcript.indexOf("messages.map");
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
    const messagesStart = transcript.indexOf("messages.map");
    const slotOpen = transcript.indexOf("<MessageActionsSlot>", messagesStart);
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
  assert.match(cards, /export function primeInlineArtifacts/);
  assert.match(
    runtimePanel,
    /useInlineArtifactPrefetch\(\{\s*conversationId: surface !== "quartz_ai" \? sessionId : null,\s*\}\)/,
  );
  // Opening or restoring a chat asks for both at once, rather than waiting for
  // the transcript to arrive before the artifacts are even requested.
  assert.match(
    agentSession,
    /primeInlineArtifacts\(\{ conversationId: id \}\);[\s\S]*loadHermesSessionDetail\(surface, id\)/,
  );
  assert.match(
    agentSession,
    /primeInlineArtifacts\(\{ conversationId: selected\.id \}\);\s*const restored = await loadHermesSessionDetail/,
  );
  // Answers are kept per query so a mounting provider paints from them at once,
  // and joins a request already in flight instead of asking again.
  assert.match(cards, /const artifactCache = new Map</);
  assert.match(cards, /artifactCache\.get\(query\) \?\? \[\]/);
  assert.match(cards, /const pending = artifactRequests\.get\(query\);/);
});

test("gadgets use the standard artifact placeholder until opened", () => {
  assert.doesNotMatch(cards, /import InlineGadget|isGadgetArtifact/);
  assert.match(cards, /<ArtifactFileIcon kind=\{artifact\.kind\} \/>/);
  assert.match(viewer, /if \(isGadget\) \{\s*return <InlineGadget artifact=\{artifact\} \/>/);
  assert.match(
    viewer,
    /hardwareBlueprint \|\| vimaxFilm \|\| socialsPost \|\| isGadget[\s\S]*?"h-\[92vh\] max-h-\[92vh\] max-w-\[min\(88rem,96vw\)\]"/,
  );
});

test("both runtime and legacy garden chats pin artifact cards to their owning message", () => {
  assert.match(
    runtimePanel,
    /<InlineArtifactCardsProvider[\s\S]*conversationId=\{surface !== "quartz_ai" \? sessionId : null\}[\s\S]*messages\.map[\s\S]*<InlineArtifactCards[\s\S]*ownerMessageId=\{[\s\S]*message\.artifactMessageId \?\? message\.id \?\? null/,
  );
  assert.match(
    gardenWorkspace,
    /<InlineArtifactCardsProvider[\s\S]*legacyChatSessionId=\{chatSessionId\}[\s\S]*messages\.map[\s\S]*<InlineArtifactCards[\s\S]*ownerMessageId=\{msg\.artifactMessageId \?\? msg\.id \?\? null\}/,
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
  assert.match(gardenWorkspace, /window\.addEventListener\(GARDEN_DOCUMENTS_CHANGED_EVENT/);
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
  assert.match(artifactPdfPage, /\sreadOnly\s/);
  assert.match(nativePdfViewer, /sourceUrl\?: string/);
  assert.match(nativePdfViewer, /readOnly\?: boolean/);
  assert.match(nativePdfViewer, /readOnly \? "PDF artifact" : "PDF source"/);
});

test("Markdown artifacts retain the document preview modal", () => {
  assert.match(
    viewer,
    /artifact\.kind === "markdown"[\s\S]*?<ArtifactDocumentViewport>[\s\S]*?<article[\s\S]*?<ChatMarkdown content=\{text\}/,
  );
  // Full-height and wide: the modal is a reading surface, not a preview chip.
  assert.match(
    viewer,
    /usesDocumentViewer[\s\S]*?"h-\[92vh\] max-h-\[92vh\] max-w-\[min\(76rem,95vw\)\]"/,
  );
  assert.match(
    viewer,
    /usesDocumentViewer \? "overflow-hidden p-0" : "overflow-auto px-5 py-4"/,
  );
});
