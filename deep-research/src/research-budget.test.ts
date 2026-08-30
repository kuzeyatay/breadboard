import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultResearchBudgets } from './deep-research';

describe('research budgets', () => {
  it('funds the default follow-up round instead of truncating it as partial', () => {
    const budget = defaultResearchBudgets(4, 2);
    assert.equal(budget.maxSearches, 12);
    assert.equal(budget.maxModelCalls, 13);
    assert.equal(budget.maxSources, 60);
  });

  it('bounds the old breadth/depth controls instead of expanding recursively', () => {
    const budget = defaultResearchBudgets(10, 5);
    assert.equal(budget.maxSearches, 40);
    assert.equal(budget.maxModelCalls, 41);
    assert.equal(budget.maxSources, 100);
    assert.equal(budget.maxTokens, 180_000);
  });

  it('accepts explicit smaller run budgets and clamps unsafe values', () => {
    const budget = defaultResearchBudgets(3, 3, {
      maxSearches: 2,
      maxModelCalls: 3,
      maxSources: 4,
      maxTokens: 900,
      maxDurationMs: 500,
      maxNoProgressBranches: 0,
    });
    assert.deepEqual(budget, {
      maxSearches: 2,
      maxModelCalls: 3,
      maxSources: 4,
      maxTokens: 1_000,
      maxDurationMs: 1_000,
      maxNoProgressBranches: 1,
    });
  });
});
