// Keep this helper inside the dashboard's Turbopack root. The redirect contract
// is also used by desktop/src/shared/auth-navigation.ts; auth-navigation.test.mjs
// checks both implementations against the same destinations.
export function authReturnPath(
  value: string | null | undefined,
  origin: string,
  fallback = "/dashboard",
): string {
  try {
    const url = new URL(value || fallback, origin);
    if (
      url.origin !== new URL(origin).origin || url.username || url.password ||
      url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")
    ) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
