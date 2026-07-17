/**
 * Unit tests for ProxyProviderService error contract.
 *
 * The service must throw `ServiceBadApproachError` (not the more generic
 * `AssertionFailureError`) when no proxy provider can serve a request.
 * The crawler's `@retryWith` handler keys off this exact class to stop
 * retrying — see `sideLoadWithAllocatedProxy` in `src/api/crawler.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyProviderService } from '../../build/services/proxy-provider/index.js';
import { ServiceBadApproachError, ServiceBadAttemptError } from '../../build/services/errors.js';

function mkService(): ProxyProviderService {
    // EnvConfig is only read during init(); these tests skip init() and
    // exercise behavior with an empty `clients` array directly.
    const fakeEnvConfig: any = {};
    return new ProxyProviderService(fakeEnvConfig);
}

describe('ProxyProviderService.alloc — no clients', () => {
    it('throws ServiceBadApproachError when no provider supports the country', async () => {
        const svc = mkService();
        await assert.rejects(() => svc.alloc('us'), (err: unknown) => {
            assert.ok(err instanceof ServiceBadApproachError,
                `expected ServiceBadApproachError, got ${(err as Error)?.constructor?.name}`);
            return true;
        });
    });

    it('thrown error is also a ServiceBadAttemptError (parent class)', async () => {
        // ServiceBadApproachError extends ServiceBadAttemptError; downstream
        // `err instanceof ServiceBadAttemptError` checks must keep working.
        const svc = mkService();
        await assert.rejects(() => svc.alloc('us'), (err: unknown) => {
            assert.ok(err instanceof ServiceBadAttemptError);
            return true;
        });
    });

    it('error message names the country code that was requested', async () => {
        const svc = mkService();
        await assert.rejects(() => svc.alloc('zz'), (err: unknown) => {
            assert.match((err as Error).message, /zz/);
            return true;
        });
    });
});

describe('ProxyProviderService.loopClients — no clients', () => {
    it('throws ServiceBadApproachError when invoked with an empty client list', () => {
        const svc = mkService();
        assert.throws(() => {
            const it = svc.loopClients();
            it.next();
        }, ServiceBadApproachError);
    });
});
