import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attachedImages, inspectAttachedImage } from '../src/lib/hermes/attachment-image.ts';
import { legacyImageBytes, ownedImageUpload } from '../src/lib/hermes/legacy-image-link.ts';

const photo = async color => ({ type: 'image', name: 'photo.jpg',
  dataUrl: `data:image/png;base64,${(await sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).png().toBuffer()).toString('base64')}` });
const message = (id, attachments) => ({ id, metadata: JSON.stringify({ attachments }) });

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
