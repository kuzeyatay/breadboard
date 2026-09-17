import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeCloneResult, validateImageSearchRequest } from '../scripts/runtime-v2-image-search-worker.mjs';
import { imageResult } from '../src/lib/hermes/image-search-runtime-v2.ts';
import { prepareImageSearchPreview } from '../src/lib/hermes/image-search-preview.ts';

const request = { query: 'subject portrait', count: 5, safe: null, startIndex: 5 };
const item = index => ({ title: `Picture ${index}`, link: `https://93.184.216.34/${index}.jpg`, displayLink: 'example.com',
  image: { contextLink: `https://example.com/source/${index}`, dimensions: '320x240', thumbnail: { link: `https://93.184.216.34/thumb-${index}.jpg` } } });
const response = (items, summary = {}) => ({ content: [{ type: 'text', text: JSON.stringify({ imageResults: { items, summary } }, null, 2) }] });

test('Google structured results accept JSON whitespace and accompanying text notes', () => {
  const upstream = response([item(1)]);
  upstream.content.unshift({ type: 'text', text: 'Image results follow.' });
  upstream.content.push({ type: 'text', text: 'End of results.' });
  const result = normalizeCloneResult(upstream, request);
  assert.equal(result.ok, true);
  assert.equal(result.data.query, request.query);
  assert.equal(result.data.display.items[0].page, item(1).image.contextLink);
  assert.equal(result.data.display.items[0].w, 320);
});

test('Google provider slots survive filtering, runtime validation and pixel preparation', async () => {
  const raw = normalizeCloneResult(response([null, item(1), false, item(2)], { pagination: { nextPageStartIndex: 10 } }), request);
  const decoded = imageResult(raw.data);
  assert.deepEqual(decoded.candidatePositions, [6, 8]);
  const pixels = await sharp({ create: { width: 160, height: 120, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const prepared = await prepareImageSearchPreview(decoded, 1, 5, { fetchImpl: async () => new Response(pixels) });
  assert.equal(prepared.nextPageStartIndex, 8);
  assert.equal(prepared.itemsReturned, 1);
  assert.equal(prepared.candidatePositions, undefined);
  assert.equal(prepared.display.items[0].image, item(1).link);
  assert.ok(prepared.screenshot);
});

test('Google thumbnail-only results can still reach visual inspection', () => {
  const thumbnailOnly = { ...item(1), link: '' };
  const result = normalizeCloneResult(response([thumbnailOnly]), request);
  assert.equal(result.ok, true);
  assert.equal(imageResult(result.data).display.items[0].image, thumbnailOnly.image.thumbnail.link);
});

test('Google worker errors and malformed/oversized responses cannot become successful searches', () => {
  for (const upstream of [
    { ...response([item(1)]), isError: true },
    { _meta: { error: { message: 'quota exceeded' } } },
    { content: [{ type: 'text', text: 'not JSON' }] },
    { content: [{ type: 'text', text: JSON.stringify({ imageResults: { items: {} } }) }] },
    { content: [{ type: 'text', text: 'x'.repeat(512 * 1024 + 1) }] },
  ]) {
    const result = normalizeCloneResult(upstream, request);
    assert.equal(result.ok, false);
    assert.ok(result.code.startsWith('image_search_'));
    assert.ok(result.message.length < 512);
  }
});

test('Google internal overfetch remains bounded independently of the five-image answer budget', () => {
  const canonical = { ...request, count: 10 };
  assert.equal(validateImageSearchRequest(canonical), canonical);
  assert.throws(() => validateImageSearchRequest({ ...canonical, count: 11 }));
  const result = normalizeCloneResult(response(Array.from({ length: 15 }, (_, i) => item(i))), canonical);
  assert.equal(result.data.itemsReturned, 10);
});

test('runtime refuses inconsistent display counts and forged provider positions', () => {
  const good = normalizeCloneResult(response([item(1), item(2)]), request).data;
  for (const changes of [
    { itemsReturned: 1 }, { display: { ...good.display, query: 'another query' } },
    ...[[6], [7, 6], [6, 6], [0, 6], [6, 101], ['6', '7']].map(candidatePositions => ({ candidatePositions })),
  ]) assert.throws(() => imageResult({ ...good, ...changes }));
  const legacy = { ...good }; delete legacy.candidatePositions;
  assert.equal(imageResult(legacy).itemsReturned, 2, 'older installed workers remain compatible');
});
