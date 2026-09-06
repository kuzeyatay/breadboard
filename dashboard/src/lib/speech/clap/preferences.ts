export type GestureControl = 'clap' | 'snap';
export const controlQuery = (control: GestureControl) => control === 'snap' ? '?control=snap' : '';
export interface ClapPreferences {
  version: 1;
  enabled: boolean;
  resumeOnStartup: boolean;
  allowConcurrentListening: boolean;
  deviceId: string;
  sensitivity: number;
  pattern: 'single' | 'double';
}

export const DEFAULT_CLAP_PREFERENCES: ClapPreferences = {
  version: 1, enabled: false, resumeOnStartup: false, allowConcurrentListening: false, deviceId: '', sensitivity: 0.55, pattern: 'double',
};
export const DEFAULT_SNAP_PREFERENCES: ClapPreferences = { ...DEFAULT_CLAP_PREFERENCES, pattern: 'single', sensitivity: .65 };

export function parseClapPreferences(value: unknown): ClapPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !Object.hasOwn(DEFAULT_CLAP_PREFERENCES, k)) ||
    p.version !== 1 || typeof p.enabled !== 'boolean' || typeof p.resumeOnStartup !== 'boolean' ||
    (p.allowConcurrentListening !== undefined && typeof p.allowConcurrentListening !== 'boolean') ||
    typeof p.deviceId !== 'string' || p.deviceId.length > 256 ||
    typeof p.sensitivity !== 'number' || !Number.isFinite(p.sensitivity) || p.sensitivity < 0 || p.sensitivity > 1 ||
    (p.pattern !== 'single' && p.pattern !== 'double')) return null;
  return { version: 1, enabled: p.enabled, resumeOnStartup: p.resumeOnStartup, deviceId: p.deviceId,
    allowConcurrentListening: p.allowConcurrentListening === true, sensitivity: p.sensitivity, pattern: p.pattern };
}

/** Never inherit the old implicit localStorage opt-in, even on a reused port. */
export function migrateClapPreferences(value: unknown, control: GestureControl = 'clap'): ClapPreferences {
  return parseClapPreferences(value) ?? { ...(control === 'snap' ? DEFAULT_SNAP_PREFERENCES : DEFAULT_CLAP_PREFERENCES) };
}

export function trustedClapPath(path: string): boolean {
  return !/^\/(?:api|voice|notification-overlay|preview|login|register|auth|share|embed)(?:\/|$)/.test(path) &&
    !path.startsWith('/workflows/teach-controller');
}
