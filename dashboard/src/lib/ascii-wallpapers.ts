import slugs from './ascii-piece-slugs.json' with { type: 'json' };

const pieces = new Set(slugs);
export function asciiWallpaperSlug(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('ascii:')) return null;
  const slug = value.slice(6);
  return pieces.has(slug) ? slug : null;
}
export function asciiWallpaperId(slug: string): string {
  if (!pieces.has(slug)) throw new Error('Unknown ASCII background.');
  return `ascii:${slug}`;
}
