const DEFAULT_QUARTZ_BASE_URL = 'http://localhost:8081';

export const QUARTZ_BASE_URL = (
  process.env.NEXT_PUBLIC_QUARTZ_URL ?? DEFAULT_QUARTZ_BASE_URL
).replace(/\/+$/, '');

export function quartzUrl(...segments: string[]): string {
  const path = segments
    .map((segment) => segment.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  return path ? `${QUARTZ_BASE_URL}/${path}/` : `${QUARTZ_BASE_URL}/`;
}
