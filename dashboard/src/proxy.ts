import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    // Keep the query too: a garden deep link carries the note and chat state in
    // it, and dropping them lands the reader on the cluster root after login.
    loginUrl.searchParams.set(
      'callbackUrl',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Every authenticated surface belongs here, not just the reader. `/gardens` is
// a sibling of `/garden`, not a sub-path of it, so it needs its own entry —
// without one the workspace fell through to its own bare redirect and lost the
// callbackUrl, dropping "Back to garden" at the default page after login.
// `/pomodoro` is deliberately absent: it renders without a session. `/plan` is
// not — its board and its events belong to a user — so it is matched here.
// `/calendar` only redirects into `/plan` now, but it stays matched so an
// unauthenticated visit to an old bookmark logs in and comes back to it rather
// than bouncing through a redirect first. `:path*` is zero-or-more, so this
// covers the bare paths too.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/garden/:path*',
    '/gardens/:path*',
    '/agents/:path*',
    '/artifacts/:path*',
    '/workflows/:path*',
    '/plan/:path*',
    '/calendar/:path*',
    '/map/:path*',
  ],
};
