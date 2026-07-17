/**
 * E2E tests for the `retainLinks` crawler option.
 *
 * Modes: all | none | text | gpt-oss
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { crawl, crawlWithHeaders, getContent } from '../helpers/client';

describe('retainLinks: all (default)', () => {
    it('keeps markdown link syntax in content', async () => {
        const res = await crawl({ retainLinks: 'all', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /\[.*?\]\(https?:\/\//);
    });

    it('includes the link hrefs from the fixture', async () => {
        const res = await crawl({ retainLinks: 'all', respondWith: 'markdown' });
        const content: string = res.body.data.content;
        assert.match(content, /example\.com\/crawling|example\.org\/robots/);
    });

    it('renders crawling link with exact text and href', async () => {
        const content = getContent(await crawl({ retainLinks: 'all', respondWith: 'markdown' }));
        // fixture: <a href="https://example.com/crawling">link to crawling docs</a>
        assert.match(content, /\[link to crawling docs\]\(https:\/\/example\.com\/crawling\)/);
    });

    it('renders robots.txt link with exact text and href', async () => {
        const content = getContent(await crawl({ retainLinks: 'all', respondWith: 'markdown' }));
        // fixture: <a href="https://example.org/robots">link about robots.txt</a>
        assert.match(content, /\[link about robots\.txt\]\(https:\/\/example\.org\/robots\)/);
    });
});

describe('retainLinks: none', () => {
    it('removes hyperlinks from content', async () => {
        const res = await crawl({ retainLinks: 'none', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.doesNotMatch(content, /(?<!!)\[.*?\]\(https?:\/\//);
    });

    it('still contains non-link text content', async () => {
        const res = await crawl({ retainLinks: 'none', respondWith: 'markdown' });
        assert.match(res.body.data.content, /web crawling|fetching pages/i);
    });
});

describe('retainLinks: text', () => {
    it('replaces links with their anchor text only (no href)', async () => {
        const res = await crawl({ retainLinks: 'text', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.doesNotMatch(content, /(?<!!)\[.*?\]\(https?:\/\//);
    });

    it('preserves anchor text but strips the href', async () => {
        const content = getContent(await crawl({ retainLinks: 'text', respondWith: 'markdown' }));
        // Text should appear
        assert.ok(content.includes('link to crawling docs'), 'Anchor text missing');
        // But not as a markdown link with href
        assert.doesNotMatch(content, /\[link to crawling docs\]\(https/);
    });
});

describe('retainLinks: gpt-oss', () => {
    it('converts links to citation format', async () => {
        const res = await crawl({ retainLinks: 'gpt-oss', respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content: string = res.body.data.content;
        assert.match(content, /【\d+†/);
    });

    it('does not use standard markdown link syntax for hyperlinks', async () => {
        const res = await crawl({ retainLinks: 'gpt-oss', respondWith: 'markdown' });
        assert.doesNotMatch(res.body.data.content, /(?<!!)\[.*?\]\(https?:\/\//);
    });

    it('populates the links summary automatically', async () => {
        const res = await crawl({ retainLinks: 'gpt-oss', respondWith: 'markdown' });
        assert.notStrictEqual(res.body.data.links, undefined);
    });

    it('links summary contains the crawling docs URL', async () => {
        const res = await crawl({ retainLinks: 'gpt-oss', respondWith: 'markdown' });
        const hrefs = Object.values(res.body.data.links as Record<string, string>);
        assert.ok(
            hrefs.some((h) => h === 'https://example.com/crawling'),
            `Expected https://example.com/crawling in gpt-oss links summary: ${hrefs.join(', ')}`,
        );
    });
});

describe('retainLinks via X-Retain-Links header', () => {
    it('header overrides body param', async () => {
        const res = await crawlWithHeaders(
            { 'X-Retain-Links': 'none' },
            { respondWith: 'markdown' },
        );
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.body.data.content, /(?<!!)\[.*?\]\(https?:\/\//);
    });
});
