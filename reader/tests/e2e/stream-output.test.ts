/**
 * E2E tests for the SSE (server-sent events) streaming response path.
 *
 * Compound respondWith values (e.g. 'markdown+html') require
 * Accept: text/event-stream and produce a stream of JSON-encoded events.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { crawlStream, parseSSELines } from '../helpers/client';

describe('SSE response for markdown+html', () => {
    it('returns HTTP 200 with text/event-stream content-type', async () => {
        const res = await crawlStream('markdown+html');
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /text\/event-stream/);
    });

    it('response body contains data: lines', async () => {
        const res = await crawlStream('markdown+html');
        assert.match(res.text, /^data:/m);
    });

    it('produces multiple SSE events', async () => {
        const res = await crawlStream('markdown+html');
        const dataLines = (res.text as string)
            .split('\n')
            .filter((l: string) => l.startsWith('data:'));
        assert.ok(dataLines.length >= 2, `Expected >= 2 data: lines, got ${dataLines.length}`);
    });

    it('all non-terminal data: lines are valid JSON', async () => {
        const res = await crawlStream('markdown+html');
        const events = parseSSELines(res);
        assert.ok(events.length > 0, 'Expected at least one parsed SSE event');
        for (const event of events) {
            assert.strictEqual(typeof event, 'object', `SSE event should be an object: ${JSON.stringify(event)}`);
        }
    });
});

describe('SSE response for markdown+text', () => {
    it('returns event-stream for markdown+text compound format', async () => {
        const res = await crawlStream('markdown+text');
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /event-stream/);
    });

    it('produces parseable SSE events for markdown+text', async () => {
        const res = await crawlStream('markdown+text');
        const events = parseSSELines(res);
        assert.ok(events.length > 0, 'Expected at least one SSE event');
    });
});
