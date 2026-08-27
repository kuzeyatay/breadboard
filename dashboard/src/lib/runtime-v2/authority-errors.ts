import "server-only";

import { NextResponse } from "next/server";
import {
  RuntimeJobControlError,
  SupervisorResourceExhaustedError,
} from "../supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

export { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

/** Shared secret-free response shape for service leases and finite jobs. */
export function runtimeAuthorityErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SupervisorResourceExhaustedError) {
    return NextResponse.json(
      { ok: false, error: error.message, ...error.result },
      { status: 503 },
    );
  }
  if (error instanceof RuntimeJobControlError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        code: error.code,
        retryable: error.retryable,
        ...(error.resource ? { resource: error.resource } : {}),
        ...(error.requiredHeadroomMb === null
          ? {}
          : { requiredHeadroomMb: error.requiredHeadroomMb }),
        ...(error.availableHeadroomMb === null
          ? {}
          : { availableHeadroomMb: error.availableHeadroomMb }),
      },
      { status: error.status },
    );
  }
  if (error instanceof RuntimeAuthorityUnavailableError) {
    return NextResponse.json(
      { ok: false, error: error.code },
      { status: error.status },
    );
  }
  return null;
}
