import assert from 'node:assert/strict';
import test from 'node:test';
import * as dashboard from '../src/lib/browser-annotations.ts';
import * as desktop from '../../desktop/src/shared/browser-annotations.ts';

test('independent browser annotation build contracts preserve the same targets and identities', () => {
  const urls = ['https://example.org/a#section:~:text=word', 'http://example.org/', 'file:///private', 'https://user:secret@example.org/', 'not a URL', null, 'x'.repeat(4001)];
  for (const value of urls) assert.equal(dashboard.annotationPageUrl(value), desktop.annotationPageUrl(value));
  const valid = [
    {kind: 'page', url: urls[0], title: ' Title '},
    {kind: 'text', url: urls[0], quote: 'Quoted text', prefix: 'p'.repeat(200), suffix: 's'.repeat(200)},
    {kind: 'image', url: urls[0], mediaUrl: 'https://example.org/image.png'},
    {kind: 'video', url: urls[0], selector: 'video', time: 12.8},
  ];
  const invalid = [null, [], {}, {kind: 'text', url: urls[0], quote: ' '}, {kind: 'image', url: urls[0]}, {kind: 'video', url: urls[0], selector: 'video', time: -1}];
  for (const input of [...valid, ...invalid]) {
    const actual = dashboard.normalizeAnnotationTarget(input);
    const expected = desktop.normalizeAnnotationTarget(input);
    assert.deepEqual(actual, expected);
    if (actual) assert.equal(dashboard.annotationTargetKey(actual), desktop.annotationTargetKey(expected));
  }
});
