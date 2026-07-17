/**
 * E2E tests verifying that the HTML→markdown pipeline preserves semantic content.
 *
 * These tests use well-known text from fixtures/sample.html to assert that the
 * core conversion is correct, not merely that the server returns 200.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { crawl, getContent } from '../helpers/client';

describe('content fidelity: headings', () => {
    it('h1 becomes a level-1 ATX heading', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(getContent(res), /^# Web Crawling Guide$/m);
    });

    it('all seven h2 section headings survive extraction', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        for (const section of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']) {
            assert.ok(content.includes(`Section ${section}`), `Section ${section} missing from output`);
        }
    });
});

describe('content fidelity: inline elements', () => {
    it('bold text is wrapped with strong delimiters', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        // fixture: <strong>main content</strong>
        assert.match(content, /\*\*main content\*\*/);
    });

    it('italic text is wrapped with em delimiters', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        // fixture: <em>fetching pages</em>
        assert.match(content, /_fetching pages_|\*fetching pages\*/);
    });
});

describe('content fidelity: blockquote', () => {
    it('blockquote is formatted with > prefix', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        // fixture: <blockquote><p>The web is a graph, not a tree.</p></blockquote>
        assert.match(content, /^> .*The web is a graph, not a tree\./m);
    });
});

describe('content fidelity: code block', () => {
    it('pre/code renders as a fenced code block', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        // fixture: const crawler = new Crawler();
        assert.match(content, /```[\s\S]*?const crawler = new Crawler\(\)/);
    });

    it('code block contains both lines from the fixture', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        assert.ok(content.includes("crawler.start('https://example.com')"));
    });
});

describe('content fidelity: unordered list', () => {
    it('all three list items appear in output', async () => {
        const content = getContent(await crawl({ respondWith: 'markdown' }));
        // fixture: <ul><li>Fetch HTML pages</li>...
        assert.ok(content.includes('Fetch HTML pages'), 'Missing list item: Fetch HTML pages');
        assert.ok(content.includes('Parse links'), 'Missing list item: Parse links');
        assert.ok(content.includes('Follow links recursively'), 'Missing list item: Follow links recursively');
    });
});

describe('content fidelity: respondWith text', () => {
    it('plain text contains key article body text', async () => {
        const res = await crawl({ respondWith: 'text' });
        assert.strictEqual(res.status, 200);
        const text: string = res.body.data.text;
        assert.ok(text.includes('Web Crawling Guide'), 'Missing title text');
        assert.ok(text.includes('The web is a graph, not a tree'), 'Missing blockquote text');
    });

    it('plain text has no ATX heading syntax', async () => {
        const res = await crawl({ respondWith: 'text' });
        assert.doesNotMatch(res.body.data.text, /^#+ /m);
    });

    it('plain text has no bold markdown syntax', async () => {
        const res = await crawl({ respondWith: 'text' });
        assert.doesNotMatch(res.body.data.text, /\*\*/);
    });
});

describe('content fidelity: response metadata', () => {
    it('title field contains the HTML document title', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.ok(
            res.body.data.title.includes('Web Crawling Guide'),
            `Expected title to include 'Web Crawling Guide', got: ${res.body.data.title}`,
        );
    });

    it('url field reflects the submitted URL', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.ok(
            res.body.data.url.includes('example.com'),
            `Expected url to include 'example.com', got: ${res.body.data.url}`,
        );
    });
});
