import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  chatMessageAttachments,
  extractChatAttachments,
  imageFilesFromClipboard,
  normalizeChatMessageAttachments,
  reusableChatAttachments,
} from '../src/lib/chat-attachments.ts';

test('message attachments retain safe image data while text files retain only their name', () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  assert.deepEqual(
    chatMessageAttachments([
      { type: 'image', name: 'pasted-screenshot-1.png', dataUrl },
      { type: 'text', name: 'notes.md', text: 'private extracted text' },
    ]),
    [
      { type: 'image', name: 'pasted-screenshot-1.png', dataUrl },
      { type: 'file', name: 'notes.md' },
    ],
  );
  assert.deepEqual(
    normalizeChatMessageAttachments([
      { type: 'image', name: 'unsafe.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { type: 'image', name: 'pasted-screenshot-1.png', dataUrl },
    ]),
    [{ type: 'image', name: 'pasted-screenshot-1.png', dataUrl }],
  );
});

test('regeneration reuses stored images without restoring non-image file contents', () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  assert.deepEqual(
    reusableChatAttachments([
      { type: 'image', name: 'pasted-screenshot-1.png', dataUrl },
      { type: 'file', name: 'notes.md' },
    ]),
    [{ type: 'image', name: 'pasted-screenshot-1.png', dataUrl }],
  );
});

test('plain-text documents are attached without a server extraction round trip', async () => {
  const file = new File(['Breadboard notes'], 'notes.md', { type: 'text/markdown' });
  const result = await extractChatAttachments([file]);

  // The picked file's size is recorded so the Uploads list can report it for a
  // document whose contents are never retained.
  assert.deepEqual(result, {
    attachments: [
      { type: 'text', text: 'Breadboard notes', name: 'notes.md', sizeBytes: 16 },
    ],
    errors: [],
    warnings: [],
  });
});

test('clipboard images are returned while ordinary clipboard content is ignored', () => {
  const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
  const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  const files = imageFilesFromClipboard({
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'text/plain', getAsFile: () => document },
      { kind: 'file', type: '', getAsFile: () => image },
    ],
    files: [image, document],
  });

  assert.deepEqual(files, [image]);
});

test('clipboard image files fall back to the files collection and receive a usable extension', () => {
  const unnamedImage = new File(['image'], '', { type: 'image/png' });
  const files = imageFilesFromClipboard({
    items: [],
    files: [unnamedImage],
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'pasted-image-1.png');
  assert.equal(files[0].type, 'image/png');
});

test('clipboard item MIME metadata repairs image blobs without a type or extension', () => {
  const untypedImage = new File(['image'], '', { type: '' });
  const files = imageFilesFromClipboard({
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => untypedImage },
    ],
    files: [],
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'pasted-image-1.png');
  assert.equal(files[0].type, 'image/png');
});

test('every attachment-enabled chat wires image paste into its attachment pipeline', () => {
  const composer = readFileSync(
    new URL('../src/app/components/assistant-composer.tsx', import.meta.url),
    'utf8',
  );
  const runtime = readFileSync(
    new URL('../src/app/components/hermes/agent-runtime-panel.tsx', import.meta.url),
    'utf8',
  );
  const dashboard = readFileSync(
    new URL('../src/app/components/hermes/dashboard-agent-terminal.tsx', import.meta.url),
    'utf8',
  );
  const gardenAssistant = readFileSync(
    new URL('../src/app/garden/garden-assistant.tsx', import.meta.url),
    'utf8',
  );
  const knowledgeTerminal = readFileSync(
    new URL('../src/app/components/knowledge-terminal.tsx', import.meta.url),
    'utf8',
  );
  const gardenWorkspace = readFileSync(
    new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx', import.meta.url),
    'utf8',
  );

  assert.match(composer, /const imageFiles = imageFilesFromClipboard\(event\.clipboardData\)/);
  assert.match(composer, /event\.preventDefault\(\);\s+void onPasteFiles\(imageFiles\)/);
  assert.match(runtime, /onPasteFiles=\{onPasteFiles\}/);
  assert.match(dashboard, /onPasteFiles=\{addAttachmentFiles\}/);
  assert.match(gardenAssistant, /onPasteFiles=\{addAttachmentFiles\}/);
  assert.match(knowledgeTerminal, /onPasteFiles=\{addAttachmentFiles\}/);
  assert.match(gardenWorkspace, /onPaste=\{handleChatPaste\}/);
});

test('sent images persist into transcripts and open in the shared full-screen viewer', () => {
  const viewer = readFileSync(
    new URL('../src/app/components/chat-message-attachments.tsx', import.meta.url),
    'utf8',
  );
  const runtime = readFileSync(
    new URL('../src/app/components/hermes/agent-runtime-panel.tsx', import.meta.url),
    'utf8',
  );
  const gardenWorkspace = readFileSync(
    new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx', import.meta.url),
    'utf8',
  );
  const turnService = readFileSync(
    new URL('../src/lib/conversations/turn-service.ts', import.meta.url),
    'utf8',
  );

  assert.match(viewer, /bb-viewer-overlay fixed z-\[200\][^\n]+bg-black/);
  assert.match(viewer, /aria-label="Close image preview"/);
  assert.match(viewer, /src=\{attachment\.dataUrl\}/);
  assert.match(viewer, /max-h-80[^\n]+object-contain/);
  assert.match(viewer, /isPastedScreenshotName/);
  assert.doesNotMatch(viewer, /absolute right-2 top-2/);
  assert.match(runtime, /<ChatMessageAttachments/);
  assert.match(gardenWorkspace, /attachments: chatMessageAttachments\(pendingAttachments\)/);
  assert.match(gardenWorkspace, /reusableChatAttachments\(previousUser\.attachments\)/);
  assert.doesNotMatch(gardenWorkspace, /Add the original attachments again before regenerating/);
  assert.doesNotMatch(gardenWorkspace, /Pasted \$\{pastedImages\.length\} screenshot/);
  assert.match(turnService, /attachments: chatMessageAttachments\(input\.attachments\)/);
});

test('a video attachment travels as a pointer and survives a regenerated turn', () => {
  const blobId = `vid_${'b'.repeat(32)}`;
  const video = { type: 'video', name: 'lecture.mp4', blobId, format: 'mp4', sizeBytes: 4096 };

  // Kept whole in transcript metadata: unlike a document there is nothing to
  // extract, and unlike an image the bytes are far too big to inline.
  assert.deepEqual(chatMessageAttachments([video]), [video]);
  assert.deepEqual(normalizeChatMessageAttachments([video]), [video]);
  assert.deepEqual(reusableChatAttachments([video]), [video]);

  // A pointer that is not a real blob id, or names a container nothing here
  // reads, is not a video attachment at all.
  assert.deepEqual(
    normalizeChatMessageAttachments([
      { type: 'video', name: 'clip.mp4', blobId: 'mdl_1234', format: 'mp4' },
      { type: 'video', name: 'clip.rm', blobId, format: 'rm' },
    ]),
    [],
  );
});

test('videos are offered only in the Terminal, where Watch can read them', () => {
  const shared = readFileSync(new URL('../src/lib/chat-attachments.ts', import.meta.url), 'utf8');
  assert.match(shared, /export const TERMINAL_ATTACHMENT_ACCEPT/);
  // The other chats keep the accept list that has no video in it.
  assert.doesNotMatch(
    /export const CHAT_ATTACHMENT_ACCEPT =[^;]+;/.exec(shared)?.[0] ?? '',
    /VIDEO_ATTACHMENT_ACCEPT/,
  );

  const terminal = readFileSync(
    new URL('../src/app/components/hermes/dashboard-agent-terminal.tsx', import.meta.url),
    'utf8',
  );
  assert.match(terminal, /accept=\{TERMINAL_ATTACHMENT_ACCEPT\}/);
  assert.match(terminal, /extractChatAttachments\(files, \{\s*allowVideo: true,/);

  for (const file of ['../src/app/garden/garden-assistant.tsx', '../src/app/components/knowledge-terminal.tsx']) {
    const contents = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /allowVideo/, file);
  }
});
