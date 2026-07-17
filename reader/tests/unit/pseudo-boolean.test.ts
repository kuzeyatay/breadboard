/**
 * Unit tests for PseudoBoolean — a flexible string-to-boolean converter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PseudoBoolean, PseudoBooleanLoose } from '../../build/lib/pseudo-boolean.js';

// ---------------------------------------------------------------------------
// Falsy inputs
// ---------------------------------------------------------------------------

describe('PseudoBoolean.from: null and undefined', () => {
    it('returns false for null', () => {
        assert.equal(PseudoBoolean.from(null), false);
    });

    it('returns false for undefined', () => {
        assert.equal(PseudoBoolean.from(undefined), false);
    });
});

describe('PseudoBoolean.from: boolean passthrough', () => {
    it('returns true for boolean true', () => {
        assert.equal(PseudoBoolean.from(true), true);
    });

    it('returns false for boolean false', () => {
        assert.equal(PseudoBoolean.from(false), false);
    });
});

describe('PseudoBoolean.from: falsy string values', () => {
    it('returns false for empty string', () => {
        assert.equal(PseudoBoolean.from(''), false);
    });

    it('returns false for "false"', () => {
        assert.equal(PseudoBoolean.from('false'), false);
    });

    it('returns false for "FALSE" (case-insensitive)', () => {
        assert.equal(PseudoBoolean.from('FALSE'), false);
    });

    it('returns false for "none"', () => {
        assert.equal(PseudoBoolean.from('none'), false);
    });

    it('returns false for "null"', () => {
        assert.equal(PseudoBoolean.from('null'), false);
    });

    it('returns false for "nan"', () => {
        assert.equal(PseudoBoolean.from('nan'), false);
    });

    it('returns false for "nil"', () => {
        assert.equal(PseudoBoolean.from('nil'), false);
    });

    it('returns false for "0"', () => {
        assert.equal(PseudoBoolean.from('0'), false);
    });

    it('returns false for "no"', () => {
        assert.equal(PseudoBoolean.from('no'), false);
    });

    it('returns false for "undefined"', () => {
        assert.equal(PseudoBoolean.from('undefined'), false);
    });

    it('returns false for "  false  " (with surrounding spaces)', () => {
        assert.equal(PseudoBoolean.from('  false  '), false);
    });
});

describe('PseudoBoolean.from: truthy string values', () => {
    it('returns true for "true"', () => {
        assert.equal(PseudoBoolean.from('true'), true);
    });

    it('returns true for "TRUE" (case-insensitive)', () => {
        assert.equal(PseudoBoolean.from('TRUE'), true);
    });

    it('returns true for "yes"', () => {
        assert.equal(PseudoBoolean.from('yes'), true);
    });

    it('returns true for "1"', () => {
        assert.equal(PseudoBoolean.from('1'), true);
    });

    it('returns true for "ok"', () => {
        assert.equal(PseudoBoolean.from('ok'), true);
    });

    it('throws for an unrecognized string like "hello"', () => {
        assert.throws(() => PseudoBoolean.from('hello'), TypeError);
    });

    it('throws for a numeric-looking string like "42"', () => {
        assert.throws(() => PseudoBoolean.from('42'), TypeError);
    });
});

// ---------------------------------------------------------------------------
// PseudoBooleanLoose — same falsy set, but any other string → true
// ---------------------------------------------------------------------------

describe('PseudoBooleanLoose.from: null and undefined', () => {
    it('returns false for null', () => {
        assert.equal(PseudoBooleanLoose.from(null), false);
    });

    it('returns false for undefined', () => {
        assert.equal(PseudoBooleanLoose.from(undefined), false);
    });
});

describe('PseudoBooleanLoose.from: boolean passthrough', () => {
    it('returns true for boolean true', () => {
        assert.equal(PseudoBooleanLoose.from(true), true);
    });

    it('returns false for boolean false', () => {
        assert.equal(PseudoBooleanLoose.from(false), false);
    });
});

describe('PseudoBooleanLoose.from: falsy string values', () => {
    it('returns false for empty string', () => {
        assert.equal(PseudoBooleanLoose.from(''), false);
    });

    it('returns false for "false"', () => {
        assert.equal(PseudoBooleanLoose.from('false'), false);
    });

    it('returns false for "FALSE" (case-insensitive)', () => {
        assert.equal(PseudoBooleanLoose.from('FALSE'), false);
    });

    it('returns false for "none"', () => {
        assert.equal(PseudoBooleanLoose.from('none'), false);
    });

    it('returns false for "0"', () => {
        assert.equal(PseudoBooleanLoose.from('0'), false);
    });

    it('returns false for "no"', () => {
        assert.equal(PseudoBooleanLoose.from('no'), false);
    });

    it('returns false for "  false  " (with surrounding spaces)', () => {
        assert.equal(PseudoBooleanLoose.from('  false  '), false);
    });
});

describe('PseudoBooleanLoose.from: truthy string values', () => {
    it('returns true for "true"', () => {
        assert.equal(PseudoBooleanLoose.from('true'), true);
    });

    it('returns true for "yes"', () => {
        assert.equal(PseudoBooleanLoose.from('yes'), true);
    });

    it('returns true for "1"', () => {
        assert.equal(PseudoBooleanLoose.from('1'), true);
    });

    it('returns true for any unrecognized string like "hello"', () => {
        assert.equal(PseudoBooleanLoose.from('hello'), true);
    });

    it('returns true for a numeric-looking string like "42"', () => {
        assert.equal(PseudoBooleanLoose.from('42'), true);
    });

    it('returns true for a random non-empty string', () => {
        assert.equal(PseudoBooleanLoose.from('some-value'), true);
    });
});

describe('PseudoBooleanLoose.from: non-string non-boolean values', () => {
    it('throws TypeError for a number input', () => {
        assert.throws(() => PseudoBooleanLoose.from(42), TypeError);
    });

    it('throws TypeError for an object input', () => {
        assert.throws(() => PseudoBooleanLoose.from({}), TypeError);
    });

    it('throws TypeError for an array input', () => {
        assert.throws(() => PseudoBooleanLoose.from([]), TypeError);
    });
});

describe('PseudoBoolean.from: non-string non-boolean values', () => {
    it('throws TypeError for a number input', () => {
        assert.throws(() => PseudoBoolean.from(42), TypeError);
    });

    it('throws TypeError for an object input', () => {
        assert.throws(() => PseudoBoolean.from({}), TypeError);
    });

    it('throws TypeError for an array input', () => {
        assert.throws(() => PseudoBoolean.from([]), TypeError);
    });
});
