/**
 * E2E tests for the detachInvisibles crawler option.
 *
 * The html-input path processes HTML through jsdom (not puppeteer), so
 * detachInvisibles — which is injected into the puppeteer page and relies on
 * getComputedStyle — has no effect there.  These tests drive the real browser
 * engine against a local fixture server so computed styles are live.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getAgent } from '../helpers/client';
import { startFixtureServer, FixtureServer } from '../helpers/fixture-server';

const HIDDEN_UNIQUE = 'CrawlerHiddenSecret42';
const VISIBLE_UNIQUE = 'CrawlerVisibleContent99';

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Detach Invisibles Test</title></head>
<body>
  <article>
    <h1>Test Page</h1>
    <p>${VISIBLE_UNIQUE}</p>
    <div style="display:none">
      <p>${HIDDEN_UNIQUE}</p>
    </div>
    <p>More visible text below the hidden block.</p>
  </article>
</body>
</html>`;

describe('detachInvisibles against real browser engine', () => {
    let fixture: FixtureServer;

    before(async () => {
        fixture = await startFixtureServer();
        fixture.use('GET', '/hidden-test', (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(FIXTURE_HTML);
        });
    });

    after(async () => {
        await fixture.close();
    });

    function crawlFixture(opts: Record<string, unknown> = {}) {
        return getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({
                url: fixture.url('/hidden-test'),
                ...opts,
            });
    }

    // ── baseline: hidden DOM text is present in raw HTML without the flag ────

    it('baseline: snapshot html includes display:none content by default', async () => {
        const res = await crawlFixture({ respondWith: 'html' });
        assert.strictEqual(res.status, 200);
        assert.ok(
            res.body.data.html?.includes(HIDDEN_UNIQUE),
            `Expected raw html to contain '${HIDDEN_UNIQUE}' without detachInvisibles`
        );
    });

    // ── detachInvisibles: true removes hidden elements from the html snapshot

    it('removes display:none elements from snapshot html', async () => {
        const res = await crawlFixture({ respondWith: 'html', detachInvisibles: true });
        assert.strictEqual(res.status, 200);
        assert.ok(
            !res.body.data.html?.includes(HIDDEN_UNIQUE),
            `Expected '${HIDDEN_UNIQUE}' to be absent from html snapshot when detachInvisibles is true`
        );
    });

    it('preserves visible content in snapshot html', async () => {
        const res = await crawlFixture({ respondWith: 'html', detachInvisibles: true });
        assert.strictEqual(res.status, 200);
        assert.ok(
            res.body.data.html?.includes(VISIBLE_UNIQUE),
            `Expected '${VISIBLE_UNIQUE}' to remain in html snapshot`
        );
    });

    // ── detachInvisibles also filters markdown (uses snapshot.html via turndown)

    it('removes display:none text from markdown output', async () => {
        const res = await crawlFixture({ respondWith: 'markdown', detachInvisibles: true });
        assert.strictEqual(res.status, 200);
        assert.ok(
            !res.body.data.content?.includes(HIDDEN_UNIQUE),
            `Expected '${HIDDEN_UNIQUE}' to be absent from markdown when detachInvisibles is true`
        );
        assert.ok(
            res.body.data.content?.includes(VISIBLE_UNIQUE),
            `Expected '${VISIBLE_UNIQUE}' to remain in markdown output`
        );
    });

    // ── header form ──────────────────────────────────────────────────────────

    it('X-Detach-Invisibles header removes hidden content', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('X-Detach-Invisibles', 'true')
            .send({ url: fixture.url('/hidden-test'), respondWith: 'html' });
        assert.strictEqual(res.status, 200);
        assert.ok(
            !res.body.data.html?.includes(HIDDEN_UNIQUE),
            `Expected '${HIDDEN_UNIQUE}' absent via X-Detach-Invisibles header`
        );
    });

    it('X-Detach-Invisibles: false leaves hidden content intact', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('X-Detach-Invisibles', 'false')
            .send({ url: fixture.url('/hidden-test'), respondWith: 'html' });
        assert.strictEqual(res.status, 200);
        assert.ok(
            res.body.data.html?.includes(HIDDEN_UNIQUE),
            `Expected '${HIDDEN_UNIQUE}' present when X-Detach-Invisibles is false`
        );
    });

    // ── comment placeholder survives in raw html ────────────────────────────

    it('leaves a comment placeholder in the html where the element was', async () => {
        const res = await crawlFixture({ respondWith: 'html', detachInvisibles: true });
        assert.strictEqual(res.status, 200);
        assert.ok(
            res.body.data.html?.includes('<!--jina-detached-invisible-->'),
            'Expected comment placeholder in html where display:none element was'
        );
    });
});
