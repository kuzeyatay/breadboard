/**
 * Unit tests for filtered-stream utilities.
 *
 * Tests getFilteredTextStream (object → string text extraction) and
 * getFilteredStream (object → value extraction), both with and without
 * predicate filtering.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import { getFilteredTextStream, getFilteredStream } from '../../build/lib/filtered-stream.js';

function collectText(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
    });
}

function collectObjects(stream: NodeJS.ReadableStream): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const items: any[] = [];
        stream.on('data', (item) => items.push(item));
        stream.on('end', () => resolve(items));
        stream.on('error', reject);
    });
}

function pipeObjects(objects: any[], dest: NodeJS.WritableStream): void {
    const src = Readable.from(objects, { objectMode: true });
    src.pipe(dest as any);
}

// ---------------------------------------------------------------------------
// getFilteredTextStream
// ---------------------------------------------------------------------------

describe('getFilteredTextStream: basic path extraction', () => {
    it('extracts a string at the given dot-path', async () => {
        const stream = getFilteredTextStream('data.text');
        const promise = collectText(stream);
        pipeObjects([{ data: { text: 'hello' } }], stream);
        const result = await promise;
        assert.equal(result, 'hello');
    });

    it('concatenates strings from multiple objects', async () => {
        const stream = getFilteredTextStream('msg');
        const promise = collectText(stream);
        pipeObjects([{ msg: 'foo' }, { msg: 'bar' }], stream);
        const result = await promise;
        assert.equal(result, 'foobar');
    });

    it('skips objects where the path is missing', async () => {
        const stream = getFilteredTextStream('text');
        const promise = collectText(stream);
        pipeObjects([{ other: 'ignored' }, { text: 'kept' }], stream);
        const result = await promise;
        assert.equal(result, 'kept');
    });

    it('skips objects where the value is not a string', async () => {
        const stream = getFilteredTextStream('val');
        const promise = collectText(stream);
        pipeObjects([{ val: 42 }, { val: null }, { val: 'yes' }], stream);
        const result = await promise;
        assert.equal(result, 'yes');
    });

    it('skips objects where the string value is empty', async () => {
        const stream = getFilteredTextStream('val');
        const promise = collectText(stream);
        pipeObjects([{ val: '' }, { val: 'x' }], stream);
        const result = await promise;
        assert.equal(result, 'x');
    });

    it('defaults to data.choices[0].delta.content path when no path given', async () => {
        const stream = getFilteredTextStream();
        const promise = collectText(stream);
        pipeObjects([{ data: { choices: [{ delta: { content: 'chunk' } }] } }], stream);
        const result = await promise;
        assert.equal(result, 'chunk');
    });
});

describe('getFilteredTextStream: predicate filtering', () => {
    it('passes through objects where predicate returns true', async () => {
        const stream = getFilteredTextStream('v', (d) => d.keep === true);
        const promise = collectText(stream);
        pipeObjects([
            { v: 'a', keep: false },
            { v: 'b', keep: true },
            { v: 'c', keep: true },
        ], stream);
        const result = await promise;
        assert.equal(result, 'bc');
    });

    it('drops all objects when predicate always returns false', async () => {
        const stream = getFilteredTextStream('v', () => false);
        const promise = collectText(stream);
        pipeObjects([{ v: 'x' }, { v: 'y' }], stream);
        const result = await promise;
        assert.equal(result, '');
    });
});

// ---------------------------------------------------------------------------
// getFilteredStream
// ---------------------------------------------------------------------------

describe('getFilteredStream: basic path extraction', () => {
    it('extracts values at the given path as object stream items', async () => {
        const stream = getFilteredStream('payload');
        const promise = collectObjects(stream);
        pipeObjects([{ payload: { id: 1 } }, { payload: { id: 2 } }], stream);
        const items = await promise;
        assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
    });

    it('skips objects where the path value is falsy', async () => {
        const stream = getFilteredStream('val');
        const promise = collectObjects(stream);
        pipeObjects([{ val: null }, { val: 0 }, { val: 'ok' }], stream);
        const items = await promise;
        assert.deepEqual(items, ['ok']);
    });

    it('extracts nested paths correctly', async () => {
        const stream = getFilteredStream('a.b.c');
        const promise = collectObjects(stream);
        pipeObjects([{ a: { b: { c: 42 } } }], stream);
        const items = await promise;
        assert.deepEqual(items, [42]);
    });
});

describe('getFilteredStream: predicate filtering', () => {
    it('applies predicate before extracting path', async () => {
        const stream = getFilteredStream('v', (d) => d.ok);
        const promise = collectObjects(stream);
        pipeObjects([
            { v: 'drop', ok: false },
            { v: 'keep', ok: true },
        ], stream);
        const items = await promise;
        assert.deepEqual(items, ['keep']);
    });
});
