// The Parametric CAD data model.
//
// Three kinds of data live here and must never be confused:
//   * CADDesignSpec — the structured reading of what the user asked for, plus
//     the defaults and derivations the agent chose. Always validated through
//     ./schemas.ts before it is trusted.
//   * CADBuildReport — measurements the CAD kernel produced. Never authored by
//     a model; an unknown value is absent rather than invented.
//   * ParametricCADArtifact — the manifest stored as the artifact's source, so
//     reopening a design never needs the model again.

export const CAD_DESIGN_SCHEMA_VERSION = 1;
export const CAD_ARTIFACT_SCHEMA_VERSION = 1;

export type CADUnits = "mm" | "inch";
export type ManufacturingProcess = "fdm" | "sla" | "sls" | "unknown";
export type CADParameterSource = "user" | "default" | "derived";
export type CADBodyRole = "primary" | "lid" | "fastener" | "reference" | "other";
export type CADExportFormat =
  | "step"
  | "stl"
  | "glb"
  | "3mf"
  /** The native SolidWorks part. Only ever present on a SolidWorks build. */
  | "sldprt"
  | "source"
  /** The SolidWorks operation program, in place of `source` on that backend. */
  | "operations"
  | "spec"
  | "report";
export type CADStatus = "draft" | "valid" | "valid-with-warnings" | "invalid";

export interface CADValidationIssue {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  feature?: string;
  expected?: unknown;
  actual?: unknown;
  repairHint?: string;
}

export interface CADParameter {
  id: string;
  label: string;
  value: number | string | boolean;
  unit?: string;
  minimum?: number;
  maximum?: number;
  editable: boolean;
  source: CADParameterSource;
  description?: string;
}

export interface CADComponent {
  id: string;
  name: string;
  quantity: number;
  material?: string;
  bodyRole: CADBodyRole;
}

export interface CADConstraint {
  id: string;
  type:
    | "dimension"
    | "clearance"
    | "wall-thickness"
    | "alignment"
    | "symmetry"
    | "hole"
    | "fit"
    | "printability"
    | "custom";
  description: string;
  expected?: unknown;
  tolerance?: number;
  unit?: string;
}

export interface CADAssumption {
  id: string;
  description: string;
  reason: string;
  userEditable: boolean;
}

/** A bought item the printed bodies are assembled with. Never a printed body. */
export interface CADAssemblyHardware {
  id: string;
  /** What to buy, said the way a supplier lists it: "M3 × 12 socket cap screw". */
  name: string;
  quantity: number;
  /** Where it goes. */
  purpose?: string;
}

/**
 * One join. `parts` names the bodies and reference envelopes the step brings
 * together — component ids, so a step can be read against the components list
 * and against the named solids the program returned.
 */
export interface CADAssemblyStep {
  order: number;
  summary: string;
  parts: string[];
  hardware?: string[];
  detail?: string;
}

/**
 * What attaches to what.
 *
 * The measurements say the part is valid; they never say which body is which,
 * which face the board lands on, or which screw holds the lid. That knowledge
 * only exists at design time, so it is recorded with the design rather than
 * left in a chat message that scrolls away.
 */
export interface CADAssembly {
  /** The assembled product in one or two sentences. */
  overview: string;
  hardware: CADAssemblyHardware[];
  steps: CADAssemblyStep[];
  /** Tools, adhesives, or preparation the steps assume. */
  notes?: string[];
}

export interface CADExportSettings {
  stlLinearTolerance: number;
  stlAngularTolerance: number;
  generateStep: boolean;
  generateStl: boolean;
  generateGlb: boolean;
  generate3mf: boolean;
}

export interface CADDesignSpec {
  schemaVersion: typeof CAD_DESIGN_SCHEMA_VERSION;
  projectId: string;
  name: string;
  description: string;
  units: CADUnits;
  manufacturingProcess: ManufacturingProcess;
  parameters: CADParameter[];
  components: CADComponent[];
  constraints: CADConstraint[];
  assumptions: CADAssumption[];
  /**
   * How the printed bodies and bought parts go together. Absent on designs
   * built before this was recorded, and on a single body with no hardware.
   */
  assembly?: CADAssembly;
  exportSettings: CADExportSettings;
  /**
   * The declared overall size, in millimetres, that validation measures the
   * built solid against. Absent when the design has no single declared
   * envelope — a bracket sized by its hole pattern, say.
   */
  declaredBoundingBox?: { x?: number; y?: number; z?: number; tolerance?: number };
  /** The printer volume the part must fit. In millimetres. */
  printerBed?: { x: number; y: number; z: number };
}

/** Measurements OpenCascade produced for one build. Never model-authored. */
export interface CADMeasurements {
  boundingBox: { x: number; y: number; z: number; unit: string };
  volume?: number;
  surfaceArea?: number;
  solidCount: number;
  triangleCount?: number;
  bodies: Array<{
    name: string;
    volume: number;
    surfaceArea: number;
    boundingBox: { x: number; y: number; z: number };
    valid: boolean;
    watertight: boolean;
  }>;
}

/**
 * A stored file reference. Deliberately not a path: the renderer receives a
 * (projectId, revision, format) triple and the download route resolves it
 * against the database, so no filesystem path ever reaches the browser.
 */
export interface CADFileReference {
  projectId: string;
  revision: number;
  format: CADExportFormat;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  /** Present for tessellated formats; absent for STEP and text exports. */
  linearTolerance?: number;
  angularTolerance?: number;
}

export interface CADRevisionSummary {
  revision: number;
  parentRevision: number | null;
  status: CADStatus;
  instruction: string;
  parameterDiff: Array<{ id: string; from: unknown; to: unknown }>;
  createdAt: string;
  validationPassed: boolean;
  errorCount: number;
  warningCount: number;
  boundingBox?: { x: number; y: number; z: number };
}

export interface CADProvenance {
  engine: string;
  engineVersion: string;
  kernel: string;
  kernelVersion: string;
  pythonVersion: string;
  serviceVersion: string;
  model: string;
  /**
   * Who wrote the geometry program. New revisions are always model-authored.
   * `deterministic-template` remains readable only so artifacts saved before
   * deterministic CAD substitution was removed keep their honest provenance.
   */
  geometryAuthor?: "model" | "deterministic-template";
  generatedAt: string;
  parentRevision?: number;
  /** Milliseconds the CAD kernel spent, excluding model time. */
  buildDurationMs?: number;
}

export interface ParametricCADArtifact {
  schemaVersion: typeof CAD_ARTIFACT_SCHEMA_VERSION;
  artifactType: "parametric-cad";
  projectId: string;
  revision: number;
  title: string;
  status: CADStatus;
  designSpec: CADDesignSpec;
  /** The CadQuery program, inline: it is the design, not an attachment. */
  source: string;
  entrypoint: string;
  /** Values the program ran with, on top of its own DEFAULT_PARAMS. */
  parameters: Record<string, number | string | boolean>;
  previewFile: CADFileReference | null;
  exports: CADFileReference[];
  measurements: CADMeasurements;
  validation: {
    passed: boolean;
    checkedAt: string;
    issues: CADValidationIssue[];
  };
  assumptions: string[];
  /** What the agent had to guess, and what only a person can confirm. */
  disclaimers: string[];
  revisionHistory: CADRevisionSummary[];
  /** Lifecycle lines for debugging. Never model reasoning. */
  generationLog: Array<{ at: string; stage: string; detail: string }>;
  provenance: CADProvenance;
}
