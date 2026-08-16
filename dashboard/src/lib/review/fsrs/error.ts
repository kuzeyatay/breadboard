// Vendored from ts-fsrs — DO NOT EDIT BY HAND.
// Upstream: https://github.com/open-spaced-repetition/ts-fsrs (MIT)
// Version:  5.4.1
// Commit:   cdec8d2f8340f8e62ced596c1da02e20e70073f0 (2026-06-25)
// Regenerate with: node dashboard/scripts/vendor-fsrs.mjs

export class FSRSError extends Error {
  constructor(message: string = 'FSRS Error') {
    super(message)
    this.name = 'FSRSError'
    Error.captureStackTrace?.(this, FSRSError)
  }
}

export class FSRSValidationError extends FSRSError {
  constructor(message?: string) {
    super(message)
    this.name = 'FSRSValidationError'
    Error.captureStackTrace?.(this, FSRSValidationError)
  }
}

export class FSRSOperationError extends FSRSError {
  constructor(message?: string) {
    super(message)
    this.name = 'FSRSOperationError'
    Error.captureStackTrace?.(this, FSRSOperationError)
  }
}
