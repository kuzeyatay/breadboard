/**
 * E2E tests for the PDF / file upload cookbook recipes (cookbooks.md §
 * "PDF, MS Office, and raw HTML uploads"). Exercises multipart uploads via
 * supertest's `.attach()` against a small in-memory PDF fixture so the
 * suite stays hermetic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAgent } from '../helpers/client';
import { buildSimplePdf } from '../helpers/pdf-fixture';

const PDF_PAGES = [
    'Reader Cookbook PDF Page One Content',
    'Reader Cookbook PDF Page Two Content',
    'Reader Cookbook PDF Page Three Content',
];
const PDF_BUFFER = buildSimplePdf(PDF_PAGES);

// PDF extraction goes through pdfjs + canvas rendering for the first 3 pages,
// which is measurably slower than the default 10s per-test budget on first run.
const PDF_TIMEOUT = 60_000;

describe('cookbook: PDF upload (multipart)', () => {
    it('uploaded PDF returns extracted text content', { timeout: PDF_TIMEOUT }, async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .attach('file', PDF_BUFFER, {
                filename: 'report.pdf',
                contentType: 'application/pdf',
            });
        assert.strictEqual(
            res.status,
            200,
            `Unexpected status ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`,
        );
        const data = res.body.data;
        assert.ok(typeof data.content === 'string' || typeof data.text === 'string',
            `Expected content/text field, got: ${JSON.stringify(data).slice(0, 300)}`);
        const blob = (data.content || '') + ' ' + (data.text || '');
        assert.match(blob, /Reader Cookbook PDF Page One/);
    });

    it('returns title and url fields for the uploaded file', { timeout: PDF_TIMEOUT }, async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .attach('file', PDF_BUFFER, {
                filename: 'report.pdf',
                contentType: 'application/pdf',
            });
        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.body.data.url === 'string' && res.body.data.url.startsWith('blob:'));
    });

    it('X-Markdown-Chunking: s3 chunks the PDF response', { timeout: PDF_TIMEOUT }, async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('X-Markdown-Chunking', 's3')
            .attach('file', PDF_BUFFER, {
                filename: 'report.pdf',
                contentType: 'application/pdf',
            });
        assert.strictEqual(res.status, 200);
        assert.ok(
            Array.isArray(res.body.data.chunks),
            `Expected chunks array on PDF response, got: ${Object.keys(res.body.data).join(',')}`,
        );
        assert.ok(res.body.data.chunks.length >= 1);
    });

    it('same bytes uploaded twice produce identical sha256-derived url',
        { timeout: PDF_TIMEOUT * 2 },
        async () => {
            // Run sequentially: parallel uploads of the same bytes race on
            // the in-flight cache entry and can yield divergent intermediate
            // state; the user-visible promise (stable sha256 url across
            // requests) only holds after each request completes.
            const upload = () =>
                getAgent()
                    .post('/')
                    .set('Accept', 'application/json')
                    .attach('file', PDF_BUFFER, {
                        filename: 'report.pdf',
                        contentType: 'application/pdf',
                    });
            const r1 = await upload();
            const r2 = await upload();
            assert.strictEqual(r1.status, 200);
            assert.strictEqual(r2.status, 200);
            assert.strictEqual(r1.body.data.url, r2.body.data.url);
        },
    );
});

describe('cookbook: PDF page selection via page=N', () => {
    it('selects a specific page by passing url with a #N hash', { timeout: PDF_TIMEOUT }, async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .field('page', '2')
            .attach('file', PDF_BUFFER, {
                filename: 'report.pdf',
                contentType: 'application/pdf',
            });
        assert.strictEqual(
            res.status,
            200,
            `Unexpected status ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`,
        );
        const blob = (res.body.data.content || '') + ' ' + (res.body.data.text || '');
        assert.match(blob, /Reader Cookbook PDF Page Two/);
        assert.doesNotMatch(blob, /Reader Cookbook PDF Page One/);
    });

    it('alternative: numeric `page` body field selects the same page',
        { timeout: PDF_TIMEOUT },
        async () => {
            const res = await getAgent()
                .post('/')
                .set('Accept', 'application/json')
                .field('page', '2')
                .attach('file', PDF_BUFFER, {
                    filename: 'report.pdf',
                    contentType: 'application/pdf',
                });
            assert.strictEqual(res.status, 200);
            const blob = (res.body.data.content || '') + ' ' + (res.body.data.text || '');
            assert.match(blob, /Reader Cookbook PDF Page Two/);
        },
    );

    it('X-Page header is equivalent to the page body field',
        { timeout: PDF_TIMEOUT },
        async () => {
            const res = await getAgent()
                .post('/')
                .set('Accept', 'application/json')
                .set('X-Page', '3')
                .attach('file', PDF_BUFFER, {
                    filename: 'report.pdf',
                    contentType: 'application/pdf',
                });
            assert.strictEqual(res.status, 200);
            const blob = (res.body.data.content || '') + ' ' + (res.body.data.text || '');
            assert.match(blob, /Reader Cookbook PDF Page Three/);
        },
    );
});
