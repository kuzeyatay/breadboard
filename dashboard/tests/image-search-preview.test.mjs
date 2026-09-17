import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { prepareImageSearchPreview } from '../src/lib/hermes/image-search-preview.ts';
import { searchImages } from '../src/lib/hermes/image-search-service.ts';

const base = 'https://93.184.216.34';
const picture = (index) => ({ title: `Subject ${index}`, image: `${base}/${index}.jpg`, thumb: `${base}/${index}-thumb.jpg`, page: `${base}/source/${index}`, site: 'example.com' });
const candidates = (items) => ({ query: 'subject portrait', itemsReturned: items.length, display: { query: 'subject portrait', items } });
const makeImage = (color) => sharp({ create: { width: 160, height: 120, channels: 3, background: color } }).jpeg().toBuffer();

test('broken originals use the viewed thumbnail; invalid images and duplicates are replaced', async () => {
  const red = await makeImage('red');
  const green = await makeImage('green');
  const calls = [];
  const result = await prepareImageSearchPreview(candidates([picture(1), picture(1), picture(2), picture(3), picture(4)]), 2, 1, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/1-thumb.jpg')) return new Response(red);
      if (String(url).endsWith('/3.jpg')) return new Response(green);
      if (String(url).includes('/2')) return new Response('<html>Not an image</html>');
      return new Response('blocked', { status: 403 });
    },
  });
  assert.equal(result.itemsReturned, 2);
  assert.equal(result.display.items[0].image, picture(1).thumb);
  assert.equal(result.display.items[0].thumb, picture(1).thumb);
  assert.equal(result.display.items[1].image, picture(3).image);
  assert.deepEqual(result.display.items.map(item => item.page), [picture(1).page, picture(3).page]);
  assert.equal(result.nextPageStartIndex, 5, 'pagination advances past examined candidates, including duplicates/failures');
  assert.equal(calls.filter(url => url === picture(1).image).length, 1);
  assert.ok(!calls.includes(picture(4).image), 'stop after the chosen number has loaded');
  const bytes = Buffer.from(result.screenshot.dataUrl.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 1536);
  assert.equal(metadata.height, 616);
  // Verify actual pixels and order, not just the existence of an image envelope.
  const pixels = await sharp(bytes).raw().toBuffer();
  const at = (x, y) => [...pixels.subarray((y * metadata.width + x) * 3, (y * metadata.width + x) * 3 + 3)];
  assert.ok(at(384, 328)[0] > 240);
  assert.ok(at(1152, 328)[1] > 100);
});

test('same pixels at different URLs do not fill the gallery twice', async () => {
  const red = await makeImage('red');
  const result = await prepareImageSearchPreview(candidates([picture(1), picture(2)]), 2, 1, {
    fetchImpl: async () => new Response(red),
  });
  assert.equal(result.itemsReturned, 1);
});

test('an unviewable result produces no screenshot or fabricated display image', async () => {
  const result = await prepareImageSearchPreview(candidates([picture(1)]), 1, 1, {
    fetchImpl: async () => new Response('<html>login</html>'),
  });
  assert.deepEqual(result.display.items, []);
  assert.equal(result.itemsReturned, 0);
  assert.equal(result.screenshot, undefined);
});

test('preview fetch rejects private addresses, including redirect targets', async () => {
  const calls = [];
  const result = await prepareImageSearchPreview(candidates([
    { ...picture(1), image: 'http://127.0.0.1/private.jpg', thumb: '' },
    { ...picture(2), thumb: '' },
  ]), 2, 1, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/private.jpg' } });
    },
  });
  assert.deepEqual(calls, [picture(2).image]);
  assert.equal(result.itemsReturned, 0);
});

test('cancelled preview work stops before making any request', async () => {
  await assert.rejects(() => prepareImageSearchPreview(candidates([picture(1)]), 1, 1, {
    signal: AbortSignal.abort(), fetchImpl: () => { throw new Error('must not fetch'); },
  }), { name: 'AbortError' });
});

test('keyless public search respects every chosen count and delivers actual preview pixels', async () => {
  const savedFetch = globalThis.fetch;
  const images = await Promise.all(['red', 'green', 'blue', 'yellow', 'purple'].map(makeImage));
  globalThis.fetch = async (url) => {
    const address = String(url);
    if (address.startsWith('https://duckduckgo.com/?')) return new Response('vqd="123-456"');
    if (address.startsWith('https://duckduckgo.com/i.js?')) return Response.json({ results: Array.from({ length: 5 }, (_, index) => ({ title: `Portrait ${index}`, image: `${base}/${index}.jpg`, url: `${base}/source/${index}` })), next: '/next' });
    const index = Number(new URL(address).pathname.match(/\d+/)?.[0]);
    return new Response(images[index]);
  };
  try {
    for (const count of [undefined, 1, 2, 3, 4, 5]) {
      const result = await searchImages({ query: 'subject portrait', ...(count ? { count } : {}) });
      assert.equal(result.itemsReturned, count ?? 1);
      assert.equal(result.display.items.length, count ?? 1);
      assert.match(result.screenshot.dataUrl, /^data:image\/jpeg;base64,/);
      assert.ok(result.nextPageStartIndex > result.itemsReturned);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('argument bounds reject malformed values before downloading', async () => {
  const neverFetch = () => { assert.fail('invalid arguments reached the network'); };
  for (const count of [0, 6, -1, 1.1, NaN, Infinity, '2', null]) {
    await assert.rejects(() => prepareImageSearchPreview(candidates([picture(1)]), count, 1, { fetchImpl: neverFetch }));
  }
  for (const start of [0, 92, 1.5, NaN, '2']) {
    await assert.rejects(() => prepareImageSearchPreview(candidates([picture(1)]), 1, start, { fetchImpl: neverFetch }));
  }
});

test('five differently shaped images keep their proportions and contact-sheet order', async () => {
  const dimensions = [[100, 300], [300, 100], [150, 150], [800, 200], [200, 800]];
  const colors = ['red', 'green', 'blue', 'yellow', 'purple'];
  const pictures = await Promise.all(dimensions.map(([width, height], index) =>
    sharp({ create: { width, height, channels: 4, background: colors[index] } }).png().toBuffer()));
  const result = await prepareImageSearchPreview(candidates(colors.map((_, index) => picture(index))), 5, 1, {
    fetchImpl: async url => new Response(pictures[Number(new URL(url).pathname.match(/\d+/)[0])]),
  });
  const sheet = Buffer.from(result.screenshot.dataUrl.split(',')[1], 'base64');
  const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1536); assert.equal(info.height, 1848);
  const centers = [[384, 328], [1152, 328], [384, 944], [1152, 944], [384, 1560]];
  const expected = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0], [128, 0, 128]];
  for (let index = 0; index < 5; index++) {
    const item = result.display.items[index];
    assert.ok(Math.abs(item.w / item.h - dimensions[index][0] / dimensions[index][1]) < 0.01);
    const [x, y] = centers[index];
    const sample = [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    assert.ok(sample.every((channel, i) => Math.abs(channel - expected[index][i]) <= 4), `wrong pixels at picture ${index + 1}`);
  }
  assert.equal(result.inspection.status, 'awaiting_review');
  assert.equal(result.inspection.loaded, 5);
});

test('EXIF rotation is applied before reporting display dimensions', async () => {
  const rotated = await sharp({ create: { width: 240, height: 120, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepareImageSearchPreview(candidates([picture(1)]), 1, 1, { fetchImpl: async () => new Response(rotated) });
  assert.equal(result.display.items[0].w, 120);
  assert.equal(result.display.items[0].h, 240);
});

test('tracking pixels and oversized downloads are replaced by readable candidates', async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  const good = await makeImage('blue');
  let released = false;
  const result = await prepareImageSearchPreview(candidates([picture(1), picture(2), picture(3)]), 1, 1, {
    fetchImpl: async url => {
      if (String(url).includes('/1')) return new Response(tiny);
      if (String(url).includes('/2')) return new Response(new ReadableStream({ cancel() { released = true; } }), { headers: { 'content-length': String(9 * 1024 * 1024) } });
      return new Response(good);
    },
  });
  assert.equal(result.itemsReturned, 1);
  assert.equal(result.display.items[0].image, picture(3).image);
  assert.equal(released, true, 'oversized bodies are cancelled instead of left open');
});

test('redirected images retain the source page and use the actual viewed URL', async () => {
  const pixels = await makeImage('red');
  const result = await prepareImageSearchPreview(candidates([picture(1)]), 1, 1, {
    fetchImpl: async url => String(url).endsWith('/1.jpg')
      ? new Response(null, { status: 302, headers: { location: '/actual.jpg' } }) : new Response(pixels),
  });
  assert.equal(result.display.items[0].image, `${base}/actual.jpg`);
  assert.equal(result.display.items[0].page, picture(1).page);
});

test('preview deadline preserves loaded pictures while reporting a partial inspection', async () => {
  const pixels = await makeImage('blue');
  const result = await prepareImageSearchPreview(candidates([picture(1), picture(2)]), 2, 1, {
    timeoutMs: 2000,
    fetchImpl: async (url, init) => {
      if (String(url) === picture(1).image) return new Response(pixels);
      return new Promise((resolve, reject) => {
        const socket = setTimeout(() => reject(new Error('download did not cancel')), 10_000);
        init.signal.addEventListener('abort', () => { clearTimeout(socket); reject(init.signal.reason); }, { once: true });
      });
    },
  });
  assert.equal(result.itemsReturned, 1);
  assert.equal(result.display.items[0].image, picture(1).image);
  assert.equal(result.inspection.timedOut, true);
  assert.equal(result.inspection.requested, 2);
  assert.ok(result.screenshot);
});

test('provider pagination uses raw positions after malformed results are removed', async (t) => {
  const pixels = await makeImage('blue');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const address = String(url); requests.push(address);
    if (address.startsWith('https://duckduckgo.com/?')) return new Response('vqd="123-456"');
    if (address.startsWith('https://duckduckgo.com/i.js?')) return Response.json({ results: [
      null, { image: 'javascript:bad' }, { image: picture(1).image, url: picture(1).page },
      { image: 'http://' }, { image: picture(2).image, url: picture(2).page },
    ], next: '/next' });
    return new Response(pixels);
  });
  const result = await searchImages({ query: 'portrait', count: 1, startIndex: 5, safe: 'high' });
  assert.equal(result.nextPageStartIndex, 9, 'the next valid candidate is provider position 9');
  assert.equal(result.candidatePositions, undefined, 'internal provider offsets stay out of model display data');
  const searchUrl = new URL(requests.find(url => url.includes('/i.js?')));
  assert.equal(searchUrl.searchParams.get('s'), '4');
  assert.equal(searchUrl.searchParams.get('p'), '1');
});

test('an empty provider page cannot suggest the same page indefinitely', async (t) => {
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/i.js?')
    ? Response.json({ results: [], next: '/next' }) : new Response('vqd="123-456"'));
  const result = await searchImages({ query: 'no results', count: 1 });
  assert.equal(result.itemsReturned, 0);
  assert.equal(result.screenshot, undefined);
  assert.equal(result.nextPageStartIndex, undefined);
  assert.equal(result.inspection.status, 'unavailable');
});

test('provider errors have actionable typed failures without leaking malformed content', async (t) => {
  let mode = 'token-missing';
  t.mock.method(globalThis, 'fetch', async url => {
    if (mode === 'refused') return new Response('denied', { status: 429 });
    if (mode === 'token-missing') return new Response('<html>captcha</html>');
    if (!String(url).includes('/i.js?')) return new Response('vqd="123-456"');
    if (mode === 'bad-json') return new Response('not-json');
    return Response.json(mode === 'null-json' ? null : { results: 'broken' });
  });
  for (mode of ['token-missing', 'refused', 'bad-json', 'null-json', 'bad-results']) {
    await assert.rejects(() => searchImages({ query: 'portrait', count: 1 }), error => error.code?.startsWith('image_search_'));
  }
});

test('invalid public queries, pagination and safety options fail before any request', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('invalid input reached provider'); });
  for (const input of [null, {}, { query: '' }, { query: 'x'.repeat(513) },
    ...[0, 92, 1.5, true, '2', null].map(startIndex => ({ query: 'x', startIndex })),
    ...['yes', false, null].map(safe => ({ query: 'x', safe }))]) {
    await assert.rejects(() => searchImages(input), error => error.code === 'image_search_invalid_arguments');
  }
  await assert.rejects(() => searchImages({ query: 'portrait' }, { signal: AbortSignal.abort() }), error => error.code === 'image_search_aborted');
});

test('user cancellation during a download stops the whole response', async () => {
  const controller = new AbortController();
  await assert.rejects(() => prepareImageSearchPreview(candidates([picture(1)]), 1, 1, {
    signal: controller.signal,
    fetchImpl: async () => { controller.abort(); throw controller.signal.reason; },
  }), { name: 'AbortError' });
});

test('preview pagination never moves backwards or outside provider limits', async () => {
  const pixels = await makeImage('red');
  for (const nextPageStartIndex of [0, 1, 5.5, 92, 101, '6', NaN]) {
    const result = await prepareImageSearchPreview({ ...candidates([picture(1)]), nextPageStartIndex }, 1, 5, { fetchImpl: async () => new Response(pixels) });
    assert.equal(result.nextPageStartIndex, undefined);
  }
});
