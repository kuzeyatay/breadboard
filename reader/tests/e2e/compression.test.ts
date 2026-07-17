/**
 * E2E tests for the compression middleware (src/lib/koa-compress.ts).
 *
 * Covers:
 *   - Accept-Encoding negotiation across gzip / br / zstd
 *   - Preference ordering (zstd > br > gzip > deflate) and q-value tie-breaking
 *   - RFC 9110 identity semantics: strict-prefer identity → no compression
 *   - X-Decompressed-Content-Length matches the actual decompressed byte length
 *   - Cache-Control: no-transform is appended on compressed AND on
 *     deliberately-uncompressed responses (preserves server intent through caches)
 *   - Vary: Accept-Encoding is always advertised
 *   - Below-threshold static assets bypass compression
 *
 * Uses supertest with a custom raw parser so res.body is a Buffer rather than
 * a JSON-parsed object. Note: superagent auto-decompresses gzip/br/deflate before
 * the custom parser sees the stream — for zstd we decompress manually.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import zlib from 'zlib';
import { promisify } from 'util';
import supertest from 'supertest';
import server from '../../build/stand-alone/crawl.js';
import { SAMPLE_HTML } from '../helpers/client';

function rawParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
    res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
}

function agent() {
    return supertest(server.httpServer);
}

async function postCrawl(acceptEncoding: string | undefined) {
    let req = agent()
        .post('/')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .buffer(true)
        .parse(rawParser);
    if (acceptEncoding !== undefined) req = req.set('Accept-Encoding', acceptEncoding);
    return req.send({ html: SAMPLE_HTML, url: 'https://example.com/test' });
}

const zstdDecompress = promisify(zlib.zstdDecompress);

// supertest/superagent auto-decompresses gzip/br/deflate before the parser sees
// the stream; we only need to manually decode zstd.
async function decodedPayload(res: supertest.Response): Promise<Buffer> {
    const enc = res.headers['content-encoding'];
    const body = res.body as Buffer;
    if (enc === 'zstd') return zstdDecompress(body);
    return body;
}

function cacheControlIncludes(res: supertest.Response, directive: string): boolean {
    const cc = String(res.headers['cache-control'] ?? '').toLowerCase();
    return cc.split(',').map((s) => s.trim()).includes(directive);
}

describe('compression: encoding negotiation', () => {
    it('Accept-Encoding: gzip → gzip, body is valid JSON', async () => {
        const res = await postCrawl('gzip');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
        const json = JSON.parse((await decodedPayload(res)).toString('utf-8'));
        assert.ok(json?.data?.content, 'decompressed payload must contain data.content');
    });

    it('Accept-Encoding: br → br, body is valid JSON', async () => {
        const res = await postCrawl('br');
        assert.strictEqual(res.headers['content-encoding'], 'br');
        const json = JSON.parse((await decodedPayload(res)).toString('utf-8'));
        assert.ok(json?.data?.content);
    });

    it('Accept-Encoding: zstd → zstd, body is valid JSON', async () => {
        const res = await postCrawl('zstd');
        assert.strictEqual(res.headers['content-encoding'], 'zstd');
        const json = JSON.parse((await decodedPayload(res)).toString('utf-8'));
        assert.ok(json?.data?.content);
    });

    it('Accept-Encoding: gzip, br, zstd → picks zstd (top of preference)', async () => {
        const res = await postCrawl('gzip, br, zstd');
        assert.strictEqual(res.headers['content-encoding'], 'zstd');
    });

    it('Accept-Encoding: * → picks zstd (top of preference)', async () => {
        const res = await postCrawl('*');
        assert.strictEqual(res.headers['content-encoding'], 'zstd');
    });

    it('Accept-Encoding: gzip;q=1, br;q=0.5 → q dominates preference', async () => {
        const res = await postCrawl('gzip;q=1, br;q=0.5');
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
    });

    it('Accept-Encoding: identity → no compression', async () => {
        const res = await postCrawl('identity');
        assert.strictEqual(res.headers['content-encoding'], undefined);
    });

    it('No Accept-Encoding header → no compression', async () => {
        const res = await postCrawl('');
        assert.strictEqual(res.headers['content-encoding'], undefined);
    });

    it('identity, gzip;q=0.5 → identity strictly preferred, no compression', async () => {
        const res = await postCrawl('identity, gzip;q=0.5');
        assert.strictEqual(res.headers['content-encoding'], undefined);
    });

    it('gzip, identity;q=0 → identity excluded, gzip wins', async () => {
        const res = await postCrawl('gzip, identity;q=0');
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
    });

    it('identity, gzip at equal q → gzip wins (tie ≠ strict-prefer)', async () => {
        const res = await postCrawl('identity, gzip');
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
    });

    it('Unknown token (lzma) → no compression', async () => {
        const res = await postCrawl('lzma');
        assert.strictEqual(res.headers['content-encoding'], undefined);
    });
});

describe('compression: response framing', () => {
    it('Vary: Accept-Encoding is set on compressed responses', async () => {
        const res = await postCrawl('gzip');
        const vary = String(res.headers['vary'] ?? '').toLowerCase();
        assert.ok(vary.includes('accept-encoding') || vary.includes('*'), `expected Vary to include Accept-Encoding or *, got "${vary}"`);
    });

    it('Vary: Accept-Encoding is set even when no compression is applied', async () => {
        const res = await postCrawl('');
        const vary = String(res.headers['vary'] ?? '').toLowerCase();
        assert.ok(vary.includes('accept-encoding') || vary.includes('*'), `expected Vary to include Accept-Encoding or *, got "${vary}"`);
    });

    it('Content-Encoding is a single token (no stacked encodings)', async () => {
        const res = await postCrawl('gzip');
        const ce = res.headers['content-encoding'];
        assert.ok(typeof ce === 'string');
        assert.ok(!ce.includes(','), `Content-Encoding should be a single token, got "${ce}"`);
    });

    it('uncompressed response still carries a valid JSON payload', async () => {
        const res = await postCrawl('');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers['content-encoding'], undefined);
        const json = JSON.parse((res.body as Buffer).toString('utf-8'));
        assert.ok(json?.data?.content);
    });
});

describe('compression: X-Decompressed-Content-Length', () => {
    for (const encoding of ['gzip', 'br', 'zstd'] as const) {
        it(`${encoding}: header value equals the decompressed byte length`, async () => {
            const res = await postCrawl(encoding);
            assert.strictEqual(res.headers['content-encoding'], encoding);

            const advertised = res.headers['x-decompressed-content-length'];
            assert.ok(advertised, `${encoding} response must set X-Decompressed-Content-Length`);

            const decoded = await decodedPayload(res);
            assert.strictEqual(
                parseInt(String(advertised), 10),
                decoded.byteLength,
                `${encoding}: X-Decompressed-Content-Length must equal decompressed payload length`,
            );
        });
    }

    it('uncompressed response does not set X-Decompressed-Content-Length', async () => {
        const res = await postCrawl('');
        assert.strictEqual(res.headers['content-encoding'], undefined);
        assert.strictEqual(res.headers['x-decompressed-content-length'], undefined);
    });
});

describe('compression: Cache-Control no-transform', () => {
    it('appends no-transform on compressed responses', async () => {
        const res = await postCrawl('gzip');
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
        assert.ok(
            cacheControlIncludes(res, 'no-transform'),
            `expected Cache-Control to include no-transform, got "${res.headers['cache-control']}"`,
        );
    });

    it('appends no-transform when negotiation declines compression (identity)', async () => {
        const res = await postCrawl('identity');
        assert.strictEqual(res.headers['content-encoding'], undefined);
        assert.ok(
            cacheControlIncludes(res, 'no-transform'),
            `expected Cache-Control to include no-transform on identity, got "${res.headers['cache-control']}"`,
        );
    });

    it('appends no-transform on the no-Accept-Encoding path', async () => {
        const res = await postCrawl('');
        assert.strictEqual(res.headers['content-encoding'], undefined);
        assert.ok(
            cacheControlIncludes(res, 'no-transform'),
            `expected Cache-Control to include no-transform when no Accept-Encoding, got "${res.headers['cache-control']}"`,
        );
    });
});

describe('compression: threshold', () => {
    it('below-threshold static asset (robots.txt, ~375B) is not compressed', async () => {
        const res = await agent()
            .get('/robots.txt')
            .set('Accept-Encoding', 'gzip, br, zstd')
            .buffer(true)
            .parse(rawParser);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(
            res.headers['content-encoding'],
            undefined,
            'below-threshold responses must not be compressed',
        );
        assert.ok(res.headers['content-length'], 'asset response should retain Content-Length');
    });
});
