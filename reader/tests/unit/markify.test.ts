/**
 * Unit tests for MarkifyService — the HTML-to-markdown conversion engine.
 *
 * These tests import the compiled service and linkedom directly, so they run
 * without any HTTP server, database, or network access.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { MarkifyService } from '../../build/services/markify.js';

// linkedom is ESM; use dynamic import resolved before tests run
let parseHTML: (html: string) => { window: any };

before(async () => {
    const linkedom = await import('linkedom');
    parseHTML = linkedom.parseHTML as any;
});

// --- helpers ----------------------------------------------------------------

function parseDoc(html: string): HTMLElement {
    const { window } = parseHTML(`<html><body>${html}</body></html>`);
    return window.document.documentElement;
}

/** Create a fresh MarkifyService with fenced code and ATX headings by default. */
function mkService(opts: ConstructorParameters<typeof MarkifyService>[0] = {}): MarkifyService {
    return new MarkifyService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        fence: '```',
        gfm: true,
        ...opts,
    });
}

/** Convert an HTML string to markdown using a one-shot MarkifyService. */
function md(html: string, opts: ConstructorParameters<typeof MarkifyService>[0] = {}): string {
    return mkService(opts).markify(parseDoc(html));
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

describe('headings: ATX style (default)', () => {
    it('h1 → # heading', () => {
        assert.equal(md('<h1>Hello</h1>'), '# Hello');
    });

    it('h2 → ## heading', () => {
        assert.equal(md('<h2>Section</h2>'), '## Section');
    });

    it('h3 → ### heading', () => {
        assert.equal(md('<h3>Sub</h3>'), '### Sub');
    });

    it('h4 → #### heading', () => {
        assert.equal(md('<h4>Deep</h4>'), '#### Deep');
    });

    it('h5 → ##### heading', () => {
        assert.equal(md('<h5>Deeper</h5>'), '##### Deeper');
    });

    it('h6 → ###### heading', () => {
        assert.equal(md('<h6>Deepest</h6>'), '###### Deepest');
    });

    it('empty heading produces no output', () => {
        assert.equal(md('<h1></h1>'), '');
    });

    it('heading preserves inner text with surrounding content', () => {
        assert.equal(md('<h1>Title</h1><p>body</p>'), '# Title\n\nbody');
    });
});

describe('headings: setext style', () => {
    it('h1 → underlined with = signs', () => {
        assert.equal(md('<h1>Top</h1>', { headingStyle: 'setext' }), 'Top\n===');
    });

    it('h2 → underlined with - signs (underline length matches text)', () => {
        assert.equal(md('<h2>Sub Two</h2>', { headingStyle: 'setext' }), 'Sub Two\n-------');
    });

    it('h3 falls back to ATX even with setext option', () => {
        assert.equal(md('<h3>Section</h3>', { headingStyle: 'setext' }), '### Section');
    });

    it('h4 falls back to ATX even with setext option', () => {
        assert.equal(md('<h4>Sub</h4>', { headingStyle: 'setext' }), '#### Sub');
    });
});

// ---------------------------------------------------------------------------
// Inline formatting
// ---------------------------------------------------------------------------

describe('strong/bold', () => {
    it('wraps content with ** by default', () => {
        assert.equal(md('<strong>bold</strong>'), '**bold**');
    });

    it('wraps content with __ when strongDelimiter is __', () => {
        assert.equal(md('<strong>bold</strong>', { strongDelimiter: '__' }), '__bold__');
    });

    it('<b> is treated the same as <strong>', () => {
        assert.equal(md('<b>bold</b>'), '**bold**');
    });

    it('empty strong produces no output', () => {
        assert.equal(md('<strong></strong>'), '');
    });
});

describe('emphasis/italic', () => {
    it('wraps content with _ by default', () => {
        assert.equal(md('<em>italic</em>'), '_italic_');
    });

    it('wraps content with * when emDelimiter is *', () => {
        assert.equal(md('<em>italic</em>', { emDelimiter: '*' }), '*italic*');
    });

    it('<i> is treated the same as <em>', () => {
        assert.equal(md('<i>italic</i>'), '_italic_');
    });

    it('underscores inside em text are escaped as \\_', () => {
        assert.equal(md('<em>hello_world</em>'), '_hello\\_world_');
    });

    it('empty em produces no output', () => {
        assert.equal(md('<em></em>'), '');
    });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('links: inlined style (default)', () => {
    it('renders [text](url) for a basic link', () => {
        assert.equal(md('<a href="https://example.com">click</a>'), '[click](https://example.com)');
    });

    it('includes title attribute as "title" suffix', () => {
        assert.equal(
            md('<a href="https://x.com" title="Site">click</a>'),
            '[click](https://x.com "Site")',
        );
    });

    it('link with no href produces [text]() and does NOT add to links array', () => {
        const svc = mkService();
        const result = svc.markify(parseDoc('<a>anchor</a>'));
        assert.equal(result, '[anchor]()');
        assert.equal(svc.links.length, 0);
    });

    it('link with empty href produces [text]() and does NOT add to links array', () => {
        const svc = mkService();
        svc.markify(parseDoc('<a href="">empty</a>'));
        assert.equal(svc.links.length, 0);
    });

    it('resolves relative path against baseUrl', () => {
        assert.equal(
            md('<a href="/page">page</a>', { baseUrl: 'https://example.com/test' }),
            '[page](https://example.com/page)',
        );
    });

    it('ignores blob: baseUrl — relative URLs stay as-is', () => {
        assert.equal(
            md('<a href="/page">page</a>', { baseUrl: 'blob:https://example.com/abc' }),
            '[page](/page)',
        );
    });

    it('populates .links array with href, text, ref, and title', () => {
        const svc = mkService();
        svc.markify(parseDoc('<a href="https://a.com" title="A">Alpha</a>'));
        assert.equal(svc.links.length, 1);
        assert.equal(svc.links[0].href, 'https://a.com');
        assert.equal(svc.links[0].text, 'Alpha');
        assert.equal(svc.links[0].ref, 1);
        assert.equal(svc.links[0].title, 'A');
    });

    it('assigns incremental ref numbers to multiple links', () => {
        const svc = mkService();
        svc.markify(parseDoc('<a href="https://a.com">A</a> <a href="https://b.com">B</a>'));
        assert.equal(svc.links.length, 2);
        assert.equal(svc.links[0].ref, 1);
        assert.equal(svc.links[1].ref, 2);
    });
});

describe('links: discarded style', () => {
    it('renders only the link text, omitting the URL', () => {
        assert.equal(
            md('<a href="https://x.com">click here</a>', { linkStyle: 'discarded' }),
            'click here',
        );
    });
});

describe('links: referenced style', () => {
    it('full: renders [text][N] and appends numbered link definitions', () => {
        const svc = mkService({ linkStyle: 'referenced', linkReferenceStyle: 'full' });
        assert.equal(
            svc.markify(parseDoc('<a href="https://x.com">Click</a>')),
            '[Click][1]\n\n[1]: https://x.com',
        );
    });

    it('collapsed: renders [text][] and appends [text]: URL definitions', () => {
        const svc = mkService({ linkStyle: 'referenced', linkReferenceStyle: 'collapsed' });
        assert.equal(
            svc.markify(parseDoc('<a href="https://x.com">Click</a>')),
            '[Click][]\n\n[Click]: https://x.com',
        );
    });

    it('shortcut: renders [text] and appends [text]: URL definitions', () => {
        const svc = mkService({ linkStyle: 'referenced', linkReferenceStyle: 'shortcut' });
        assert.equal(
            svc.markify(parseDoc('<a href="https://x.com">Click</a>')),
            '[Click]\n\n[Click]: https://x.com',
        );
    });
});

describe('links', () => {
    it('returns href, text, and ref for each collected link', () => {
        const svc = mkService();
        svc.markify(parseDoc('<a href="https://a.com">Alpha</a>'));
        const links = svc.links;
        assert.equal(links.length, 1);
        assert.equal(links[0].href, 'https://a.com');
        assert.equal(links[0].text, 'Alpha');
        assert.equal(links[0].ref, 1);
    });
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe('images', () => {
    it('renders ![alt](src) for an image with alt text', () => {
        assert.equal(md('<img src="img.png" alt="a photo">'), '![a photo](img.png)');
    });

    it('renders ![](src) when alt attribute is absent', () => {
        assert.equal(md('<img src="img.png">'), '![](img.png)');
    });

    it('renders ![](src) when alt is an empty string', () => {
        assert.equal(md('<img src="img.png" alt="">'), '![](img.png)');
    });

    it('appends title after the URL', () => {
        assert.equal(
            md('<img src="x.png" alt="desc" title="My Title">'),
            '![desc](x.png "My Title")',
        );
    });

    it('populates .images array with src, alt, and ref', () => {
        const svc = mkService();
        svc.markify(parseDoc('<img src="a.png" alt="A"><img src="b.png" alt="B">'));
        assert.equal(svc.images.length, 2);
        assert.deepEqual(svc.images[0], { src: 'a.png', alt: 'A', ref: 1 });
        assert.deepEqual(svc.images[1], { src: 'b.png', alt: 'B', ref: 2 });
    });

    it('assigns incremental ref numbers', () => {
        const svc = mkService();
        svc.markify(parseDoc('<img src="1.png" alt="one"><img src="2.png" alt="two"><img src="3.png" alt="three">'));
        assert.equal(svc.images[0].ref, 1);
        assert.equal(svc.images[1].ref, 2);
        assert.equal(svc.images[2].ref, 3);
    });
});

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

describe('code: inline', () => {
    it('single-line code without a language class renders as inline `code`', () => {
        assert.equal(md('<code>const x = 1</code>'), '`const x = 1`');
    });

    it('trims surrounding whitespace inside inline code', () => {
        assert.equal(md('<code>  trimmed  </code>'), '`trimmed`');
    });
});

describe('code: fenced block', () => {
    it('<pre><code> with multiple lines renders as fenced block', () => {
        assert.equal(
            md('<pre><code>line1\nline2</code></pre>'),
            '```\nline1\nline2\n```',
        );
    });

    it('language-js class adds js hint to the opening fence', () => {
        assert.equal(
            md('<pre><code class="language-js">const x = 1\nconst y = 2</code></pre>'),
            '```js\nconst x = 1\nconst y = 2\n```',
        );
    });

    it('lang-python class adds python hint to the opening fence', () => {
        assert.equal(
            md('<pre><code class="lang-python">x = 1\ny = 2</code></pre>'),
            '```python\nx = 1\ny = 2\n```',
        );
    });

    it('trims leading/trailing whitespace from the outer code block content', () => {
        // code.trim() strips outer whitespace; internal indentation is preserved
        const result = md('<pre><code>  line1\n  line2  </code></pre>');
        assert.match(result, /^```\nline1/m);
    });
});

describe('code: indented block', () => {
    it('multiline code with preceding paragraph uses 4-space indentation', () => {
        const result = md(
            '<p>intro</p><pre><code>line1\nline2</code></pre>',
            { codeBlockStyle: 'indented' },
        );
        assert.equal(result, 'intro\n\n    line1\n    line2');
    });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe('unordered lists', () => {
    it('uses * as default bullet marker (with 3 trailing spaces)', () => {
        const result = md('<ul><li>Item A</li><li>Item B</li></ul>');
        assert.match(result, /^\*   Item A$/m);
        assert.match(result, /^\*   Item B$/m);
    });

    it('uses - as bullet marker when bulletListMarker is -', () => {
        const result = md('<ul><li>X</li></ul>', { bulletListMarker: '-' });
        assert.match(result, /^-   X$/m);
    });

    it('uses + as bullet marker when bulletListMarker is +', () => {
        const result = md('<ul><li>X</li></ul>', { bulletListMarker: '+' });
        assert.match(result, /^\+   X$/m);
    });

    it('renders all list items', () => {
        const result = md('<ul><li>a</li><li>b</li><li>c</li></ul>');
        assert.ok(result.includes('a') && result.includes('b') && result.includes('c'));
    });

    it('nested list indents the child by 4 spaces', () => {
        assert.equal(
            md('<ul><li>Top<ul><li>Sub</li></ul></li></ul>'),
            '*   Top\n    *   Sub',
        );
    });
});

describe('ordered lists', () => {
    it('numbers items starting at 1', () => {
        const result = md('<ol><li>First</li><li>Second</li><li>Third</li></ol>');
        assert.match(result, /^1\.   First$/m);
        assert.match(result, /^2\.   Second$/m);
        assert.match(result, /^3\.   Third$/m);
    });

    it('nested ordered list indents child by 4 spaces', () => {
        assert.equal(
            md('<ol><li>a<ol><li>b</li></ol></li></ol>'),
            '1.   a\n    1.   b',
        );
    });
});

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

describe('blockquotes', () => {
    it('single-paragraph blockquote becomes > prefixed line', () => {
        assert.equal(md('<blockquote><p>quoted text</p></blockquote>'), '> quoted text');
    });

    it('multi-paragraph blockquote prefixes each line with >', () => {
        const result = md('<blockquote><p>line one</p><p>line two</p></blockquote>');
        assert.match(result, /^> line one/m);
        assert.match(result, /^> line two/m);
    });
});

// ---------------------------------------------------------------------------
// Horizontal rule
// ---------------------------------------------------------------------------

describe('horizontal rule', () => {
    it('renders * * * by default', () => {
        assert.equal(md('<hr>'), '* * *');
    });

    it('renders the custom hr string ---', () => {
        assert.equal(md('<hr>', { hr: '---' }), '---');
    });

    it('renders the custom hr string ***', () => {
        assert.equal(md('<hr>', { hr: '***' }), '***');
    });
});

// ---------------------------------------------------------------------------
// Tables (GFM)
// ---------------------------------------------------------------------------

describe('tables (requires gfm: true)', () => {
    it('renders header, separator, and data rows with pipe syntax', () => {
        const html = `<table>
            <thead><tr><th>Name</th><th>Age</th></tr></thead>
            <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
        </table>`;
        const result = md(html);
        assert.match(result, /\| Name \| Age \|/);
        assert.match(result, /\| --- \| --- \|/);
        assert.match(result, /\| Alice \| 30 \|/);
    });

    it('header row appears before separator, which appears before data', () => {
        const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
        const result = md(html);
        const lines = result.split('\n').filter(Boolean);
        const headerIdx = lines.findIndex((l) => l.includes('| A |'));
        const sepIdx = lines.findIndex((l) => l.includes('| --- |'));
        const cellIdx = lines.findIndex((l) => l.includes('| 1 |'));
        assert.ok(headerIdx < sepIdx, 'header should precede separator');
        assert.ok(sepIdx < cellIdx, 'separator should precede data');
    });

    it('table without gfm is NOT rendered as markdown table', () => {
        const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
        const result = md(html, { gfm: false });
        assert.doesNotMatch(result, /\| A \|/);
    });
});

// ---------------------------------------------------------------------------
// GFM: strikethrough
// ---------------------------------------------------------------------------

describe('strikethrough (requires gfm: true)', () => {
    it('<del> wraps text with ~~', () => {
        assert.equal(md('<del>gone</del>'), '~~gone~~');
    });

    it('<s> wraps text with ~~', () => {
        assert.equal(md('<s>strikethrough</s>'), '~~strikethrough~~');
    });

    it('<strike> wraps text with ~~', () => {
        assert.equal(md('<strike>old</strike>'), '~~old~~');
    });

    it('empty del produces no output', () => {
        assert.equal(md('<del></del>'), '');
    });
});

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------

describe('addRule', () => {
    it('replaces the default handler output for the matched tag', () => {
        const svc = mkService();
        svc.addRule('highlight', {
            filter: 'mark',
            replacement: (content) => `==${content}==`,
        });
        const result = svc.markify(parseDoc('<p>Hello <mark>world</mark>!</p>'));
        assert.match(result, /==world==/);
    });

    it('applies multiple rules on the same tag in registration order', () => {
        const svc = mkService();
        // rule-b receives the output of rule-a
        svc.addRule('rule-a', { filter: 'mark', replacement: (c) => `[A:${c}]` });
        svc.addRule('rule-b', { filter: 'mark', replacement: (c) => `[B:${c}]` });
        const result = svc.markify(parseDoc('<mark>x</mark>'));
        assert.match(result, /\[B:\[A:x\]\]/);
    });
});

describe('keep', () => {
    it('preserves a kept tag as raw HTML outerHTML', () => {
        const svc = mkService();
        svc.keep('mark');
        const result = svc.markify(parseDoc('<p>Hello <mark>world</mark></p>'));
        assert.match(result, /<mark>world<\/mark>/);
    });

    it('inner content of a kept tag is not processed as markdown', () => {
        const svc = mkService();
        svc.keep('aside');
        const result = svc.markify(parseDoc('<aside><h1>Skipped heading</h1></aside>'));
        assert.doesNotMatch(result, /^# Skipped heading/m);
        assert.match(result, /<aside>/);
    });
});

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

describe('state management', () => {
    it('fresh instance has empty links and images arrays', () => {
        const svc = mkService();
        assert.equal(svc.links.length, 0);
        assert.equal(svc.images.length, 0);
    });

    it('links array is populated after markify() is called', () => {
        const svc = mkService();
        svc.markify(parseDoc('<a href="https://a.com">A</a>'));
        assert.equal(svc.links.length, 1);
    });

    it('images array is populated after markify() is called', () => {
        const svc = mkService();
        svc.markify(parseDoc('<img src="photo.jpg" alt="photo">'));
        assert.equal(svc.images.length, 1);
    });

    it('two separate instances have fully independent state', () => {
        const svc1 = mkService();
        const svc2 = mkService();
        svc1.markify(parseDoc('<a href="https://a.com">A</a>'));
        assert.equal(svc2.links.length, 0);
    });
});

// ---------------------------------------------------------------------------
// Mixed content
// ---------------------------------------------------------------------------

describe('mixed content', () => {
    it('paragraph with bold and italic renders both', () => {
        const result = md('<p>This is <strong>bold</strong> and <em>italic</em>.</p>');
        assert.match(result, /\*\*bold\*\*/);
        assert.match(result, /_italic_/);
    });

    it('h2 followed by paragraph has blank line between them', () => {
        assert.equal(md('<h2>Section</h2><p>Content here.</p>'), '## Section\n\nContent here.');
    });

    it('link inside a heading is kept inline', () => {
        const result = md('<h2><a href="https://x.com">Linked Heading</a></h2>');
        assert.match(result, /## \[Linked Heading\]\(https:\/\/x\.com\)/);
    });

    it('image inside a paragraph is inlined with surrounding text', () => {
        const result = md('<p>See <img src="chart.png" alt="chart"> here.</p>');
        assert.match(result, /!\[chart\]\(chart\.png\)/);
    });

    it('script, style, and meta elements are skipped entirely', () => {
        const result = md('<script>alert(1)</script><meta name="x"><style>body{}</style><p>visible</p>');
        assert.doesNotMatch(result, /alert|body\{\}/);
        assert.match(result, /visible/);
    });

    it('full article structure: heading, paragraph, list, blockquote', () => {
        const html = `
            <h1>Guide</h1>
            <p>Introduction to the <strong>topic</strong>.</p>
            <ul><li>Step one</li><li>Step two</li></ul>
            <blockquote><p>A wise quote.</p></blockquote>
        `;
        const result = md(html);
        assert.match(result, /^# Guide$/m);
        assert.match(result, /\*\*topic\*\*/);
        assert.match(result, /Step one/);
        assert.match(result, /Step two/);
        assert.match(result, /^> A wise quote\./m);
    });
});
