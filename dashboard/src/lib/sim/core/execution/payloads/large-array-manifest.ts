// Breadboard stand-in for sim's lib/execution/payloads/large-array-manifest.ts
// (simstudioai/sim, Apache-2.0). Sim chunks oversized arrays into a paginated
// manifest backed by blob storage. Breadboard's `storeLargeValue` never
// produces a manifest (see store.ts), so nothing in the vendored executor ever
// calls the read/write functions below in practice — they exist as
// throwing stand-ins so the (currently dead) call sites still type-check.

export {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_MARKER,
  type LargeArrayManifest,
} from '@/lib/sim/core/execution/payloads/large-array-manifest-metadata'
import type { LargeValueStoreContext } from '@/lib/sim/core/execution/payloads/store'

export interface LargeArrayManifestReadOptions extends LargeValueStoreContext {}
export interface LargeArrayManifestWriteOptions extends LargeValueStoreContext {}

import type { LargeArrayManifest } from '@/lib/sim/core/execution/payloads/large-array-manifest-metadata'

const UNSUPPORTED = 'Large array manifests are not supported in Breadboard’s engine'

export async function createLargeArrayManifest(
  _items: unknown[],
  _context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifest> {
  throw new Error(UNSUPPORTED)
}

export async function appendLargeArrayManifest(
  _manifest: LargeArrayManifest,
  _items: unknown[],
  _context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifest> {
  throw new Error(UNSUPPORTED)
}

export async function readLargeArrayManifestSlice(
  _manifest: LargeArrayManifest,
  _start: number,
  _limit: number,
  _context: LargeArrayManifestReadOptions
): Promise<unknown[]> {
  throw new Error(UNSUPPORTED)
}

export async function materializeLargeArrayManifest(
  _manifest: LargeArrayManifest,
  _context: LargeArrayManifestReadOptions
): Promise<unknown[]> {
  throw new Error(UNSUPPORTED)
}
