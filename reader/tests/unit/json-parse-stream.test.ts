/**
 * Unit tests for JSONParserStream and JSONAccumulation.
 *
 * JSONParserStream parses JSON incrementally, emitting structured events.
 * JSONAccumulation consumes those events and reconstructs the value tree.
 * Both expose a static .parse() helper for synchronous single-shot use.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSONParserStream, JSONAccumulation } from '../../build/lib/json-parse-stream.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(input: string, opts?: ConstructorParameters<typeof JSONParserStream>[0]) {
    return JSONParserStream.parse(input, opts);
}

function accumulate(input: string, focus = '', opts?: ConstructorParameters<typeof JSONParserStream>[0]) {
    const events = parse(input, opts);
    return JSONAccumulation.parse(events as any, focus);
}

function eventTypes(input: string, opts?: ConstructorParameters<typeof JSONParserStream>[0]) {
    return parse(input, opts).map((e: any) => e.event);
}

// ---------------------------------------------------------------------------
// Primitive values
// ---------------------------------------------------------------------------

describe('JSONParserStream: string', () => {
    it('emits nodeStart text, textChunk, text, nodeEnd text, end for a simple string', () => {
        const evs = parse('"hello"');
        const types = evs.map((e: any) => e.event);
        assert.ok(types.includes('nodeStart'));
        assert.ok(types.includes('text'));
        assert.ok(types.includes('nodeEnd'));
        assert.ok(types.includes('end'));
    });

    it('accumulates a simple string correctly', () => {
        assert.equal(accumulate('"hello world"'), 'hello world');
    });

    it('accumulates an empty string', () => {
        assert.equal(accumulate('""'), '');
    });

    it('accumulates a string with escape sequences', () => {
        assert.equal(accumulate('"line1\\nline2"'), 'line1\nline2');
    });

    it('accumulates a string with unicode escape', () => {
        assert.equal(accumulate('"\\u0041"'), 'A');
    });

    it('accumulates a string with escaped quote', () => {
        assert.equal(accumulate('"say \\"hi\\""'), 'say "hi"');
    });

    it('accumulates a string with escaped backslash', () => {
        assert.equal(accumulate('"a\\\\b"'), 'a\\b');
    });
});

describe('JSONParserStream: numbers', () => {
    it('accumulates an integer', () => {
        assert.equal(accumulate('42'), 42);
    });

    it('accumulates zero', () => {
        assert.equal(accumulate('0'), 0);
    });

    it('accumulates a negative number', () => {
        assert.equal(accumulate('-7'), -7);
    });

    it('accumulates a floating-point number', () => {
        assert.equal(accumulate('3.14'), 3.14);
    });

    it('accumulates a number in scientific notation', () => {
        assert.equal(accumulate('1e3'), 1000);
    });
});

describe('JSONParserStream: booleans and null', () => {
    it('accumulates true', () => {
        assert.equal(accumulate('true'), true);
    });

    it('accumulates false', () => {
        assert.equal(accumulate('false'), false);
    });

    it('accumulates null', () => {
        assert.equal(accumulate('null'), null);
    });
});

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

describe('JSONParserStream: objects', () => {
    it('accumulates an empty object', () => {
        assert.deepEqual(accumulate('{}'), {});
    });

    it('accumulates a flat object', () => {
        assert.deepEqual(accumulate('{"a":1,"b":"two"}'), { a: 1, b: 'two' });
    });

    it('accumulates a nested object', () => {
        assert.deepEqual(accumulate('{"x":{"y":42}}'), { x: { y: 42 } });
    });

    it('accumulates an object with mixed value types', () => {
        assert.deepEqual(
            accumulate('{"s":"str","n":1,"b":true,"nil":null}'),
            { s: 'str', n: 1, b: true, nil: null }
        );
    });

    it('emits nodeStart/nodeEnd for object', () => {
        const types = eventTypes('{"k":"v"}');
        assert.ok(types.includes('nodeStart'));
        assert.ok(types.includes('nodeEnd'));
    });
});

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

describe('JSONParserStream: arrays', () => {
    it('accumulates an empty array', () => {
        assert.deepEqual(accumulate('[]'), []);
    });

    it('accumulates a flat array of numbers', () => {
        assert.deepEqual(accumulate('[1,2,3]'), [1, 2, 3]);
    });

    it('accumulates an array of strings', () => {
        assert.deepEqual(accumulate('["a","b","c"]'), ['a', 'b', 'c']);
    });

    it('accumulates a nested array', () => {
        assert.deepEqual(accumulate('[[1,2],[3]]'), [[1, 2], [3]]);
    });

    it('accumulates an array with mixed types', () => {
        assert.deepEqual(accumulate('[1,"two",true,null]'), [1, 'two', true, null]);
    });
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

describe('JSONParserStream: whitespace', () => {
    it('ignores leading whitespace', () => {
        assert.equal(accumulate('   42'), 42);
    });

    it('ignores whitespace around object braces', () => {
        assert.deepEqual(accumulate('{ "a" : 1 }'), { a: 1 });
    });

    it('handles newlines and tabs', () => {
        assert.deepEqual(accumulate('{\n\t"k":\n\t1\n}'), { k: 1 });
    });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('JSONParserStream: error handling', () => {
    it('throws a SyntaxError for invalid JSON by default', () => {
        assert.throws(() => parse('{invalid}'), SyntaxError);
    });

    it('does not throw and returns events when swallowErrors is true', () => {
        // With swallowErrors, parse should not throw even on invalid JSON
        let threw = false;
        try {
            parse('{invalid}', { swallowErrors: true });
        } catch (err) {
            threw = true;
        }
        assert.equal(threw, false);
    });

    it('handles abrupt termination when expectAbruptTerminationOfInput is true', () => {
        const evs = parse('{"key":"val', { expectAbruptTerminationOfInput: true });
        const types = evs.map((e: any) => e.event);
        assert.ok(types.includes('nodeEnd'));
    });
});

// ---------------------------------------------------------------------------
// Contaminated input
// ---------------------------------------------------------------------------

describe('JSONParserStream: expectContaminated', () => {
    it('extracts JSON from contaminated object context (preamble text before {)', () => {
        const evs = parse('some preamble {"a":1}', { expectContaminated: 'object' });
        const acc = JSONAccumulation.parse(evs as any);
        assert.deepEqual(acc, { a: 1 });
    });

    it('extracts JSON from contaminated array context', () => {
        const evs = parse('noise [1,2,3]', { expectContaminated: 'array' });
        const acc = JSONAccumulation.parse(evs as any);
        assert.deepEqual(acc, [1, 2, 3]);
    });
});

// ---------------------------------------------------------------------------
// JSONAccumulation: focus path
// ---------------------------------------------------------------------------

describe('JSONAccumulation: focus path', () => {
    it('focuses on a top-level key', () => {
        const evs = parse('{"a":1,"b":2}');
        assert.equal(JSONAccumulation.parse(evs as any, 'b'), 2);
    });

    it('focuses on a nested key', () => {
        const evs = parse('{"x":{"y":{"z":99}}}');
        assert.equal(JSONAccumulation.parse(evs as any, 'x.y.z'), 99);
    });

    it('focuses on an array element', () => {
        const evs = parse('[10,20,30]');
        assert.equal(JSONAccumulation.parse(evs as any, '[1]'), 20);
    });

    it('returns undefined for a non-existent focus path', () => {
        const evs = parse('{"a":1}');
        assert.equal(JSONAccumulation.parse(evs as any, 'nonexistent'), undefined);
    });

    it('returns the full value when focus is empty string', () => {
        const evs = parse('{"k":"v"}');
        assert.deepEqual(JSONAccumulation.parse(evs as any, ''), { k: 'v' });
    });
});

// ---------------------------------------------------------------------------
// Offset metadata
// ---------------------------------------------------------------------------

describe('JSONParserStream: offset metadata', () => {
    it('each event has a numeric offset field', () => {
        const evs = parse('"hi"');
        for (const ev of evs as any[]) {
            if (ev.event === 'raw') continue;
            assert.equal(typeof ev.offset, 'number');
        }
    });

    it('each event has a numeric byteOffset field', () => {
        const evs = parse('"hi"');
        for (const ev of evs as any[]) {
            if (ev.event === 'raw') continue;
            assert.equal(typeof ev.byteOffset, 'number');
        }
    });
});
