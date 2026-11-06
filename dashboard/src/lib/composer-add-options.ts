export interface ComposerAppConnection {
  slug: string;
  name: string;
  logoUrl?: string;
  connected?: boolean;
}

export function connectionPresentation(connection: ComposerAppConnection): { description: string } {
  const name = `${connection.slug} ${connection.name}`.toLowerCase();
  if (/calendar/.test(name)) return { description: 'Work with your events and schedule' };
  if (/gmail|outlook|mail/.test(name)) return { description: 'Read, organize and draft email' };
  if (/github/.test(name)) return { description: 'Work with repositories, issues and pull requests' };
  return { description: `Use your connected ${connection.name} account` };
}

export function matchesAddQuery(query: string, ...text: Array<string | undefined>): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.filter(Boolean).join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

/** App accounts belong here only when they are not already offered by slash. */
export function uniqueAddConnections(apps: ComposerAppConnection[], slashConnections: Array<{
  slug: string; name: string; installed?: boolean; enabled?: boolean; healthy?: boolean;
}>): ComposerAppConnection[] {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slashKeys = new Set(slashConnections
    .filter(item => item.installed !== false && item.enabled !== false && item.healthy !== false)
    .flatMap(item => [normalize(item.slug), normalize(item.name)]));
  return apps.filter(app => app.connected && !slashKeys.has(normalize(app.slug)) && !slashKeys.has(normalize(app.name)));
}
