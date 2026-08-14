// Which CAD backend a build runs on.
//
// Deliberately its own module rather than a field buried in `types.ts`: the
// settings catalog, the Hardware Blueprint flag parser and the CAD tool
// contracts all need this vocabulary, and two of those are imported by client
// components. Nothing here touches the database, the filesystem, or a process.
//
// `auto` is not an engine. It is the absence of a choice, resolved to one at
// the moment a build is requested — see `resolveCadEngine`.

export const CAD_ENGINE_IDS = ["cadquery", "solidworks"] as const;

export type CadEngineId = (typeof CAD_ENGINE_IDS)[number];

/** What a saved setting or a `--cad` flag can say. */
export type CadBackendPreference = "auto" | CadEngineId;

export const CAD_BACKEND_PREFERENCES = ["auto", ...CAD_ENGINE_IDS] as const;

/** The engine every caller that says nothing gets, now and after this change. */
export const DEFAULT_CAD_ENGINE: CadEngineId = "cadquery";

export function isCadEngineId(value: unknown): value is CadEngineId {
  return typeof value === "string" && (CAD_ENGINE_IDS as readonly string[]).includes(value);
}

export function isCadBackendPreference(value: unknown): value is CadBackendPreference {
  return (
    typeof value === "string" && (CAD_BACKEND_PREFERENCES as readonly string[]).includes(value)
  );
}

export function cadEngineLabel(engine: CadEngineId): string {
  return engine === "solidworks" ? "SolidWorks" : "Parametric CAD (CadQuery)";
}

/**
 * How a run's backend is decided, in one place.
 *
 * Precedence, highest first:
 *   1. the `--cad` flag typed into this message,
 *   2. a backend the structured brief itself requires,
 *   3. the saved Hardware Blueprint preference,
 *   4. the default engine.
 *
 * `explicit` is what separates "the user asked for SolidWorks" from "nothing
 * said otherwise, so CadQuery". An explicit choice may never be silently
 * replaced by a fallback; an automatic one may.
 */
export interface CadEngineChoice {
  engine: CadEngineId;
  explicit: boolean;
  /** Which input decided it, for the run log. */
  source: "flag" | "brief" | "setting" | "default";
}

export function resolveCadEngine(input: {
  /** `--cad <backend>` from this message. Null when it was not typed. */
  flag?: CadBackendPreference | null;
  /** A backend the structured brief explicitly requires. */
  brief?: CadEngineId | null;
  /** The saved Hardware Blueprint preference. */
  setting?: CadBackendPreference | null;
}): CadEngineChoice {
  if (isCadEngineId(input.flag)) return { engine: input.flag, explicit: true, source: "flag" };
  // `--cad auto` is itself a decision: it asks for automatic selection for this
  // one message, so it outranks a saved preference without being explicit
  // about which engine runs.
  if (input.flag === "auto") {
    return { engine: DEFAULT_CAD_ENGINE, explicit: false, source: "flag" };
  }
  if (isCadEngineId(input.brief)) return { engine: input.brief, explicit: true, source: "brief" };
  if (isCadEngineId(input.setting)) {
    return { engine: input.setting, explicit: true, source: "setting" };
  }
  return { engine: DEFAULT_CAD_ENGINE, explicit: false, source: "default" };
}
