import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dialog = source("../src/app/components/attachment-preview-dialog.tsx");
const sentAttachments = source("../src/app/components/chat-message-attachments.tsx");
const composer = source("../src/app/components/assistant-composer.tsx");
const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

test("attachment previews keep the conversation open for PDF and media", () => {
  assert.match(dialog, /source\.kind === "pdf"[\s\S]*?<iframe/);
  assert.match(dialog, /source\.kind === "audio"[\s\S]*?<BreadboardAudioPlayer/);
  assert.match(dialog, /<ReclaimingVideo/);
  assert.match(dialog, /DialogPrimitive\.Portal/);
  assert.match(dialog, /Close attachment preview/);
});

test("audio previews use the Breadboard transport and start closed and paused", () => {
  const player = source("../src/app/components/breadboard-audio-player.tsx");
  const audioBranch = dialog.slice(
    dialog.indexOf('source.kind === "audio" ? ('),
    dialog.indexOf('source.playable === false ? ('),
  );

  assert.match(dialog, /<DialogPrimitive\.Root defaultOpen=\{false\}>/);
  assert.match(dialog, /<BreadboardAudioPlayer[\s\S]*?src=\{source\.href\}[\s\S]*?label=\{source\.name\}/);
  assert.doesNotMatch(dialog, /<ReclaimingAudio/);
  assert.doesNotMatch(audioBranch, /autoPlay/);
  assert.match(player, /data-breadboard-audio-player/);
  assert.match(player, /className=\{styles\.scrubber\}/);
  assert.match(player, /preload="metadata"/);
  assert.doesNotMatch(player, /autoPlay/);
});

test("PDF and video have a context menu while audio deliberately does not", () => {
  assert.match(dialog, /source\.kind === "audio" \? \([\s\S]*?trigger[\s\S]*?: \([\s\S]*?<PreviewContextMenu/);
  assert.match(dialog, /Open \{label\} in new tab/);
  assert.match(dialog, /Open \{label\} in new window/);
});

test("selected and sent chat files use the same preview dialog", () => {
  assert.match(composer, /<AttachmentPreviewDialog[\s\S]*?kind: 'audio'/);
  assert.match(composer, /kind: 'video'/);
  assert.match(composer, /attachment\.format === 'pdf'/);
  assert.match(sentAttachments, /sourceAttachments\s*=\s*\[\]/);
  assert.match(sentAttachments, /attachment\.format === "pdf"/);
  assert.match(sentAttachments, /kind: "audio"/);
  assert.match(sentAttachments, /kind: "video"/);
});

test("Garden focus chips reconnect saved source slugs to PDF and media URLs", () => {
  assert.match(garden, /function gardenChatSourceAttachment\(/);
  assert.match(garden, /\/gardens\/\$\{encodeURIComponent\(clusterSlug\)\}\/pdf\//);
  assert.match(garden, /\/api\/gardens\/\$\{encodeURIComponent\(clusterSlug\)\}\/media\//);
  assert.match(garden, /sourceAttachments=\{focusedSourceAttachments\}/);
  assert.match(garden, /<AttachmentPreviewDialog[\s\S]*?toggleSelectedDocument/);
});
