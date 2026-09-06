import { RouteError } from '@/lib/server-auth';

/** Validate the browser-facing authority, rather than Next.js's bind address. */
export function requireSameOrigin(request: Request, message: string): void {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RouteError(403, message);
  if (!origin) return;

  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host') || url.host;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || url.protocol.slice(0, -1);
  let expectedOrigin: string | undefined;
  try {
    const address = new URL(`${protocol}://${host}`);
    if (['http:', 'https:'].includes(address.protocol) && !address.username && !address.password
      && address.pathname === '/' && !address.search && !address.hash) {
      expectedOrigin = address.origin;
    }
  } catch { /* Malformed request authorities fail the origin check below. */ }
  if (origin !== expectedOrigin) throw new RouteError(403, message);
}
