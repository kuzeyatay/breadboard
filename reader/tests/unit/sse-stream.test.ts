/**
 * Unit tests for SSE stream codecs.
 *
 * InputServerEventStream: parses raw SSE text into event objects.
 * OutputServerEventStream: encodes event objects into SSE text.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import { InputServerEventStream, OutputServerEventStream } from '../../build/lib/transform-server-event-stream.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectObjects(stream: NodeJS.ReadableStream): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const items: any[] = [];
        stream.on('data', (item) => items.push(item));
        stream.on('end', () => resolve(items));
        stream.on('error', reject);
    });
}

function collectText(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: string[] = [];
        stream.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? chunk : chunk.toString()));
        stream.on('end', () => resolve(chunks.join('')));
        stream.on('error', reject);
    });
}

function writeSSE(stream: InputServerEventStream, ...lines: string[]): void {
    const src = Readable.from([lines.join('')]);
    src.pipe(stream);
}

// ---------------------------------------------------------------------------
// InputServerEventStream
// ---------------------------------------------------------------------------

describe('InputServerEventStream: basic data event', () => {
    it('parses a single data: line into an event object', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('data: hello\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items.length, 1);
        assert.equal(items[0].data, 'hello');
    });

    it('strips leading space after the colon', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('data: world\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items[0].data, 'world');
    });

    it('parses event and data fields together', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('event: ping\ndata: pong\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items[0].event, 'ping');
        assert.equal(items[0].data, 'pong');
    });

    it('parses multiple events from one chunk', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('data: first\n\ndata: second\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items.length, 2);
        assert.equal(items[0].data, 'first');
        assert.equal(items[1].data, 'second');
    });

    it('parses data as JSON object when data is valid JSON', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('data: {"key":"value"}\n\n');
        stream.end();
        const items = await promise;
        assert.deepEqual(items[0].data, { key: 'value' });
    });

    it('parses retry field as a number', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('retry: 3000\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items[0].retry, 3000);
    });

    it('ignores lines with no colon or empty key', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        // line with no colon should be skipped; only data line counts
        stream.write('just a comment\ndata: ok\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items.length, 1);
        assert.equal(items[0].data, 'ok');
    });

    it('handles CRLF line endings', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('data: crlf\r\n\r\n');
        stream.end();
        const items = await promise;
        assert.equal(items[0].data, 'crlf');
    });

    it('handles chunks that arrive in pieces (split across writes)', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.write('dat');
        stream.write('a: split');
        stream.write('\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items[0].data, 'split');
    });
});

describe('InputServerEventStream: edge cases', () => {
    it('emits nothing for an empty stream', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        stream.end();
        const items = await promise;
        assert.equal(items.length, 0);
    });

    it('skips events with no recognised fields', async () => {
        const stream = new InputServerEventStream();
        const promise = collectObjects(stream);
        // A block with only comment-like lines (no colon) → no fields → not pushed
        stream.write(': comment line\n\n');
        stream.end();
        const items = await promise;
        assert.equal(items.length, 0);
    });
});

// ---------------------------------------------------------------------------
// OutputServerEventStream
// ---------------------------------------------------------------------------

describe('OutputServerEventStream: encoding objects', () => {
    it('encodes a data-only object as "data: <json>\\n\\n"', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({ data: { foo: 'bar' } });
        stream.end();
        const text = await promise;
        assert.ok(text.includes('data: {"foo":"bar"}'));
        assert.ok(text.endsWith('\n\n'));
    });

    it('encodes event + data fields', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({ event: 'update', data: 'hello' });
        stream.end();
        const text = await promise;
        assert.ok(text.includes('event: update'));
        assert.ok(text.includes('data: hello'));
    });

    it('encodes a string data with multi-line splitting', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({ data: 'line1\nline2' });
        stream.end();
        const text = await promise;
        assert.ok(text.includes('data: line1'));
        assert.ok(text.includes('data: line2'));
    });

    it('encodes id field when provided', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({ data: 'x', id: '42' });
        stream.end();
        const text = await promise;
        assert.ok(text.includes('id: 42'));
    });

    it('increments n counter for each written event', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({ data: 'a' });
        stream.write({ data: 'b' });
        stream.end();
        await promise;
        assert.equal(stream.n, 2);
    });

    it('encodes a plain string as data lines', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write('plain string');
        stream.end();
        const text = await promise;
        assert.ok(text.includes('data: plain string'));
    });

    it('falls back to data: JSON.stringify(chunk) for objects with no data/event/id/retry', async () => {
        const stream = new OutputServerEventStream();
        const promise = collectText(stream);
        stream.write({});
        stream.end();
        const text = await promise;
        assert.ok(text.includes('data: '));
    });
});

describe('OutputServerEventStream: round-trip with InputServerEventStream', () => {
    it('encodes then decodes a JSON data object', async () => {
        const encoder = new OutputServerEventStream();
        const decoder = new InputServerEventStream();
        encoder.pipe(decoder as any);

        const promise = collectObjects(decoder);
        encoder.write({ data: { hello: 'world', n: 42 } });
        encoder.end();

        const items = await promise;
        assert.ok(items.length >= 1);
        const first = items[0];
        assert.deepEqual(first.data, { hello: 'world', n: 42 });
    });
});
