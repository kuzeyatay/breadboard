// Vendored from simstudioai/sim (Apache-2.0), apps/sim/tools/errors.ts —
// adapted for Breadboard: HttpError base class inlined (sim's version imports
// it from @/lib/core/utils/http-error, a first-party module not vendored).

/** Base class for errors that carry an HTTP status code. */
export class HttpError extends Error {
  statusCode?: number;
  constructor(message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Hosted-key acquisition blocked by the workspace's own rate bucket. Kept for
 * source parity with sim's tool configs that reference it; Breadboard's
 * executor never triggers hosted-key acquisition, so this never throws here.
 */
export class HostedKeyRateLimitedError extends HttpError {
  readonly statusCode = 429;

  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HostedKeyRateLimitedError";
  }
}

/** No hosted keys are configured or available for this provider. */
export class HostedKeyUnavailableError extends HttpError {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "HostedKeyUnavailableError";
  }
}
