import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attachedImages, inspectAttachedImage } from '../src/lib/hermes/attachment-image.ts';
import { imageAnnotationPrompt } from '../src/lib/image-annotation-prompt.ts';
import { drawImageMarks } from '../src/lib/hermes/image-marks.ts';
import { legacyImageBytes, ownedImageUpload } from '../src/lib/hermes/legacy-image-link.ts';
import { writeDocumentBlob, writeDocumentFigures, documentFiguresDirectory } from '../src/lib/conversations/document-blob-store.ts';

const photo = async color => ({ type: 'image', name: 'photo.jpg',
  dataUrl: `data:image/png;base64,${(await sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).png().toBuffer()).toString('base64')}` });
const message = (id, attachments) => ({ id, metadata: JSON.stringify({ attachments }) });

test('an unavailable workspace view prevents inspecting an older view as the current screen', async () => {
  const previous = message(1, [{ ...await photo('blue'), context: 'workspace' }]);
  const current = message(2, [{ type: 'file', name: 'Workspace view status', context: 'workspace' }]);
  assert.deepEqual(attachedImages([current, previous]), []);
});

test('the latest document exposes all its figures in order instead of an older screenshot', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-figures-'));
  const prior = process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = root;
  t.after(async () => {
    if (prior === undefined) delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    else process.env.BREADBOARD_CHAT_DOCUMENT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  });
  const owner = { userId: 7 };
  const blob = await writeDocumentBlob({ ...owner, format: 'docx', body: new Blob(['document fixture']).stream() });
  const red = await photo('red'), blue = await photo('blue');
  const figures = writeDocumentFigures({ ...owner, blobId: blob.blobId,
    figures: Array.from({ length: 17 }, (_, i) => ({ extension: 'png',
      bytes: Buffer.from((i === 16 ? blue : red).dataUrl.split(',')[1], 'base64') })) });
  const document = { type: 'document', name: 'Report.docx', blobId: blob.blobId, format: 'docx', figures };
  const messages = [message(10, []), message(9, [document]), message(8, [await photo('green')])];
  assert.deepEqual(attachedImages(messages).map(image => image.figure), figures);
  const result = await inspectAttachedImage(messages, { image: 17, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }, owner);
  assert.equal(result.count, 17);
  assert.equal(result.name, 'Report.docx');
  assert.equal(result.figure, 'figure-17.png');
  assert.equal(result.url, `/api/chat-attachments/documents/${blob.blobId}?figure=figure-17.png`);
  const markedFigure = await inspectAttachedImage(messages, { image: 17, marks: ['ellipse,100,100,900,900'] }, owner);
  const figureParams = new URL(markedFigure.url, 'http://localhost').searchParams;
  assert.equal(figureParams.get('figure'), 'figure-17.png');
  assert.deepEqual(figureParams.getAll('mark'), ['ellipse,100,100,900,900']);
  const pixels = Buffer.from(result.screenshot.dataUrl.split(',')[1], 'base64');
  const metadata = await sharp(pixels).metadata();
  assert.equal(metadata.width, 20); assert.equal(metadata.height, 20);
  const { channels } = await sharp(pixels).stats();
  assert.ok(channels[2].mean > 240); assert.ok(channels[0].mean < 10);

  // Mixed attachments keep image numbers predictable, including duplicate names.
  const mixed = attachedImages([message(11, [red, document, blue])]);
  assert.equal(mixed.length, 19);
  assert.equal(mixed[0].uploadId, '11-0');
  assert.equal(mixed[17].figure, 'figure-17.png');
  assert.equal(mixed[18].uploadId, '11-2');

  // Document bytes remain scoped to the authenticated owner, and an unavailable
  // figure must not fall back to unrelated evidence from an earlier message.
  await assert.rejects(inspectAttachedImage(messages, { image: 1 }), /document is unavailable/);
  await assert.rejects(inspectAttachedImage(messages, { image: 1 }, { userId: 8 }), /document is unavailable/);
  await rm(path.join(documentFiguresDirectory({ ...owner, blobId: blob.blobId }), 'figure-1.png'));
  await assert.rejects(inspectAttachedImage(messages, { image: 1 }, owner), /figure-1.png is unavailable/);
  await assert.rejects(inspectAttachedImage([message(12, [{ ...document, figures: [] }]), messages[2]], {}, owner), /No attached images/);
});

test('duplicate photo names retain order and a crop returns real pixels plus the original preview link', async () => {
  const images = [await photo('red'), await photo('blue')];
  const messages = [message(8, images), message(7, [await photo('green')])];
  assert.equal(attachedImages(messages).length, 2);
  const result = await inspectAttachedImage(messages, { image: 2, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } });
  assert.equal(result.url, '/api/hermes/uploads/8-1/content');
  const bytes = Buffer.from(result.screenshot.dataUrl.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 20); assert.equal(metadata.height, 20);
  const { channels } = await sharp(bytes).stats();
  assert.ok(channels[2].mean > 240); assert.ok(channels[0].mean < 10);
  assert.equal(result.originalWidth, 40);
});

test('unavailable image numbers, invalid data and out-of-bounds crops fail clearly', async () => {
  const messages = [message(2, [await photo('red')])];
  for (const image of [0, 2, -1, 1.5, '1']) await assert.rejects(inspectAttachedImage(messages, { image }));
  for (const crop of [null, [], { x: 0.9, y: 0, width: 0.2, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }]) {
    await assert.rejects(inspectAttachedImage(messages, { crop }));
  }
  await assert.rejects(inspectAttachedImage([], {}));
});

test('basic chat binds mark links to the exact vision inputs and their stored upload order', async () => {
  const blue = await photo('blue'), red = await photo('red');
  const row = message(18, [{ type: 'file', name: 'notes.txt' }, blue, red]);
  const guide = imageAnnotationPrompt([blue, red], row);
  assert.match(guide, /Image 1: \/api\/hermes\/uploads\/18-1\/content/);
  assert.match(guide, /Image 2: \/api\/hermes\/uploads\/18-2\/content/);
  assert.equal(imageAnnotationPrompt([red, blue], row), '');
  assert.equal(imageAnnotationPrompt([blue], null), '');
  const automatic = { ...red, context: 'workspace' };
  const mixed = message(19, [automatic, blue]);
  assert.match(imageAnnotationPrompt([automatic, blue], mixed), /Image 1: \/api\/hermes\/uploads\/19-1\/content \(visual input 2\)/);
  const marked = await inspectAttachedImage([message(20, [automatic]), mixed], { image: 1, marks: ['box,20,20,940,940'] });
  assert.ok(marked.url.startsWith('/api/hermes/uploads/19-1/content?'));
});

test('EXIF rotation precedes coordinate placement and invalid marks produce no view', async () => {
  const bytes = await sharp({ create: { width: 60, height: 120, channels: 3, background: 'white' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { png, originalWidth, originalHeight } = await drawImageMarks(bytes, ['line,100,250,900,250']);
  assert.deepEqual([originalWidth, originalHeight], [120, 60]);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [120, 60]);
  assert.ok(data[(15 * 120 + 60) * 3] < 200);
  for (const marks of [[], Array(25).fill('line,0,0,100,100'), ['box,900,900,5,30'],
    ['arrow,0,0,NaN,450'], ['label,5,5,'], ['path,0,0,100,100']]) {
    await assert.rejects(drawImageMarks(bytes, marks));
  }
});

test('legacy links resolve only retained owned bytes under the runtime image directory', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'attachment-links-'));
  try {
    const root = path.join(temp, 'images'); await mkdir(root);
    const image = await photo('blue'); const bytes = Buffer.from(image.dataUrl.split(',')[1], 'base64');
    const file = path.join(root, 'upload.jpg'); await writeFile(file, bytes);
    await writeFile(path.join(temp, 'private.jpg'), bytes);
    await writeFile(path.join(root, 'secret.txt'), bytes);
    assert.deepEqual(await legacyImageBytes(file, root), bytes);
    assert.equal(await legacyImageBytes(path.join(root, '..', 'private.jpg'), root), null);
    assert.equal(await legacyImageBytes(path.join(root, 'secret.txt'), root), null);
    assert.equal(await legacyImageBytes(path.join(root, 'missing.jpg'), root), null);
    assert.equal(ownedImageUpload(bytes, [message(4, [image])]), '4-0');
    assert.equal(ownedImageUpload(bytes, [message(5, [await photo('red')])]), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
