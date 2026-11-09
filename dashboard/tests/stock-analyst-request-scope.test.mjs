import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {restrictsExternalResearch} from '../src/lib/research/scope.ts';

test('supplied Stock Analyst figures cannot enable retrieval through the chat adapter',()=>{
  const task='Analyze fictional Acorn: revenue 1000 EUR, income 100 EUR, debt 200 EUR. Use no real ticker or market lookup. Do not install packages, browse, or access private accounts.';
  assert.equal(restrictsExternalResearch(task),true);
  const adapter=fs.readFileSync(new URL('../src/lib/stock-analyst/run-manager.ts',import.meta.url),'utf8');
  assert.match(adapter,/allow_external_data:\s*!restrictsExternalResearch\(run\.task\)/);
});

test('ordinary Stock Analyst research stays available',()=>{
  assert.equal(restrictsExternalResearch('Analyze companies serving customers with no internet access.'),false);
  assert.equal(restrictsExternalResearch('Research MSFT using current public market data.'),false);
});
