/**
 * Unit tests for miscellaneous utility functions.
 *
 * Covers cleanAttribute (HTML attribute sanitizer), tryDecodeURIComponent
 * (safe URI decoder), and isScalarLike (type classifier).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAttribute, tryDecodeURIComponent, isScalarLike } from '../../build/utils/misc.js';

// ---------------------------------------------------------------------------
// cleanAttribute
// ---------------------------------------------------------------------------

describe('cleanAttribute: null input', () => {
    it('returns an empty string for null', () => {
        assert.equal(cleanAttribute(null), '');
    });
});

describe('cleanAttribute: whitespace normalisation', () => {
    it('leaves a simple string unchanged', () => {
        assert.equal(cleanAttribute('hello world'), 'hello world');
    });

    it('collapses consecutive newlines with trailing spaces into a single newline', () => {
        // \n\n\n   → \n
        assert.equal(cleanAttribute('line1\n\n\n   line2'), 'line1\nline2');
    });

    it('collapses a newline followed by spaces into a single newline', () => {
        assert.equal(cleanAttribute('a\n   b'), 'a\nb');
    });

    it('handles a string with no newlines untouched', () => {
        assert.equal(cleanAttribute('plain text'), 'plain text');
    });

    it('handles an empty string correctly', () => {
        assert.equal(cleanAttribute(''), '');
    });
});

// ---------------------------------------------------------------------------
// tryDecodeURIComponent
// ---------------------------------------------------------------------------

describe('tryDecodeURIComponent: valid encoded input', () => {
    it('decodes a percent-encoded space (%20)', () => {
        assert.equal(tryDecodeURIComponent('hello%20world'), 'hello world');
    });

    it('decodes a percent-encoded slash (%2F)', () => {
        assert.equal(tryDecodeURIComponent('path%2Fto%2Ffile'), 'path/to/file');
    });

    it('decodes an encoded Unicode character', () => {
        assert.equal(tryDecodeURIComponent('%E4%B8%AD%E6%96%87'), '中文');
    });
});

describe('tryDecodeURIComponent: input that fails decoding but parses as URL', () => {
    it('returns the original string when it cannot be decoded but is a valid URL', () => {
        // %GG is invalid URI encoding but a valid URL-parseable string
        const result = tryDecodeURIComponent('%GG');
        assert.equal(result, '%GG');
    });

    it('returns a full URL unchanged when decoding is unnecessary', () => {
        const url = 'https://example.com/path?q=test';
        assert.equal(tryDecodeURIComponent(url), url);
    });
});

describe('tryDecodeURIComponent: plain text', () => {
    it('passes through a plain string that needs no decoding', () => {
        assert.equal(tryDecodeURIComponent('hello world'), 'hello world');
    });
});

// ---------------------------------------------------------------------------
// isScalarLike
// ---------------------------------------------------------------------------

describe('isScalarLike: primitive values', () => {
    it('returns true for a string value', () => {
        assert.ok(isScalarLike('hello'));
    });

    it('returns true for a number value', () => {
        assert.ok(isScalarLike(42));
    });

    it('returns true for a boolean value', () => {
        assert.ok(isScalarLike(true));
        assert.ok(isScalarLike(false));
    });
});

describe('isScalarLike: constructor references', () => {
    it('returns true for the String constructor', () => {
        assert.ok(isScalarLike(String));
    });

    it('returns true for the Number constructor', () => {
        assert.ok(isScalarLike(Number));
    });

    it('returns true for the Boolean constructor', () => {
        assert.ok(isScalarLike(Boolean));
    });
});

describe('isScalarLike: non-scalar values', () => {
    it('returns false for null', () => {
        assert.ok(!isScalarLike(null));
    });

    it('returns false for a plain object {}', () => {
        assert.ok(!isScalarLike({}));
    });

    it('returns false for an array []', () => {
        assert.ok(!isScalarLike([]));
    });

    it('returns false for undefined', () => {
        assert.ok(!isScalarLike(undefined));
    });

    it('returns false for a custom class instance', () => {
        class Foo {}
        assert.ok(!isScalarLike(new Foo()));
    });
});
