/** Durable content has no age limit. These limits apply only to owned overhead. */
export const STORAGE_POLICY = Object.freeze({
  version: 1,
  idleMs: 120_000,
  sliceMs: 250,
  ioBytesPerSecond: 10 * 1024 * 1024,
  reserveBytes: 2 * 1024 ** 3,
  coldDays: 7,
  temporaryDays: 7,
  logDays: 10,
  logBytes: 250 * 1024 ** 2,
  minimumPayloadBytes: 16 * 1024,
  chunkBytes: 4 * 1024 ** 2,
  cacheBytes: 64 * 1024 ** 2,
  minimumSaving: 0.1,
});

export const DAY_MS = 86_400_000;

export interface StorageMaintenanceResult {
  startedAt: number;
  finishedAt: number;
  filesRemoved: number;
  bytesReleased: number;
  payloadBytesSaved: number;
  skipped: string[];
}

export function eligibleForMaintenance(input: {
  automatic: boolean; manual?: boolean; idleMs: number; foregroundBusy: boolean;
}): boolean {
  return (input.automatic || input.manual === true) && !input.foregroundBusy
    && (input.manual === true || input.idleMs >= STORAGE_POLICY.idleMs);
}
