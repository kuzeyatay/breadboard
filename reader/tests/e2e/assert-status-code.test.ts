/**
 * E2E tests for the assertStatusCode option using a real HTTP fixture server.
 *
 * The html-input path produces snapshots with no `status` field, so the
 * assertion in CrawlerHost.iterSnapshots is silently skipped there. To
 * exercise the assertion proper, these tests drive the crawler against a
 * local fixture server with `engine: 'curl'`.
 *
 * URL note: `assertNormalizedUrl` in src/services/misc.ts rejects bare IP
 * literals in non-public ranges unconditionally, so the fixture URL uses
 * the `localhost` hostname (server binds dual-stack).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getAgent } from '../helpers/client';
import { startFixtureServer, FixtureServer } from '../helpers/fixture-server';

describe('assertStatusCode against real network fixture', () => {
    let fixture: FixtureServer;

    before(async () => {
        fixture = await startFixtureServer();
    });

    after(async () => {
        await fixture.close();
    });

    async function crawlUrl(body: Record<string, unknown>, headers: Record<string, string> = {}) {
        let req = getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json');
        for (const [k, v] of Object.entries(headers)) {
            req = req.set(k, v);
        }
        return req.send(body);
    }

    // ── matching status: request succeeds ──────────────────────────────────

    it('200 fixture passes when assertStatusCode matches', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/200'),
            engine: 'curl',
            assertStatusCode: 200,
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Status 200/);
    });

    it('404 fixture passes when assertStatusCode: 404 matches the real status', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/404'),
            engine: 'curl',
            assertStatusCode: 404,
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Status 404/);
    });

    it('200 fixture without assertStatusCode still works (default behavior)', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/200'),
            engine: 'curl',
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Status 200/);
    });

    it('404 fixture without assertStatusCode does not throw (status check is opt-in)', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/404'),
            engine: 'curl',
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Status 404/);
    });

    // ── mismatching status: request rejected with AssertionFailureError ────

    it('200 expected vs 404 actual throws AssertionFailureError (body form)', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/404'),
            engine: 'curl',
            assertStatusCode: 200,
        });
        assert.ok(res.status >= 400, `Expected error status, got ${res.status}`);
        assert.strictEqual(res.body.name, 'AssertionFailureError');
        assert.match(
            res.body.message || res.body.readableMessage,
            /Expected status code 200 but got 404/
        );
    });

    it('200 expected vs 500 actual throws AssertionFailureError', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/500'),
            engine: 'curl',
            assertStatusCode: 200,
        });
        assert.ok(res.status >= 400);
        assert.strictEqual(res.body.name, 'AssertionFailureError');
        assert.match(
            res.body.message || res.body.readableMessage,
            /Expected status code 200 but got 500/
        );
    });

    it('404 expected vs 200 actual throws AssertionFailureError', async () => {
        const res = await crawlUrl({
            url: fixture.url('/status/200'),
            engine: 'curl',
            assertStatusCode: 404,
        });
        assert.ok(res.status >= 400);
        assert.strictEqual(res.body.name, 'AssertionFailureError');
        assert.match(
            res.body.message || res.body.readableMessage,
            /Expected status code 404 but got 200/
        );
    });

    // ── header form behaves the same ────────────────────────────────────────

    it('X-Assert-Status-Code header: match passes', async () => {
        const res = await crawlUrl(
            { url: fixture.url('/status/200'), engine: 'curl' },
            { 'X-Assert-Status-Code': '200' }
        );
        assert.strictEqual(res.status, 200);
    });

    it('X-Assert-Status-Code header: mismatch throws AssertionFailureError', async () => {
        const res = await crawlUrl(
            { url: fixture.url('/status/500'), engine: 'curl' },
            { 'X-Assert-Status-Code': '200' }
        );
        assert.ok(res.status >= 400);
        assert.strictEqual(res.body.name, 'AssertionFailureError');
        assert.match(
            res.body.message || res.body.readableMessage,
            /Expected status code 200 but got 500/
        );
    });

    it('X-Assert-Status-Code: foo (non-numeric) is ignored — request succeeds despite 404', async () => {
        const res = await crawlUrl(
            { url: fixture.url('/status/404'), engine: 'curl' },
            { 'X-Assert-Status-Code': 'foo' }
        );
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.content, /Status 404/);
    });
});
