// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/core/utils/request.ts; adapted for Breadboard.
import { getRequestContext } from '@/lib/sim/core/logger'
import { generateId } from '@/lib/sim/core/utils/id'
/**
 * Generate a short request ID for correlation. If called inside a request
 * context (see `withRouteHandler` and `runWithRequestContext`), returns the
 * active request's ID so inline `[${requestId}]` log prefixes align with
 * the auto-attached `{requestId=...}` logger metadata.
 */
export function generateRequestId(): string {
  return getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

/**
 * Extract the client IP from a request, checking `x-forwarded-for` then `x-real-ip`.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}
