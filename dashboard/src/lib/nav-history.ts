'use client';

// Where "back" should go is a question about the user's path, not about the
// route tree. Garden chat and Quartz are reachable from the dashboard, from
// each other, from the PDF viewer and from search, so a hard-coded parent link
// sends people somewhere they were never standing. This keeps a short trail of
// the in-app locations actually visited in this tab so a back control can
// return to the previous *different* page instead of an assumed parent.

const STORAGE_KEY = 'breadboard:nav-trail';
const MAX_ENTRIES = 20;

/** Never offer these as a back target — landing there is worse than the fallback. */
const EXCLUDED_PREFIXES = ['/auth/', '/api/'];

function isExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function parse(href: string): URL | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(href, window.location.origin);
  } catch {
    return null;
  }
}

/**
 * An in-app href of the form `/path?query`.
 *
 * Anything that is not a root-relative path or an absolute http(s) URL is
 * rejected outright: `new URL` happily resolves arbitrary junk against the
 * origin, which would otherwise turn a malformed string into a back target.
 */
function normalize(href: string): string | null {
  if (!href.startsWith('/') && !/^https?:\/\//i.test(href)) return null;
  const url = parse(href);
  if (!url) return null;
  if (url.origin !== window.location.origin) return null;
  if (isExcluded(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}

function readTrail(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeTrail(trail: string[]): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail.slice(-MAX_ENTRIES)));
  } catch {
    // Private-mode or quota failures only cost us the smarter back target.
  }
}

const listeners = new Set<() => void>();

/** Subscribe to trail changes; pairs with `resolveBackHref` in `useSyncExternalStore`. */
export function subscribeToTrail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record the location the user is standing on. Safe to call on every route change. */
export function recordVisit(href: string): void {
  const normalized = normalize(href);
  if (!normalized) return;

  const trail = readTrail();
  if (trail[trail.length - 1] === normalized) return;
  trail.push(normalized);
  writeTrail(trail);
  for (const listener of listeners) listener();
}

/**
 * The previous page whose pathname differs from the current one, so that moving
 * around inside a single surface (opening notes in a garden, switching a query
 * param) never becomes its own back target. Falls back to `fallbackHref` when
 * the trail cannot answer — a deep link, a reload into a fresh tab, or a trail
 * that only ever saw this pathname.
 */
export function resolveBackHref(currentHref: string, fallbackHref: string): string {
  const current = parse(currentHref);
  if (!current) return fallbackHref;

  const trail = readTrail();
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const candidate = parse(trail[index]);
    if (!candidate) continue;
    if (candidate.pathname === current.pathname) continue;
    return `${candidate.pathname}${candidate.search}`;
  }

  return fallbackHref;
}

const LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^\/dashboard(?:\/|$)/, label: 'Back to dashboard' },
  { match: /^\/gardens\/[^/]+\/pdf(?:\/|$)/, label: 'Back to PDF' },
  { match: /^\/gardens\/[^/]+(?:\/|$)/, label: 'Back to garden chat' },
  { match: /^\/garden\/[^/]+(?:\/|$)/, label: 'Back to garden' },
  { match: /^\/garden(?:\/|$)/, label: 'Back to library' },
  { match: /^\/clusters(?:\/|$)/, label: 'Back to gardens' },
  { match: /^\/calendar(?:\/|$)/, label: 'Back to calendar' },
  { match: /^\/profile(?:\/|$)/, label: 'Back to profile' },
  { match: /^\/skills(?:\/|$)/, label: 'Back to skills' },
  { match: /^\/settings(?:\/|$)/, label: 'Back to settings' },
];

/** A label describing where the resolved back target actually lands. */
export function backLabelFor(href: string, fallbackLabel: string): string {
  const url = parse(href);
  if (!url) return fallbackLabel;
  return LABELS.find((entry) => entry.match.test(url.pathname))?.label ?? 'Back';
}
