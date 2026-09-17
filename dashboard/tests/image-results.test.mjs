import assert from 'node:assert/strict';
import test from 'node:test';
import { imageResultUrl, parseImageResults, remarkLimitImageResults } from '../src/lib/hermes/image-results.ts';

const item = index => ({ image: `https://example.com/${index}.jpg`, title: `Picture ${index}` });
const block = items => ({ type: 'code', lang: 'image-results', value: JSON.stringify({ query: 'subject', items }) });

test('malformed URLs, credentials, control characters and unsafe schemes never reach the gallery', () => {
  for (const url of ['http://', 'https://[oops', 'https://user:password@example.com/x.jpg',
    'https://example.com/a\nb.jpg', 'https://example.com\\x.jpg', 'file:///tmp/a.jpg',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '//example.com/x.jpg', null, 42]) {
    assert.equal(imageResultUrl(url), '', String(url));
  }
  const signed = 'https://EXAMPLE.com/x.jpg?signature=a%2Fb&size=200';
  assert.equal(imageResultUrl(signed), signed, 'do not rewrite signed destinations');
});

test('all 1–5 gallery sizes survive parsing while overflow is capped', () => {
  for (let count = 1; count <= 9; count++) {
    const parsed = parseImageResults(block(Array.from({ length: count }, (_, i) => item(i))).value);
    assert.equal(parsed.items.length, Math.min(count, 5));
  }
});

test('malformed and partial payloads do not consume image slots', () => {
  const seen = new Set();
  for (const code of ['', '{', 'null', '[]', '1', '"hello"', '{"items":{}}', '{"items":[null,1,"bad",{}]}']) {
    assert.equal(parseImageResults(code, seen), null);
    assert.equal(seen.size, 0);
  }
});

test('URL aliases deduplicate, but distinct query parameters remain distinct', () => {
  const parsed = parseImageResults(block([
    { image: 'https://EXAMPLE.com:443/a.jpg#one' }, { image: 'https://example.com/a.jpg#two' },
    { image: 'https://example.com/a.jpg?view=front' }, { image: 'https://example.com/a.jpg?view=back' },
  ]).value);
  assert.equal(parsed.items.length, 3);
});

test('a valid thumbnail replaces an invalid original and dimensions are sanitized', () => {
  const parsed = parseImageResults(block([{ image: 'javascript:bad', thumb: 'https://example.com/preview.jpg',
    page: 'https://secret:password@example.com', title: 42, site: {}, w: -1, h: 800 }]).value);
  assert.equal(parsed.items[0].image, 'https://example.com/preview.jpg');
  assert.equal(parsed.items[0].page, '');
  assert.equal(parsed.items[0].title, '');
  assert.equal(parsed.items[0].w, undefined);
  assert.equal(parsed.items[0].h, undefined);
});

test('later fences scan past previously seen images to fill the remaining budget', () => {
  const tree = { type: 'root', children: [block([item(0), item(1)]), block([
    item(0), item(1), item(2), item(3), item(4), item(5),
  ])] };
  remarkLimitImageResults()(tree);
  assert.deepEqual(tree.children.map(node => JSON.parse(node.value).items.map(row => row.image)), [
    [item(0).image, item(1).image], [item(2).image, item(3).image, item(4).image],
  ]);
});

test('Markdown image budgets reset for each render and preserve ordinary code', () => {
  const transform = remarkLimitImageResults();
  for (let render = 0; render < 2; render++) {
    const ordinary = { type: 'code', lang: 'javascript', value: 'const pictures = 20;' };
    const tree = { type: 'root', children: [ordinary, { type: 'blockquote', children: [block([item(1)])] }] };
    transform(tree);
    assert.equal(ordinary.value, 'const pictures = 20;');
    assert.equal(JSON.parse(tree.children[1].children[0].value).items.length, 1);
  }
});
