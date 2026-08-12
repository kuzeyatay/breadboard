import type { VisualExpression } from "../visual-sdk.ts";

export const INTERACTIVE_VISUALIZER_SCHEMA_VERSION = 1;
export const INTERACTIVE_VISUALIZER_RUNTIME_VERSION = "1.0.0";
export const INTERACTIVE_VISUALIZER_THREE_VERSION = "0.185.1";
export const INTERACTIVE_VISUALIZER_MAX_REPAIR_ATTEMPTS = 3;

export type InteractiveVisualizerMode = "2d" | "3d" | "hybrid";
export type InteractiveVisualizerLifecycleStatus =
  | "planned"
  | "generating"
  | "validating"
  | "browser_testing"
  | "ready"
  | "failed"
  | "cancelled";

export interface InteractiveVisualizerPlan {
  schemaVersion: 1;
  title: string;
  objective: string;
  audience?: string;
  mode: InteractiveVisualizerMode;
  rationale: string;
  concepts: string[];
  assumptions: string[];
  controls: Array<{
    id: string;
    label: string;
    type: "range" | "number" | "select" | "toggle" | "button";
    purpose: string;
    initialValue?: number | string | boolean;
    minimum?: number;
    maximum?: number;
    step?: number;
    unit?: string;
  }>;
  outputs: Array<{
    id: string;
    label: string;
    unit?: string;
    purpose: string;
  }>;
  interactions: string[];
  animation?: {
    enabled: boolean;
    canPause: boolean;
    canReset: boolean;
    canStep?: boolean;
    speedControl?: boolean;
  };
  dataRequirements: string[];
  assetRequirements: string[];
  accessibilityRequirements: string[];
  sourceReferences: string[];
}

export interface InteractiveVisualizerManifest {
  schemaVersion: 1;
  artifactType: "interactive-visualizer";
  title: string;
  description: string;
  accessibilityDescription: string;
  mode: InteractiveVisualizerMode;
  entry: "index.html";
  runtime: {
    id: "breadboard-interactive-visualizer";
    version: string;
    threeVersion?: string;
  };
}

export interface InteractiveVisualizerControl {
  id: string;
  label: string;
  type: "slider" | "number" | "select" | "toggle" | "button";
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
  description?: string;
}

export interface InteractiveVisualizerOutput {
  id: string;
  label: string;
  expression?: VisualExpression;
  unit?: string;
  precision?: number;
}

export interface Plot2dScene {
  kind: "plot2d";
  title: string;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  samples: number;
  series: Array<{
    id: string;
    label: string;
    color?: string;
    expression: VisualExpression;
  }>;
}

export interface DoublePendulumScene {
  kind: "double-pendulum";
  title: string;
  gravityInput: string;
  length1Input: string;
  length2Input: string;
  mass1Input: string;
  mass2Input: string;
  angle1Input: string;
  angle2Input: string;
  speedInput?: string;
  trail: boolean;
}

export type Diagram2dElement =
  | {
      id: string;
      kind: "circle";
      label: string;
      cx: VisualExpression;
      cy: VisualExpression;
      radius: number;
      color: string;
    }
  | {
      id: string;
      kind: "rect";
      label: string;
      x: VisualExpression;
      y: VisualExpression;
      width: number;
      height: number;
      color: string;
    }
  | {
      id: string;
      kind: "line";
      label: string;
      x1: VisualExpression;
      y1: VisualExpression;
      x2: VisualExpression;
      y2: VisualExpression;
      color: string;
    }
  | {
      id: string;
      kind: "text";
      label: string;
      x: VisualExpression;
      y: VisualExpression;
      text: string;
      color: string;
    };

export interface Diagram2dScene {
  kind: "diagram2d";
  title: string;
  width: number;
  height: number;
  elements: Diagram2dElement[];
}

export interface OrbitBody {
  id: string;
  label: string;
  color: string;
  radius: number;
  distance: number;
  orbitSpeed: number;
  rotationSpeed?: number;
  inclination?: number;
}

export interface Orbit3dScene {
  kind: "orbit3d";
  title: string;
  timeScaleInput?: string;
  gravityInput?: string;
  initialVelocityInput?: string;
  showTrailsInput?: string;
  showVelocityVectorsInput?: string;
  trailSamples?: number;
  centralBody: {
    label: string;
    color: string;
    radius: number;
  };
  bodies: OrbitBody[];
}

export interface Spatial3dScene {
  kind: "scene3d";
  title: string;
  camera: "perspective" | "orthographic";
  rotationSpeedInput?: string;
  objects: Array<{
    id: string;
    label: string;
    shape: "sphere" | "box" | "cylinder" | "torus";
    color: string;
    position: [VisualExpression, VisualExpression, VisualExpression];
    scale: [number, number, number];
  }>;
  connections: Array<{
    from: string;
    to: string;
    color: string;
  }>;
}

export type InteractiveVisualizerScene =
  | Plot2dScene
  | Diagram2dScene
  | DoublePendulumScene
  | Orbit3dScene
  | Spatial3dScene;

export interface InteractiveVisualizerDefinition {
  schemaVersion: 1;
  title: string;
  description: string;
  controls: InteractiveVisualizerControl[];
  outputs: InteractiveVisualizerOutput[];
  scenes: InteractiveVisualizerScene[];
  animation?: {
    autoplay: boolean;
    durationMs: number;
    loop: boolean;
  };
  theme?: {
    accent?: "green" | "blue" | "amber" | "violet";
  };
}

export interface InteractiveVisualizerPackage {
  schemaVersion: 1;
  manifest: InteractiveVisualizerManifest;
  assumptions: string[];
  limitations: string[];
  sourceReferences: Array<{
    label: string;
    url?: string;
    gardenSlug?: string;
  }>;
  semanticTests: Array<{
    name: string;
    assertion: string;
  }>;
  assets: [];
  files: {
    "index.html": string;
    "styles.css": string;
    "main.ts": string;
  };
}

export interface InteractiveVisualizerValidation {
  valid: boolean;
  checkedAt: string;
  astNodeCount: number;
  sourceBytes: number;
  imports: string[];
  errors: string[];
  warnings: string[];
}

export interface InteractiveVisualizerBrowserTests {
  passed: boolean;
  checkedAt: string;
  executable?: string;
  viewports: string[];
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
  screenshotCreated: boolean;
}

export interface InteractiveVisualizerVersionManifest {
  schemaVersion: 1;
  artifactType: "interactive-visualizer";
  artifactId: string;
  version: number;
  previousVersion: number | null;
  title: string;
  description: string;
  mode: InteractiveVisualizerMode;
  sourceHash: string;
  bundleHash: string;
  runtimeVersion: string;
  threeVersion: string | null;
  assumptions: string[];
  limitations: string[];
  sourceReferences: InteractiveVisualizerPackage["sourceReferences"];
  status: "ready";
  generatedAt: string;
}
