import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ANYDOC_PARSE_FILE_RE,
  anydocFormatForExtension,
  anydocPageLabel,
} from '../src/lib/anydoc/formats.ts';
import {
  anydocSectionPlainText,
  sanitizeAnydocMarkdown,
} from '../src/lib/anydoc/sanitize.ts';
import { convertWithAnydoc, splitAnydocSections } from '../src/lib/anydoc/convert.ts';

// The clone the bindings were built from. Its test corpus is the only set of
// documents in the repo that exercises every format anydoc claims.
const FIXTURES = new URL('../../anydoc/tests/fixtures/', import.meta.url);
const fixture = (relativePath) => fs.readFileSync(new URL(relativePath, FIXTURES));
const haveFixtures = fs.existsSync(FIXTURES);

// ── Formats ─────────────────────────────────────────────────────────────────

test('container variants collapse onto the format their parser is named after', () => {
  assert.equal(anydocFormatForExtension('docm'), 'docx');
  assert.equal(anydocFormatForExtension('.PPSX'), 'pptx');
  assert.equal(anydocFormatForExtension('xls'), 'xlsx');
  assert.equal(anydocFormatForExtension('pot'), 'ppt');
  assert.equal(anydocFormatForExtension('png'), null);
  assert.equal(anydocFormatForExtension(''), null);
});

test('the file filter accepts what anydoc converts and nothing else', () => {
  for (const name of ['report.docx', 'deck.PPTX', 'book.epub', 'paper.pdf', 'rows.csv']) {
    assert.ok(ANYDOC_PARSE_FILE_RE.test(name), name);
  }
  for (const name of ['scan.png', 'notes.md', 'archive.zip', 'docx']) {
    assert.ok(!ANYDOC_PARSE_FILE_RE.test(name), name);
  }
});

test('every format has a section label', () => {
  for (const ext of ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'xlsx', 'ods', 'csv', 'epub', 'pdf']) {
    const format = anydocFormatForExtension(ext);
    assert.ok(format, ext);
    assert.ok(anydocPageLabel(format).length > 0, ext);
  }
});

// ── Sanitizing ──────────────────────────────────────────────────────────────

test('anchor markers are dropped but links to headings survive', () => {
  const markdown = sanitizeAnydocMarkdown(
    '<a id="epub-ch002-markpoint"></a>This paragraph carries an anchor.\n\nBack to [Chapter One](#chapter-one).',
  );
  assert.doesNotMatch(markdown, /<a id=/);
  assert.match(markdown, /^This paragraph carries an anchor\./);
  assert.match(markdown, /\[Chapter One\]\(#chapter-one\)/);
});

test('a raw angle bracket is shown, not handed to a renderer as a tag', () => {
  // anydoc escapes the ones that look like tag openings; the backslash must not
  // survive into the page beside the character reference.
  const markdown = sanitizeAnydocMarkdown('Use \\<div> for a block, and a < b.');
  assert.match(markdown, /Use &lt;div> for a block, and a &lt; b\./);
  assert.doesNotMatch(markdown, /\\&lt;/);
});

test('Obsidian syntax Quartz would eat is neutralized', () => {
  // Quartz strips %%…%% and everything between it from the raw source.
  const markdown = sanitizeAnydocMarkdown('Margin was 20%% up, see [[Q3]] notes.');
  assert.doesNotMatch(markdown, /%%/);
  assert.doesNotMatch(markdown, /\[\[/);
  assert.match(markdown, /20%&#37; up/);
});

test('a dollar amount is left alone rather than read as a formula', () => {
  // The regression this module exists to avoid: the VLM markdown pass would
  // read "$50 and $" as one inline formula and demote the sentence to code.
  const markdown = sanitizeAnydocMarkdown('The seat costs $50 and the table $75.');
  assert.equal(markdown, 'The seat costs $50 and the table $75.');
});

test('code blocks are literal text and are never rewritten', () => {
  const markdown = sanitizeAnydocMarkdown(
    'Before.\n\n```html\n<div class="x">%%kept%%</div>\n```\n\nAfter.',
  );
  assert.match(markdown, /<div class="x">%%kept%%<\/div>/);
  assert.match(markdown, /Before\./);
});

test('plain text keeps table rows and list items, drops only decoration', () => {
  const text = anydocSectionPlainText(
    '## Totals\n\n| Region | Total |\n| --- | --- |\n| North | 42 |\n\n- **Plan** the [work](https://example.com)\n',
  );
  assert.match(text, /^Totals/);
  assert.match(text, /\| North \| 42 \|/);
  assert.match(text, /- Plan the work/);
});

// ── Sections ────────────────────────────────────────────────────────────────

test('a conversion splits at its shallowest heading level', () => {
  const sections = splitAnydocSections(
    '# Book\n\nFront matter.\n\n## Chapter One\n\nAlpha.\n\n### Detail\n\nBeta.\n\n## Chapter Two\n\nGamma.',
    'Book',
  );
  // `#` is the shallowest, so the whole document is one section, not three.
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Book'],
  );
  assert.match(sections[0].text, /Gamma\./);
});

test('sheets and chapters each become their own citable section', () => {
  const sections = splitAnydocSections(
    'Preamble line.\n\n## Values\n\n| a | b |\n\n## Merged Grid\n\n| c | d |',
    'Spreadsheet',
  );
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Spreadsheet', 'Values', 'Merged Grid'],
  );
  assert.match(sections[1].text, /\| a \| b \|/);
});

test('repeated headings stay tellable apart', () => {
  const sections = splitAnydocSections(
    '## Sheet1\n\nfirst\n\n## Sheet1\n\nsecond',
    'Spreadsheet',
  );
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Sheet1', 'Sheet1 (2)'],
  );
});

test('a heading inside a code fence does not split anything', () => {
  const sections = splitAnydocSections(
    'Intro.\n\n```\n## not a heading\n```\n\nOutro.',
    'Word Document',
  );
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Word Document'],
  );
});

test('a document with no headings is one section named for its format', () => {
  const sections = splitAnydocSections('Just prose.', 'Presentation');
  assert.deepEqual(sections, [{ label: 'Presentation', text: 'Just prose.' }]);
});

test('an empty conversion produces no sections at all', () => {
  assert.deepEqual(splitAnydocSections('   \n\n  ', 'Word Document'), []);
});

// ── The real converter ──────────────────────────────────────────────────────

test('a Word table survives as a table, which the old extractor destroyed', { skip: !haveFixtures }, async () => {
  const conversion = await convertWithAnydoc({
    bytes: fixture('docx/handmade-rich.docx'),
    ext: 'docx',
  });
  assert.equal(conversion.format, 'docx');
  assert.match(conversion.markdown, /\| Quarter \| Widgets \|/);
  assert.match(conversion.markdown, /\| Q1 \| 10 \|/);
  assert.match(conversion.markdown, /- Plan/);
});

test('a spreadsheet becomes one section per sheet', { skip: !haveFixtures }, async () => {
  const conversion = await convertWithAnydoc({
    bytes: fixture('xlsx/sheet.xlsx'),
    ext: 'xlsx',
  });
  assert.ok(conversion.sections.length >= 2, 'expected a section per sheet');
  assert.deepEqual(
    conversion.sections.map((section) => section.label),
    ['Values', 'Merged Grid'],
  );
});

test('an EPUB keeps its chapters and loses its anchor markers', { skip: !haveFixtures }, async () => {
  const conversion = await convertWithAnydoc({
    bytes: fixture('epub/book.epub'),
    ext: 'epub',
  });
  assert.doesNotMatch(conversion.markdown, /<a id=/);
  assert.match(conversion.markdown, /\| Bolts \| 12 \|/);
});

test('embedded images are written out and listed under the text', { skip: !haveFixtures }, async () => {
  const saved = [];
  const conversion = await convertWithAnydoc({
    bytes: fixture('docx/handmade-rich.docx'),
    ext: 'docx',
    saveImage: ({ index, mediaType, data }) => {
      saved.push({ index, mediaType, bytes: data.length });
      return `/garden/assets/image-${index}.png`;
    },
  });
  assert.equal(saved.length, 1);
  assert.match(saved[0].mediaType, /^image\//);
  assert.ok(saved[0].bytes > 0);
  // Only the images: the .docx also carries an embedded Excel OLE payload.
  assert.deepEqual(conversion.imagePaths, ['/garden/assets/image-1.png']);
  assert.match(conversion.markdown, /## Embedded images/);
  // The gallery is a heading the document never had, so it must not become a
  // citable section of nothing but alt text.
  assert.ok(
    !conversion.sections.some((section) => section.label === 'Embedded images'),
    'the image gallery must not become its own section',
  );
});

test('the format is read from the content, not from a lying extension', { skip: !haveFixtures }, async () => {
  const conversion = await convertWithAnydoc({
    bytes: fixture('xlsx/sheet.xlsx'),
    ext: 'docx',
  });
  assert.equal(conversion.format, 'xlsx');
});

test('a signature-less format is named by its extension', { skip: !haveFixtures }, async () => {
  const conversion = await convertWithAnydoc({
    bytes: Buffer.from('name,qty\nBolts,12\n'),
    ext: 'csv',
  });
  assert.equal(conversion.format, 'csv');
  assert.match(conversion.markdown, /\| Bolts \| 12 \|/);
});

test('a file anydoc cannot read fails with a code and a way forward', async () => {
  await assert.rejects(
    convertWithAnydoc({ bytes: Buffer.from('not a document at all'), ext: 'docx' }),
    (error) => {
      assert.equal(error.name, 'AnydocConvertError');
      assert.ok(['unsupported', 'malformed', 'missingPart'].includes(error.code), error.code);
      return true;
    },
  );
});
