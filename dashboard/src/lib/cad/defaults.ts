// Editable defaults for parts the agent designs.
//
// These are starting points that a competent maker would recognise, not
// universal engineering facts: a 0.3 mm clearance is right for a well-tuned
// 0.4 mm-nozzle FDM printer and wrong for a resin printer or a worn machine.
// Every value used in a design is written into the design specification with
// `source: "default"`, so the user can see which numbers they never chose.
//
// Overrides come from the environment, so a workshop with one printer can set
// its own numbers once instead of restating them in every prompt.

import type { ManufacturingProcess } from "./types.ts";

export interface CadDefaults {
  units: "mm";
  defaultWallThickness: number;
  generalClearance: number;
  pressFitClearance: number;
  slidingFitClearance: number;
  minimumFeatureSize: number;
  maximumUnsupportedOverhangDegrees: number;
  printerBed: { x: number; y: number; z: number };
}

const FDM: CadDefaults = {
  units: "mm",
  defaultWallThickness: 2.4,
  generalClearance: 0.3,
  pressFitClearance: 0.15,
  slidingFitClearance: 0.35,
  minimumFeatureSize: 0.8,
  maximumUnsupportedOverhangDegrees: 45,
  printerBed: { x: 220, y: 220, z: 250 },
};

// Resin holds far finer features and needs far tighter clearances; powder-bed
// nylon sits between the two and needs escape holes rather than supports.
const BY_PROCESS: Record<Exclude<ManufacturingProcess, "unknown">, CadDefaults> = {
  fdm: FDM,
  sla: {
    ...FDM,
    defaultWallThickness: 1.5,
    generalClearance: 0.15,
    pressFitClearance: 0.05,
    slidingFitClearance: 0.2,
    minimumFeatureSize: 0.3,
    printerBed: { x: 143, y: 89, z: 175 },
  },
  sls: {
    ...FDM,
    defaultWallThickness: 1.2,
    generalClearance: 0.4,
    pressFitClearance: 0.2,
    slidingFitClearance: 0.5,
    minimumFeatureSize: 0.7,
    maximumUnsupportedOverhangDegrees: 90,
    printerBed: { x: 165, y: 165, z: 320 },
  },
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** `CAD_PRINTER_BED=250x250x300` */
function parseBed(
  raw: string | undefined,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const match = /^(\d{1,4})\s*[x×]\s*(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec((raw ?? "").trim());
  if (!match) return fallback;
  const bed = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  return bed.x > 0 && bed.y > 0 && bed.z > 0 ? bed : fallback;
}

export function cadDefaults(
  process: ManufacturingProcess = "fdm",
  env: NodeJS.ProcessEnv = process_env(),
): CadDefaults {
  const base = process === "unknown" ? FDM : BY_PROCESS[process];
  return {
    units: "mm",
    defaultWallThickness: positiveNumber(env.CAD_WALL_THICKNESS, base.defaultWallThickness),
    generalClearance: positiveNumber(env.CAD_GENERAL_CLEARANCE, base.generalClearance),
    pressFitClearance: positiveNumber(env.CAD_PRESS_FIT_CLEARANCE, base.pressFitClearance),
    slidingFitClearance: positiveNumber(env.CAD_SLIDING_FIT_CLEARANCE, base.slidingFitClearance),
    minimumFeatureSize: positiveNumber(env.CAD_MINIMUM_FEATURE_SIZE, base.minimumFeatureSize),
    maximumUnsupportedOverhangDegrees: positiveNumber(
      env.CAD_MAXIMUM_OVERHANG_DEGREES,
      base.maximumUnsupportedOverhangDegrees,
    ),
    printerBed: parseBed(env.CAD_PRINTER_BED, base.printerBed),
  };
}

// Indirection so this module can be imported by tests that stub the
// environment without shadowing the `process` parameter name above.
function process_env(): NodeJS.ProcessEnv {
  return globalThis.process?.env ?? {};
}

/** Common metric fastener sizes, so a "M3 boss" resolves to real numbers. */
export const METRIC_FASTENERS: Record<
  string,
  {
    clearanceHoleDiameter: number;
    tapHoleDiameter: number;
    heatSetInsertHoleDiameter: number;
    heatSetInsertDepth: number;
    headDiameter: number;
    recommendedBossOuterDiameter: number;
  }
> = {
  // Clearance and tap sizes are the standard medium-fit values; heat-set insert
  // figures follow the common brass inserts sold for these threads. A design
  // that uses another insert should override the parameter.
  m2: {
    clearanceHoleDiameter: 2.4,
    tapHoleDiameter: 1.6,
    heatSetInsertHoleDiameter: 3.2,
    heatSetInsertDepth: 4.0,
    headDiameter: 3.8,
    recommendedBossOuterDiameter: 6.0,
  },
  m2_5: {
    clearanceHoleDiameter: 2.9,
    tapHoleDiameter: 2.05,
    heatSetInsertHoleDiameter: 3.6,
    heatSetInsertDepth: 4.6,
    headDiameter: 4.5,
    recommendedBossOuterDiameter: 6.8,
  },
  m3: {
    clearanceHoleDiameter: 3.4,
    tapHoleDiameter: 2.5,
    heatSetInsertHoleDiameter: 4.2,
    heatSetInsertDepth: 5.0,
    headDiameter: 5.5,
    recommendedBossOuterDiameter: 7.5,
  },
  m4: {
    clearanceHoleDiameter: 4.5,
    tapHoleDiameter: 3.3,
    heatSetInsertHoleDiameter: 5.6,
    heatSetInsertDepth: 6.0,
    headDiameter: 7.0,
    recommendedBossOuterDiameter: 9.5,
  },
  m5: {
    clearanceHoleDiameter: 5.5,
    tapHoleDiameter: 4.2,
    heatSetInsertHoleDiameter: 6.4,
    heatSetInsertDepth: 7.0,
    headDiameter: 8.5,
    recommendedBossOuterDiameter: 11.0,
  },
};

export function fastenerReference(): string {
  return Object.entries(METRIC_FASTENERS)
    .map(
      ([name, sizes]) =>
        `${name.replace("_", ".").toUpperCase()}: clearance hole ${sizes.clearanceHoleDiameter} mm, ` +
        `tap hole ${sizes.tapHoleDiameter} mm, heat-set insert hole ${sizes.heatSetInsertHoleDiameter} mm ` +
        `× ${sizes.heatSetInsertDepth} mm deep, boss outer diameter ${sizes.recommendedBossOuterDiameter} mm`,
    )
    .join("\n");
}
