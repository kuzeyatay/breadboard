/**
 * E2E tests for the HTTP surface of CrawlerOptions parsing and
 * mode-selection methods.
 *
 * Verifies that the options parser in `src/dto/crawler-options.ts`
 * is wired to the running server: HTTP headers and body fields
 * produce the expected observable behavior. The pure-logic
 * counterparts of these methods (presumedRespondTiming,
 * isCacheQueryApplicable, isRequestingCompoundContentFormat,
 * from()) are unit-tested in tests/unit/crawler-options-dto.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    crawl,
    crawlWithHeaders,
    getAgent,
    SAMPLE_HTML,
} from '../helpers/client';

// ── isRequestingCompoundContentFormat → response transport ──────────────────

describe('compound respondWith dispatched by Accept', () => {
    it('Accept: text/event-stream returns SSE for content+html', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                html: SAMPLE_HTML,
                url: 'https://example.com/test',
                respondWith: 'content+html',
            });
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /event-stream/);
    });

    it('Accept: application/json accepts compound markdown+html (no SSE required)', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({
                html: SAMPLE_HTML,
                url: 'https://example.com/test',
                respondWith: 'markdown+html',
            });
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /json/);
    });

    it('Omitting Accept header rejects compound formats with 400', async () => {
        const res = await getAgent()
            .post('/')
            .set('Content-Type', 'application/json')
            .send({
                html: SAMPLE_HTML,
                url: 'https://example.com/test',
                respondWith: 'markdown+html',
            });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
        assert.match(res.body.readableMessage || res.body.message, /compound/i);
    });

    it('single-format respondWith returns JSON (no SSE) under default Accept', async () => {
        const res = await crawl({ respondWith: 'markdown' });
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /json/);
    });
});

// ── readerlm-v2 + content rejection (parser-level) ─────────────────────────

describe('lm + content combo rejection', () => {
    it('body respondWith: readerlm-v2+content returns 400', async () => {
        const res = await crawl({ respondWith: 'readerlm-v2+content' });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });

    it('X-Respond-With: readerlm-v2+content header returns 400', async () => {
        const res = await crawlWithHeaders({
            'X-Respond-With': 'readerlm-v2+content',
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });
});

// ── page body parameter validation ─────────────────────────────────────────

describe('page body parameter validator', () => {
    it('positive integer is accepted (no-op without uploaded file)', async () => {
        const res = await crawl({ page: 5 });
        assert.strictEqual(res.status, 200);
    });

    it('zero is rejected with 400 ParamValidationError', async () => {
        const res = await crawl({ page: 0 });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });

    it('negative integer is rejected with 400', async () => {
        const res = await crawl({ page: -1 });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });

    it('non-integer (1.5) is rejected with 400', async () => {
        const res = await crawl({ page: 1.5 });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });
});

// ── X-Page header parsing (header handler is lenient) ──────────────────────

describe('X-Page header parsing', () => {
    it('X-Page: 5 is accepted (no-op without uploaded file)', async () => {
        const res = await crawlWithHeaders({ 'X-Page': '5' });
        assert.strictEqual(res.status, 200);
    });

    it('X-Page: 0 is silently ignored (request still succeeds)', async () => {
        const res = await crawlWithHeaders({ 'X-Page': '0' });
        assert.strictEqual(res.status, 200);
    });

    it('X-Page: -2 is silently ignored (request still succeeds)', async () => {
        const res = await crawlWithHeaders({ 'X-Page': '-2' });
        assert.strictEqual(res.status, 200);
    });

    it('X-Page: foo is silently ignored (request still succeeds)', async () => {
        const res = await crawlWithHeaders({ 'X-Page': 'foo' });
        assert.strictEqual(res.status, 200);
    });
});

// ── X-Retain-Links: gpt-oss → withLinksSummary (header path) ───────────────

describe('X-Retain-Links: gpt-oss header coupling', () => {
    it('response includes a links summary section', async () => {
        const res = await crawlWithHeaders(
            { 'X-Retain-Links': 'gpt-oss' },
            { respondWith: 'markdown' },
        );
        assert.strictEqual(res.status, 200);
        assert.notStrictEqual(res.body.data.links, undefined);
    });

    it('content uses the gpt-oss citation marker 【N†', async () => {
        const res = await crawlWithHeaders(
            { 'X-Retain-Links': 'gpt-oss' },
            { respondWith: 'markdown' },
        );
        assert.match(res.body.data.content, /【\d+†/);
    });
});

// ── readabilityRequired observable behavior ────────────────────────────────

describe('readabilityRequired bypass for raw formats', () => {
    // HTML with no clear "main article" — readability would score this low.
    const sparseHtml = [
        '<!DOCTYPE html><html><head><title>Sparse</title></head><body>',
        '<nav id="navbar">site nav</nav>',
        '<div class="widget">widget snippet</div>',
        '<span>loose span text</span>',
        '<footer>footer text</footer>',
        '</body></html>',
    ].join('');

    async function send(opts: Record<string, unknown>) {
        return getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({ html: sparseHtml, url: 'https://example.com/sparse', ...opts });
    }

    it('respondWith: html returns raw markup including non-article chrome', async () => {
        const res = await send({ respondWith: 'html' });
        assert.strictEqual(res.status, 200);
        const html: string = res.body.data.html;
        assert.strictEqual(typeof html, 'string');
        assert.match(html, /site nav/);
        assert.match(html, /widget snippet/);
        assert.match(html, /footer text/);
    });

    it('respondWith: text returns text from non-article elements', async () => {
        const res = await send({ respondWith: 'text' });
        assert.strictEqual(res.status, 200);
        const text: string = res.body.data.text;
        assert.strictEqual(typeof text, 'string');
        assert.ok(text.includes('site nav'));
        assert.ok(text.includes('widget snippet'));
        assert.ok(text.includes('footer text'));
        // Plain text mode strips tags
        assert.doesNotMatch(text, /<\/?(nav|div|footer|span)\b/i);
    });

    it('respondWith: text contains no markdown heading/list markers', async () => {
        const res = await send({ respondWith: 'text' });
        const text: string = res.body.data.text;
        assert.doesNotMatch(text, /^#{1,6} /m);
        assert.doesNotMatch(text, /^[*+-] /m);
    });
});
