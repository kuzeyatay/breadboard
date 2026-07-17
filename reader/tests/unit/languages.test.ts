/**
 * Unit tests for the bcp47ToIso639_3 language tag converter.
 *
 * This pure function maps BCP-47 language tags (e.g. 'en-US') to
 * ISO 639-3 codes (e.g. 'eng'), falling back to 'und' for unknowns.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bcp47ToIso639_3 } from '../../build/utils/languages.js';

// ---------------------------------------------------------------------------
// Known mappings
// ---------------------------------------------------------------------------

describe('bcp47ToIso639_3: English variants', () => {
    it('maps en → eng', () => assert.equal(bcp47ToIso639_3('en'), 'eng'));
    it('maps en-US → eng', () => assert.equal(bcp47ToIso639_3('en-US'), 'eng'));
    it('maps en-GB → eng', () => assert.equal(bcp47ToIso639_3('en-GB'), 'eng'));
    it('maps en-AU → eng', () => assert.equal(bcp47ToIso639_3('en-AU'), 'eng'));
});

describe('bcp47ToIso639_3: Spanish variants', () => {
    it('maps es → spa', () => assert.equal(bcp47ToIso639_3('es'), 'spa'));
    it('maps es-MX → spa', () => assert.equal(bcp47ToIso639_3('es-MX'), 'spa'));
    it('maps es-AR → spa', () => assert.equal(bcp47ToIso639_3('es-AR'), 'spa'));
});

describe('bcp47ToIso639_3: other major languages', () => {
    it('maps fr → fra', () => assert.equal(bcp47ToIso639_3('fr'), 'fra'));
    it('maps fr-FR → fra', () => assert.equal(bcp47ToIso639_3('fr-FR'), 'fra'));
    it('maps de → deu', () => assert.equal(bcp47ToIso639_3('de'), 'deu'));
    it('maps zh-CN → cmn', () => assert.equal(bcp47ToIso639_3('zh-CN'), 'cmn'));
    it('maps zh-TW → cmn', () => assert.equal(bcp47ToIso639_3('zh-TW'), 'cmn'));
    it('maps ja → jpn', () => assert.equal(bcp47ToIso639_3('ja'), 'jpn'));
    it('maps ko → kor', () => assert.equal(bcp47ToIso639_3('ko'), 'kor'));
    it('maps ar → ara', () => assert.equal(bcp47ToIso639_3('ar'), 'ara'));
    it('maps pt → por', () => assert.equal(bcp47ToIso639_3('pt'), 'por'));
    it('maps ru → rus', () => assert.equal(bcp47ToIso639_3('ru'), 'rus'));
});

// ---------------------------------------------------------------------------
// Fallback behaviour
// ---------------------------------------------------------------------------

describe('bcp47ToIso639_3: fallback to "und"', () => {
    it('returns und for an unknown tag', () => {
        assert.equal(bcp47ToIso639_3('xx-XX'), 'und');
    });

    it('returns und for an empty string', () => {
        assert.equal(bcp47ToIso639_3(''), 'und');
    });

    it('returns und when called with no argument (undefined)', () => {
        assert.equal(bcp47ToIso639_3(undefined as any), 'und');
    });

    it('returns und for a gibberish string', () => {
        assert.equal(bcp47ToIso639_3('not-a-language'), 'und');
    });
});

// ---------------------------------------------------------------------------
// Case sensitivity
// ---------------------------------------------------------------------------

describe('bcp47ToIso639_3: case sensitivity', () => {
    it('lowercased known tags also map correctly (en-us → eng)', () => {
        // The module adds lowercase copies of all keys at init time
        assert.equal(bcp47ToIso639_3('en-us'), 'eng');
    });

    it('fully uppercase tag EN does NOT match (mapping is case-sensitive on the base key)', () => {
        // 'EN' is never in the mapping (only 'en' and 'en-us', not 'EN')
        assert.equal(bcp47ToIso639_3('EN'), 'und');
    });
});
