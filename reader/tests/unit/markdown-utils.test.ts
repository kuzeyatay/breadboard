/**
 * Unit tests for the tidyMarkdown utility function.
 *
 * tidyMarkdown post-processes the raw markdown output from MarkifyService,
 * fixing broken links, collapsing blank lines, and stripping leading spaces.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tidyMarkdown } from '../../build/utils/markdown.js';

// ---------------------------------------------------------------------------
// Link normalisation
// ---------------------------------------------------------------------------

describe('tidyMarkdown: broken link with whitespace', () => {
    it('collapses spaces inside link text', () => {
        assert.equal(
            tidyMarkdown('[ click me ](https://example.com)'),
            '[click me](https://example.com)',
        );
    });

    it('collapses spaces inside the URL', () => {
        assert.equal(
            tidyMarkdown('[text]( https://example.com )'),
            '[text](https://example.com)',
        );
    });

    it('fixes a link broken across multiple lines', () => {
        assert.equal(
            tidyMarkdown('[\nclick\nme\n](\nhttps://example.com\n)'),
            '[click me](https://example.com)',
        );
    });

    it('does not modify a correctly formed link', () => {
        const correct = '[click](https://example.com)';
        assert.equal(tidyMarkdown(correct), correct);
    });

    it('fixes multiple broken links in the same string', () => {
        const input = '[ A ]( https://a.com ) and [ B ]( https://b.com )';
        const result = tidyMarkdown(input);
        assert.match(result, /\[A\]\(https:\/\/a\.com\)/);
        assert.match(result, /\[B\]\(https:\/\/b\.com\)/);
    });
});

describe('tidyMarkdown: link with embedded image', () => {
    it('normalises a link containing an inline image', () => {
        const input = '[ text\n![alt](img.png)\n]( https://example.com )';
        assert.equal(
            tidyMarkdown(input),
            '[text ![alt](img.png)](https://example.com)',
        );
    });
});

// ---------------------------------------------------------------------------
// Blank line normalisation
// ---------------------------------------------------------------------------

describe('tidyMarkdown: consecutive blank lines', () => {
    it('collapses three consecutive newlines to two', () => {
        assert.equal(tidyMarkdown('a\n\n\nb'), 'a\n\nb');
    });

    it('collapses four consecutive newlines to two', () => {
        assert.equal(tidyMarkdown('a\n\n\n\nb'), 'a\n\nb');
    });

    it('does not collapse two consecutive newlines', () => {
        assert.equal(tidyMarkdown('a\n\nb'), 'a\n\nb');
    });

    it('does not affect single newlines', () => {
        assert.equal(tidyMarkdown('a\nb'), 'a\nb');
    });
});

// ---------------------------------------------------------------------------
// Leading space removal
// ---------------------------------------------------------------------------

describe('tidyMarkdown: leading spaces', () => {
    it('removes leading spaces from every line', () => {
        assert.equal(tidyMarkdown('  line1\n  line2'), 'line1\nline2');
    });

    it('removes leading tabs as well', () => {
        assert.equal(tidyMarkdown('\tline1\n\tline2'), 'line1\nline2');
    });

    it('does not affect lines without leading whitespace', () => {
        assert.equal(tidyMarkdown('line1\nline2'), 'line1\nline2');
    });
});

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

describe('tidyMarkdown: trimming', () => {
    it('removes leading and trailing whitespace from the whole result', () => {
        assert.equal(tidyMarkdown('  \n\nHello\n\n  '), 'Hello');
    });

    it('returns an empty string for whitespace-only input', () => {
        assert.equal(tidyMarkdown('   \n\n   '), '');
    });
});

// ---------------------------------------------------------------------------
// Valid markdown is left unchanged
// ---------------------------------------------------------------------------

describe('tidyMarkdown: valid markdown is unchanged', () => {
    it('leaves a heading unchanged', () => {
        assert.equal(tidyMarkdown('# Heading'), '# Heading');
    });

    it('leaves a well-formed link unchanged', () => {
        assert.equal(tidyMarkdown('[text](https://example.com)'), '[text](https://example.com)');
    });

    it('leaves fenced code blocks unchanged', () => {
        const code = '```js\nconst x = 1;\n```';
        assert.equal(tidyMarkdown(code), code);
    });

    it('leaves a full markdown document intact', () => {
        const doc = '# Title\n\nSome text with [link](https://example.com).\n\n- item 1\n- item 2';
        assert.equal(tidyMarkdown(doc), doc);
    });

    it('leaves image syntax unchanged', () => {
        assert.equal(tidyMarkdown('![alt](photo.jpg)'), '![alt](photo.jpg)');
    });
});
