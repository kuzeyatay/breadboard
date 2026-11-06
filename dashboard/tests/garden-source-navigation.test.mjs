import assert from 'node:assert/strict';
import test from 'node:test';
import { gardenSourcePdfViewerHref, pdfCitationPage } from '../src/lib/garden-source-navigation.ts';

test('EM1 chat citations open the Math 2 reader on the cited PDF page', () => {
  assert.equal(gardenSourcePdfViewerHref('/math-2/assets/calculus-a-complete-course-10-compress-source.pdf#page=607'),
    '/gardens/math-2/pdf/calculus-a-complete-course-10-compress#page=607');
  assert.equal(gardenSourcePdfViewerHref('/math-2/assets/book%20one-source.pdf?version=2#page=3'),
    '/gardens/math-2/pdf/book%20one?version=2#page=3');
  for (const href of ['https://example.com/math-2/assets/book-source.pdf', '//example.com/math-2/assets/book-source.pdf',
    '/math-2/assets/photo.png', '/math-2/assets/unknown.pdf', '/math-2/assets/%2e%2e-source.pdf',
    '/math-2/assets/a%2fb-source.pdf', '/math-2/assets/%zz-source.pdf', '/workflows', '#section']) {
    assert.equal(gardenSourcePdfViewerHref(href), null, href);
  }
});

test('PDF citation fragments accept only positive integer pages', () => {
  assert.equal(pdfCitationPage('#page=607'), 607);
  assert.equal(pdfCitationPage('#page=3&zoom=100'), 3);
  for (const hash of ['', '#intro', '#page=0', '#page=-1', '#page=1.5', '#page=NaN', '#page=999999999999999999']) {
    assert.equal(pdfCitationPage(hash), null, hash);
  }
});
