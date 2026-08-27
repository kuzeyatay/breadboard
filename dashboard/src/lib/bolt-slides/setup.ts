// Read-only Bolt Slides setup status. The authenticated Runtime V2 setup job
// owns dependency installation under the Runtime data root.

import { kitDigest } from "./kit-digest.ts";
import { boltSlidesAvailability } from "./runtime.ts";

export interface BoltSlidesSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; missing: string[] };
  kit: { components: number; tokens: number };
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): BoltSlidesSetupStatus {
  const availability = boltSlidesAvailability(env);
  const digest = availability.cloned ? kitDigest() : null;
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    dependencies: { installed: availability.installed, missing: availability.missing },
    kit: {
      components: digest?.components.length ?? 0,
      tokens: digest?.tokens.length ?? 0,
    },
  };
}
