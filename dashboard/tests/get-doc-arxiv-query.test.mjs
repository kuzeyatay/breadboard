import assert from 'node:assert/strict';
import test from 'node:test';
import {arxivUrl} from '../src/lib/get-doc/sources.ts';

test('arXiv retains every keyword as an explicit conjunction rather than a loose single-term match', () => {
  const query = text => new URL(arxivUrl({query:text,limit:5,openAccessOnly:false,yearFrom:null,yearTo:null})).searchParams.get('search_query');
  assert.equal(query('quantum error correction'), 'all:quantum AND all:error AND all:correction');
  assert.equal(query('low-resource multilingual models'), 'all:low-resource AND all:multilingual AND all:models');
  assert.equal(query('énergie solaire'), 'all:énergie AND all:solaire');
  assert.equal(query('ti:password OR all:secret'), 'all:ti AND all:password AND all:OR AND all:all AND all:secret');
});
