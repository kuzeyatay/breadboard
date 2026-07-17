/**
 * E2E tests validating the API's error response contract.
 *
 * Tests cover 400-class validation errors and verify the response shape
 * so consumers can rely on stable error field names.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAgent, crawl } from '../helpers/client';

describe('missing required fields', () => {
    it('returns 400 when neither url nor html is provided', async () => {
        const res = await getAgent()
            .post('/')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .send({});
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
        assert.strictEqual(typeof res.body.readableMessage, 'string');
        assert.ok(res.body.readableMessage.length > 0);
    });
});

describe('error response shape contract', () => {
    it('error responses include code, name, message, and readableMessage fields', async () => {
        // tokenBudget: 1 reliably triggers a 409 BudgetExceededError
        const res = await crawl({ tokenBudget: 1 });
        assert.ok(res.status >= 400, `Expected error status, got ${res.status}`);
        assert.strictEqual(typeof res.body.code, 'number');
        assert.strictEqual(typeof res.body.name, 'string');
        assert.strictEqual(typeof res.body.message, 'string');
        assert.strictEqual(typeof res.body.readableMessage, 'string');
    });

    it('error code matches the HTTP status class', async () => {
        const res = await crawl({ tokenBudget: 1 });
        const httpStatus: number = res.status;
        const codeClass = Math.floor(res.body.code / 100);
        assert.strictEqual(codeClass, Math.floor(httpStatus / 100));
    });
});

describe('invalid option values', () => {
    it('invalid retainImages value returns 400', async () => {
        const res = await crawl({ retainImages: 'invalid-mode' });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });

    it('invalid retainLinks value returns 400', async () => {
        const res = await crawl({ retainLinks: 'invalid-mode' });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.name, 'ParamValidationError');
    });

    it('invalid engine value omitted and returns 200', async () => {
        const res = await crawl({ engine: 'invalid-engine' });
        assert.strictEqual(res.status, 200);
    });
});
