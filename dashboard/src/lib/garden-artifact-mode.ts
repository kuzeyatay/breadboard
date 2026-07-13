// Fix 5: explicit garden-directory classification so a LIVE generated artifact is
// never silently used as an immutable test expectation.
//
//   runtime_generated     — production output (e.g. quartz/content/<slug>); may be
//                           rewritten by generation; must NOT be a unit-test
//                           baseline; only opt-in integration tests may inspect it.
//   immutable_fixture     — a committed, deterministic garden under a fixtures
//                           directory; never rewritten by production generation.
//   temporary_test_fixture — created under a temp dir inside a test and deleted.

export type GardenArtifactMode =
  | "runtime_generated"
  | "immutable_fixture"
  | "temporary_test_fixture";

const FIXTURE_DIR_MARKER = /[\\/]tests[\\/]fixtures[\\/]/;
const RUNTIME_DIR_MARKER = /[\\/]quartz[\\/]content[\\/]/;

/** Classify a garden directory by its path. A temp-dir prefix (from mkdtemp) is
 * treated as a temporary test fixture. */
export function classifyGardenArtifact(gardenDir: string, opts: { tempRoot?: string } = {}): GardenArtifactMode {
  const normalized = gardenDir.replace(/\\/g, "/");
  const tempRoot = (opts.tempRoot ?? "").replace(/\\/g, "/");
  if (FIXTURE_DIR_MARKER.test(gardenDir)) return "immutable_fixture";
  if (tempRoot && normalized.startsWith(tempRoot.replace(/\\/g, "/"))) return "temporary_test_fixture";
  if (/(^|\/)(tmp|temp)([/-]|$)/i.test(normalized) || /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(gardenDir)) {
    return "temporary_test_fixture";
  }
  if (RUNTIME_DIR_MARKER.test(gardenDir)) return "runtime_generated";
  return "runtime_generated";
}

/** True when the mode's garden must never be treated as an immutable test
 * baseline (production generation may rewrite it). */
export function isMutableRuntimeGarden(mode: GardenArtifactMode): boolean {
  return mode === "runtime_generated";
}

/** Opt-in flag for integration tests that validate a live generated garden. The
 * default deterministic unit suite leaves these skipped so a regenerated garden
 * cannot corrupt the baseline. */
export function liveGardenTestsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
