import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMarkdownHref, gardenDocumentHref } from '../src/lib/chat-markdown-links.ts';

const lesson = 'Concepts/24. electronic-circuits-2-course-introduction-and-integrated-circuit-research-context/prerequisite-review-of-networks-and-mosfet-circuits';

test('the two EC2 citations open their exact Garden documents', () => {
  assert.equal(chatMarkdownHref(`garden:ec-2/${lesson.replaceAll(' ', '%20')}.md`),
    `/garden/ec-2?note=${encodeURIComponent(lesson)}`);
  assert.equal(chatMarkdownHref('garden:ec-2/sources/lecture1-1-introduction.md'),
    '/garden/ec-2?note=sources%2Flecture1-1-introduction');
  assert.equal(chatMarkdownHref('garden://ec-2/sources/lecture1-1-introduction'),
    '/garden/ec-2?note=sources%2Flecture1-1-introduction');
});

test('tool hrefs preserve literal filenames and encode the reader query once', () => {
  const href = gardenDocumentHref('ec-2', 'Concepts/24. A & B + 50%.md');
  assert.equal(new URL(href, 'https://breadboard.test').searchParams.get('note'), 'Concepts/24. A & B + 50%');
  assert.equal(chatMarkdownHref(href), href);
});

test('Garden PDF citations keep their reader and requested page', () => {
  for (const href of ['garden:math-2/assets/book-source.pdf#page=607', '/math-2/assets/book-source.pdf#page=607']) {
    assert.equal(chatMarkdownHref(href), '/gardens/math-2/pdf/book#page=607');
  }
});

test('usable web URLs, app routes, mail, and footnotes remain navigable', () => {
  for (const href of ['https://example.com/docs', 'http://localhost:3000/page', '//example.com/docs',
    '/workflows?status=active', '/attachments/abc/document', 'mailto:a@example.com', '#user-content-fn-1']) {
    assert.equal(chatMarkdownHref(href), href);
  }
});

test('unsupported, placeholder, and malformed citations cannot create dead anchors', () => {
  for (const href of ['', '#', 'sources/book.md', 'sandbox:/mnt/data/book.pdf', 'file:///C:/book.pdf',
    'javascript:alert(1)', 'data:text/html,example', 'https://', 'garden:ec-2',
    'garden:ec-2/../secret.md', 'garden:ec-2/%2e%2e/secret.md', 'garden:ec-2/a%2fb.md',
    'garden:ec-2/%zz.md', 'garden:ec-2/.breadboard/secret.md', 'garden:ec-2/assets/unknown.pdf',
    'garden:ec-2/a.md?redirect=https://example.com', 'garden:ec-2/a%5cb.md', 'garden:ec-2/a%00.md']) {
    assert.equal(chatMarkdownHref(href), null, href);
  }
  assert.equal(gardenDocumentHref('../ec-2', 'sources/book.md'), null);
  assert.equal(gardenDocumentHref('ec-2', '../book.md'), null);
});
