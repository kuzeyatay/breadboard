const DEFAULT_QUARTZ_BASE_URL = 'http://localhost:8081';
const LOCAL_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i;

function normalizeAbsoluteUrl(value?: string | null): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function deriveQuartzBaseUrlFromDashboard(value?: string | null): string | null {
  const dashboardUrl = normalizeAbsoluteUrl(value);
  if (!dashboardUrl) return null;

  try {
    const url = new URL(dashboardUrl);
    if (LOCAL_HOST_RE.test(url.hostname)) {
      return `${url.protocol}//${url.hostname}:8081`;
    }
    return `${url.protocol}//garden.${url.host}`;
  } catch {
    return null;
  }
}

function runtimeQuartzBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const current = new URL(window.location.href);
    if (/^garden\./i.test(current.hostname)) {
      return current.origin.replace(/\/+$/, '');
    }
    if (LOCAL_HOST_RE.test(current.hostname)) {
      return `${current.protocol}//${current.hostname}:8081`;
    }
    return `${current.protocol}//garden.${current.host}`;
  } catch {
    return null;
  }
}

/**
 * The Quartz URL of THIS launch, read from the server's live environment.
 *
 * Runtime V2 gives Quartz a fresh loopback port on every app launch, but the
 * desktop dashboard is a prebuilt standalone bundle: any literal
 * `process.env.NEXT_PUBLIC_QUARTZ_URL` was replaced at build time with the
 * port of whatever launch built it. The computed key below is not statically
 * resolvable, so the bundler leaves it as a real runtime lookup and the server
 * sees the environment Runtime V2 actually injected. Client bundles have no
 * process env; they must receive the resolved base from a Server Component.
 */
function runtimeInjectedQuartzBaseUrl(): string | null {
  if (typeof window !== 'undefined' || typeof process === 'undefined') return null;
  for (const name of ['BREADBOARD_QUARTZ_RUNTIME_URL', 'NEXT_PUBLIC_QUARTZ_URL']) {
    const value = normalizeAbsoluteUrl(process.env[name]);
    if (value) return value;
  }
  return null;
}

export function resolveQuartzBaseUrl(): string {
  return (
    runtimeInjectedQuartzBaseUrl() ??
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_QUARTZ_URL) ??
    deriveQuartzBaseUrlFromDashboard(
      process.env.NEXT_PUBLIC_DASHBOARD_URL ?? process.env.DASHBOARD_URL,
    ) ??
    runtimeQuartzBaseUrl() ??
    DEFAULT_QUARTZ_BASE_URL
  );
}

export const QUARTZ_BASE_URL = resolveQuartzBaseUrl();

type QuartzTheme = 'light' | 'dark';

function isQuartzTheme(value: unknown): value is QuartzTheme {
  return value === 'light' || value === 'dark';
}

export function quartzUrlWithTheme(url: string, theme: unknown): string {
  if (!isQuartzTheme(theme)) return url;

  try {
    const themedUrl = new URL(url);
    themedUrl.searchParams.set('theme', theme);
    return themedUrl.toString();
  } catch {
    return url;
  }
}

/**
 * Seed Quartz with the dashboard theme before its first paint. The regular
 * postMessage bridge still keeps an already-loaded frame in sync when the
 * user changes themes later.
 */
export function quartzUrlWithAppTheme(url: string): string {
  if (typeof document === 'undefined') return url;
  return quartzUrlWithTheme(url, document.documentElement.dataset.theme);
}

export function quartzUrl(...segments: string[]): string {
  return quartzUrlFromBase(resolveQuartzBaseUrl(), ...segments);
}

/**
 * Build a Quartz page URL against an explicitly provided base. Client
 * components must use this with a server-resolved base (passed down as a
 * prop): their own bundle only carries the build-time NEXT_PUBLIC_QUARTZ_URL,
 * which does not know the port Runtime V2 gave Quartz on this launch.
 */
export function quartzUrlFromBase(baseUrl: string, ...segments: string[]): string {
  const base = normalizeAbsoluteUrl(baseUrl) ?? resolveQuartzBaseUrl();
  const path = segments
    .map((segment) => segment.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  return path ? `${base}/${path}/` : `${base}/`;
}
