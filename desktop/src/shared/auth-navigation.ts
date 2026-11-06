/** Auth redirects are temporary; only local application destinations survive. */
export function authReturnPath(value: string | null | undefined, origin: string, fallback = "/dashboard"): string {
  try {
    const url = new URL(value || fallback, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password ||
        url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

export function isAuthenticationUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin && url.pathname.startsWith("/auth/");
  } catch { return false; }
}
