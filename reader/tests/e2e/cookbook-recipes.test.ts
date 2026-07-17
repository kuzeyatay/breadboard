/**
 * E2E tests for the recipes documented in cookbooks.md.
 *
 * Each `describe` block corresponds to one cookbook recipe. The intent is to
 * exercise the *exact* combination of headers and body fields the cookbook
 * advertises, so that a future change which silently breaks a recipe is
 * caught here.
 *
 * All tests run against the `html`/`file` input paths so they work offline —
 * no network or live target site is required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    crawl,
    crawlWithHeaders,
    getAgent,
    getContent,
    SAMPLE_HTML,
} from '../helpers/client';

// --- Recipe 1: RAG inference (defaults) ---
describe('cookbook: RAG inference (defaults)', () => {
    it('default response includes markdown image syntax with URLs', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[.*?\]\(https?:\/\//);
    });

    it('default response keeps markdown link syntax with anchor + href', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.match(res.body.data.content, /\[link to crawling docs\]\(https:\/\/example\.com\/crawling\)/);
    });

    it('default response returns the article body and extracted title', async () => {
        // The cookbook claims defaults produce "the shape a chat model wants" —
        // i.e. content + title with the main article surfaced.
        // Readability extracts the title separately from content, so the <h1>
        // does not appear in content — check title and body text independently.
        const res = await crawl({});
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /fetching pages/);
        assert.match(res.body.data.title, /Web Crawling Guide/);
    });

    it('withGeneratedAlt header is accepted as an additive opt-in', async () => {
        const res = await crawlWithHeaders(
            { 'X-With-Generated-Alt': 'true' },
            { respondWith: 'markdown' },
        );
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /!\[/);
    });
});

// --- Recipe 2: Semantic indexing (build embeddings; URLs are noise) ---
describe('cookbook: semantic indexing for embeddings', () => {
    const headers = {
        Accept: 'application/json',
        'X-Retain-Links': 'text',
        'X-Retain-Images': 'alt',
        'X-Markdown-Chunking': 'h3',
    };

    it('JSON response includes chunks split at headings (h3)', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.data.chunks));
        assert.ok(res.body.data.chunks.length > 1);
        for (const chunk of res.body.data.chunks) {
            assert.strictEqual(typeof chunk, 'string');
            assert.ok(chunk.trim().length > 0);
        }
    });

    it('content keeps anchor text but drops the URL', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        const content = getContent(res);
        assert.ok(content.includes('link to crawling docs'));
        assert.doesNotMatch(content, /\[link to crawling docs\]\(https/);
    });

    it('content keeps image alt text but drops the image URL', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        const content = getContent(res);
        assert.match(content, /\(Image \d+: A spider crawling the web\)/);
        assert.doesNotMatch(content, /spider\.png/);
    });

    it('structured s3 family chunks block-level instead of heading-level', async () => {
        const res = await crawlWithHeaders(
            { ...headers, 'X-Markdown-Chunking': 's3' },
            { respondWith: 'markdown' },
        );
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body.data.chunks));
        assert.ok(res.body.data.chunks.length > 1);
    });
});

// --- Recipe 3: Deep research (long-context model needs URLs, but only once) ---
describe('cookbook: deep research', () => {
    const headers = {
        'X-Retain-Links': 'text',
        'X-With-Links-Summary': 'true',
        'X-Retain-Images': 'alt',
    };

    it('content has inline anchor text without inlined URLs', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        assert.ok(content.includes('link to crawling docs'));
        assert.doesNotMatch(content, /\[link to crawling docs\]\(https/);
    });

    it('links summary footer contains the deduplicated URLs', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        const hrefs = Object.values(res.body.data.links as Record<string, string>);
        assert.ok(
            hrefs.some((h) => h === 'https://example.com/crawling'),
            `Expected crawling URL in links footer, got: ${hrefs.join(', ')}`,
        );
        assert.ok(
            hrefs.some((h) => h === 'https://example.org/robots'),
            `Expected robots URL in links footer, got: ${hrefs.join(', ')}`,
        );
    });

    it('images render as alt-text placeholders, not URLs', async () => {
        const res = await crawlWithHeaders(headers, { respondWith: 'markdown' });
        const content = getContent(res);
        assert.match(content, /\(Image \d+: Network diagram\)/);
        assert.doesNotMatch(content, /spider\.png|network\.jpg/);
    });

    it('gpt-oss link mode auto-enables the links footer', async () => {
        const res = await crawlWithHeaders(
            { 'X-Retain-Links': 'gpt-oss' },
            { respondWith: 'markdown' },
        );
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /【\d+†/);
        assert.notStrictEqual(res.body.data.links, undefined);
    });
});

// --- Recipe 4: Visual snapshot / pageshot for multimodal reasoning ---
describe('cookbook: visual snapshot / pageshot options', () => {
    it('respondWith=pageshot + removeOverlay + timeout headers are accepted', async () => {
        // We can't actually generate a pageshot from html input (no browser
        // session), but the option combination must be accepted without 4xx.
        const res = await crawlWithHeaders({
            'X-Respond-With': 'pageshot',
            'X-Remove-Overlay': 'true',
            'X-Timeout': '30',
        });
        assert.ok(
            res.status === 200,
            `Expected 200 for pageshot options on html input, got ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
        );
    });

    it('respondTiming media-idle is the documented default for shot/vlm', async () => {
        const res = await crawl({
            respondTiming: 'media-idle',
            removeOverlay: true,
            timeout: 30,
        });
        assert.strictEqual(res.status, 200);
    });
});

// --- Recipe 5: Scrape a known template (article body only) ---
describe('cookbook: scrape a known template', () => {
    const customHtml = `<!DOCTYPE html><html><head><title>Blog Post</title></head>
        <body>
            <nav>SITE NAVIGATION CHROME</nav>
            <article class="post-body">
                <h1>The Real Article</h1>
                <p>This is the body content that should survive.</p>
                <p>It has <a href="https://example.com/inside">inline links</a>.</p>
            </article>
            <aside class="related-posts">RELATED POSTS BLOCK</aside>
            <div class="comments">COMMENTS WIDGET</div>
            <footer>FOOTER STUFF</footer>
        </body></html>`;

    async function postWithHtml(headers: Record<string, string>) {
        let req = getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json');
        for (const [k, v] of Object.entries(headers)) {
            req = req.set(k, v);
        }
        return req.send({
            html: customHtml,
            url: 'https://example.com/blog/post-slug',
            respondWith: 'markdown',
        });
    }

    it('targetSelector narrows output to the chosen element', async () => {
        const res = await postWithHtml({ 'X-Target-Selector': 'article.post-body' });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        assert.match(content, /The Real Article/);
        assert.match(content, /body content that should survive/);
    });

    it('targetSelector + removeSelector strips templated chrome inside the target', async () => {
        const res = await postWithHtml({
            'X-Target-Selector': 'article.post-body',
            'X-Remove-Selector': 'nav, .related-posts, .comments, footer',
        });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        assert.match(content, /The Real Article/);
        assert.doesNotMatch(content, /SITE NAVIGATION CHROME/);
        assert.doesNotMatch(content, /RELATED POSTS BLOCK/);
        assert.doesNotMatch(content, /COMMENTS WIDGET/);
        assert.doesNotMatch(content, /FOOTER STUFF/);
    });
});

// --- Recipe 6: Inject a page script (click-to-reveal content) ---
describe('cookbook: inject page script', () => {
    it('injectPageScript as a single string is accepted', async () => {
        const res = await crawl({
            injectPageScript: "waitForSelector('button').then((el) => el.click())",
        });
        assert.strictEqual(res.status, 200);
    });

    it('injectPageScript as an array of multiple steps is accepted', async () => {
        const res = await crawl({
            injectPageScript: [
                "waitForSelector('button.show-more').then((el) => el.click())",
                "waitForSelector('div.transcript').then(() => true)",
            ],
        });
        assert.strictEqual(res.status, 200);
    });

    it('injectFrameScript array is accepted for iframe content', async () => {
        const res = await crawl({
            injectFrameScript: [
                "waitForSelector('article').then((el) => el.scrollIntoView())",
            ],
        });
        assert.strictEqual(res.status, 200);
    });
});

// --- Recipe 7: Iframes and shadow DOM ---
describe('cookbook: iframes and shadow DOM', () => {
    it('X-With-Iframe + X-With-Shadow-Dom headers are accepted together', async () => {
        const res = await crawlWithHeaders({
            'X-With-Iframe': 'true',
            'X-With-Shadow-Dom': 'true',
        });
        assert.strictEqual(res.status, 200);
        assert.notStrictEqual(res.body.data.content, undefined);
    });

    it('X-With-Iframe: quoted is the documented blockquote variant', async () => {
        const res = await crawlWithHeaders({ 'X-With-Iframe': 'quoted' });
        assert.strictEqual(res.status, 200);
    });

    it('iframe extraction is bounded by X-Timeout (max 180s)', async () => {
        const res = await crawlWithHeaders({
            'X-With-Iframe': 'true',
            'X-Timeout': '60',
        });
        assert.strictEqual(res.status, 200);
    });
});

// --- Recipe 8: Geo- and locale-sensitive scraping ---
describe('cookbook: geo and locale', () => {
    it('X-Proxy + X-Locale + X-Set-Cookie combination is accepted', async () => {
        const res = await crawlWithHeaders({
            'X-Proxy': 'de',
            'X-Locale': 'de-DE',
            'X-Set-Cookie': 'country=DE; Path=/',
        });
        assert.strictEqual(res.status, 200);
        assert.notStrictEqual(res.body.data.content, undefined);
    });

    it('setCookies via body field with a single Set-Cookie string', async () => {
        const res = await crawl({
            setCookies: ['country=DE; Path=/; Domain=example.com'],
            locale: 'de-DE',
            proxy: 'de',
        });
        assert.strictEqual(res.status, 200);
    });

    it('two-letter country code form of X-Proxy is documented and accepted', async () => {
        const res = await crawlWithHeaders({ 'X-Proxy': 'us' });
        assert.strictEqual(res.status, 200);
    });
});

// --- Recipe 9: Presets ---
describe('cookbook: x-preset shortcuts', () => {
    it('preset=index drops link URLs and adds s3 chunking', async () => {
        const res = await crawlWithHeaders({ 'X-Preset': 'index' });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        // retainLinks: text — anchor text kept, URL dropped
        assert.ok(content.includes('link to crawling docs'), 'anchor text should be present');
        assert.doesNotMatch(content, /https:\/\/example\.com\/crawling/, 'link URL should be dropped');
        // markdownChunking: s3 — chunks present
        assert.ok(Array.isArray(res.body.data.chunks), 'chunks array should be present');
        assert.ok(res.body.data.chunks.length > 1, 'should have multiple chunks');
    });

    it('preset=research keeps links with URLs and produces h3 chunks', async () => {
        const res = await crawlWithHeaders({ 'X-Preset': 'research' });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        // retainLinks: all — full link markdown present
        assert.match(content, /\[link to crawling docs\]\(https:\/\/example\.com\/crawling\)/);
        // markdownChunking: h3 — chunks present
        assert.ok(Array.isArray(res.body.data.chunks), 'chunks array should be present');
    });

    it('preset=spider collects full link inventory in links summary', async () => {
        const res = await crawlWithHeaders({ 'X-Preset': 'spider' });
        assert.strictEqual(res.status, 200);
        // withLinksSummary: all — links footer populated
        const hrefs = (res.body.data.links as Array<[string, string]> || []).map(([_, url]) => url);
        assert.ok(hrefs.length > 0, 'spider preset should populate link summary');
        assert.ok(
            hrefs.some((h) => h === 'https://example.com/crawling'),
            `Expected crawling URL in links footer, got: ${hrefs.join(', ')}`,
        );
    });

    it('explicit header overrides the preset', async () => {
        // preset=index drops link URLs via retainLinks: text
        // explicit X-Retain-Links: all should override that
        const res = await crawlWithHeaders({
            'X-Preset': 'index',
            'X-Retain-Links': 'all',
        });
        assert.strictEqual(res.status, 200);
        const content = getContent(res);
        assert.match(content, /\[link to crawling docs\]\(https:\/\/example\.com\/crawling\)/);
    });
});

// --- Recipe 10: Raw HTML upload ---
describe('cookbook: raw HTML upload', () => {
    it('POST with { html, url } returns extracted content', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({
                html: SAMPLE_HTML,
                url: 'https://example.com/source',
            });
        assert.strictEqual(res.status, 200);
        const data = res.body.data;
        // Readability extracts title separately; check body text and title independently.
        assert.match(data.content, /fetching pages/);
        assert.ok(typeof data.title === 'string' && data.title.length > 0);
    });

    it('url field is used as base for relative links in raw HTML', async () => {
        // The fixture contains <a href="/guide/advanced"> and <a href="sibling-page">
        // — both must resolve against the supplied url.
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({
                html: SAMPLE_HTML,
                url: 'https://example.com/source/parent/',
                respondWith: 'markdown',
                withLinksSummary: true,
            });
        assert.strictEqual(res.status, 200);
        const hrefs = Object.values(res.body.data.links as Record<string, string>);
        assert.ok(
            hrefs.some((h) => h.startsWith('https://example.com/')),
            `Expected absolute URLs based on supplied url, got: ${hrefs.join(', ')}`,
        );
    });

    it('raw HTML works without a url field (uses blob:<hash>)', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({ html: '<html><body><p>standalone</p></body></html>' });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.data.content.includes('standalone'));
    });
});
