export type ComposerMode = 'goal' | 'plan-mode';

const LEADING_COMMANDS = /^(?:\/[a-z0-9][a-z0-9_.:-]*(?:\s+|$))+/i;

export function composerMode(value: string): ComposerMode | null {
  const commands = value.match(LEADING_COMMANDS)?.[0].trim().split(/\s+/) ?? [];
  if (commands.includes('/plan-mode')) return 'plan-mode';
  if (commands.includes('/goal')) return 'goal';
  return null;
}

/** Modes travel with the draft through the normal send, queue and restore paths. */
export function toggleComposerMode(value: string, mode: ComposerMode): string {
  const leading = value.match(LEADING_COMMANDS)?.[0] ?? '';
  const otherCommands = leading.trim().split(/\s+/)
    .filter((token) => token && token !== '/goal' && token !== '/plan-mode');
  const body = value.slice(leading.length);
  const commands = composerMode(value) === mode ? otherCommands : [`/${mode}`, ...otherCommands];
  return commands.length ? `${commands.join(' ')} ${body}` : body;
}
