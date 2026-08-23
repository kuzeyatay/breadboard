/**
 * Breadboard generated-visual SDK v1.
 *
 * Model-authored modules are declarative: they may construct this bounded data
 * model, but they may not provide callbacks or executable render code. The
 * generated-module compiler reads the TypeScript AST and emits a validated
 * definition for the isolated Quartz runtime.
 */

export const VISUAL_SDK_VERSION = "1.0.0";

export type VisualExpression =
  | { kind: "constant"; value: number }
  | { kind: "input"; id: string }
  | {
      kind: "binary";
      op: "add" | "subtract" | "multiply" | "divide" | "power" | "min" | "max";
      left: VisualExpression;
      right: VisualExpression;
    }
  | {
      kind: "unary";
      op: "negate" | "abs" | "sqrt" | "sin" | "cos" | "tan" | "exp" | "log";
      argument: VisualExpression;
    }
  | {
      kind: "clamp";
      value: VisualExpression;
      min: VisualExpression;
      max: VisualExpression;
    }
  | {
      kind: "conditional";
      comparison: "lt" | "lte" | "gt" | "gte" | "eq";
      left: VisualExpression;
      right: VisualExpression;
      whenTrue: VisualExpression;
      whenFalse: VisualExpression;
    };

export type GeneratedVisualControlProtocolRole =
  | "prediction_input"
  | "commit_prediction"
  | "reveal_outcome"
  | "evaluate_prediction"
  | "reset";

export type GeneratedVisualControlKind =
  | "variable"
  | "select_case"
  | "process_position"
  | "protocol_action";

export interface GeneratedVisualControl {
  id: string;
  /** Exact semantic kind from the model-reviewed opportunity, when scoped. */
  kind?: GeneratedVisualControlKind;
  label: string;
  type: "slider" | "number" | "select" | "toggle" | "button";
  /** Exact protocol role from the model-reviewed opportunity, when present. */
  protocolRole?: GeneratedVisualControlProtocolRole;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue: number | string | boolean;
  description?: string;
}

export interface GeneratedVisualOutput {
  id: string;
  label: string;
  representation: "value" | "chart" | "diagram" | "animation" | "timeline" | "table" | "annotation";
  expression?: VisualExpression;
  unit?: string;
  precision?: number;
}

export interface PlotScene {
  kind: "plot";
  title: string;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  samples: number;
  series: Array<{
    id: string;
    label: string;
    color?: string;
    expression: VisualExpression;
  }>;
  markers?: Array<{
    id: string;
    label: string;
    x: VisualExpression;
    y: VisualExpression;
    color?: string;
  }>;
}

export interface DiagramScene {
  kind: "diagram";
  title: string;
  nodes: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    value?: VisualExpression;
    shape?: "circle" | "rect";
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    directed?: boolean;
    strength?: VisualExpression;
  }>;
}

export interface TimelineScene {
  kind: "timeline";
  title: string;
  progressInput: string;
  steps: Array<{ id: string; label: string; description: string; at: number }>;
}

export interface ValueScene {
  kind: "value";
  outputId: string;
  emphasis?: "normal" | "strong";
}

export interface TableScene {
  kind: "table";
  title: string;
  columns: string[];
  rows: Array<{ label: string; values: Array<string | number | VisualExpression> }>;
}

export interface AnnotationScene {
  kind: "annotation" | "formula";
  title: string;
  text: string;
  visibleWhen?: VisualExpression;
}

export interface AnimatedMarkerScene {
  kind: "animated_marker";
  title: string;
  x: VisualExpression;
  y: VisualExpression;
  label: string;
}

export interface StatusScene {
  kind: "status";
  title: string;
  value: VisualExpression;
  threshold: number;
  belowLabel: string;
  equalLabel: string;
  aboveLabel: string;
  description?: string;
}

/** A numeric spatial field may be fixed or derived from learner controls. */
export type SpatialScalar = number | VisualExpression;

/** Cartesian coordinates in the model-authored scene's local coordinate space. */
export type SpatialVector3 = [SpatialScalar, SpatialScalar, SpatialScalar];

export type SpatialPaletteColor =
  | "green"
  | "blue"
  | "amber"
  | "violet"
  | "red"
  | "cyan"
  | "gray";

export type SpatialSurfacePattern = "solid" | "striped" | "dotted" | "crosshatch";

/** Controls whether a primitive's required name is also drawn on the canvas. */
export type SpatialLabelMode = "inline" | "legend_only";

interface SpatialPrimitiveBase {
  id: string;
  label: string;
  color?: SpatialPaletteColor;
  pattern?: SpatialSurfacePattern;
  /** Defaults to inline; legend_only keeps the required legend and ARIA name. */
  labelMode?: SpatialLabelMode;
  opacity?: number;
  visibleWhen?: VisualExpression;
}

export interface SpatialPlanePrimitive extends SpatialPrimitiveBase {
  kind: "plane";
  center: SpatialVector3;
  normal: SpatialVector3;
  size: SpatialScalar;
}

/** A bounded, model-authored planar patch with ordered coplanar vertices. */
export interface SpatialPolygonPrimitive extends SpatialPrimitiveBase {
  kind: "polygon";
  points: SpatialVector3[];
}

export interface SpatialSpherePrimitive extends SpatialPrimitiveBase {
  kind: "sphere";
  center: SpatialVector3;
  radius: SpatialScalar;
}

export interface SpatialCylinderPrimitive extends SpatialPrimitiveBase {
  kind: "cylinder";
  center: SpatialVector3;
  axis: SpatialVector3;
  radius: SpatialScalar;
  height: SpatialScalar;
}

export interface SpatialConePrimitive extends SpatialPrimitiveBase {
  kind: "cone";
  apex: SpatialVector3;
  axis: SpatialVector3;
  radius: SpatialScalar;
  height: SpatialScalar;
}

export interface SpatialPointPrimitive extends SpatialPrimitiveBase {
  kind: "point";
  position: SpatialVector3;
  size?: SpatialScalar;
}

export interface SpatialVectorPrimitive extends SpatialPrimitiveBase {
  kind: "vector";
  from: SpatialVector3;
  to: SpatialVector3;
  headSize?: SpatialScalar;
}

export type SpatialPrimitive =
  | SpatialPlanePrimitive
  | SpatialPolygonPrimitive
  | SpatialSpherePrimitive
  | SpatialCylinderPrimitive
  | SpatialConePrimitive
  | SpatialPointPrimitive
  | SpatialVectorPrimitive;

export interface SpatialGroup {
  id: string;
  label: string;
  visibleWhen?: VisualExpression;
  primitives: SpatialPrimitive[];
}

/**
 * A bounded, declarative three-dimensional scene. The isolated runtime owns
 * projection and rendering; the model authors every object and relationship.
 */
export interface SpatialScene {
  kind: "spatial";
  title: string;
  view?: {
    azimuthDegrees?: number;
    elevationDegrees?: number;
    scale?: number;
    /**
     * The authored camera projection. Omitted values preserve the original
     * generated-visual contract and render as a fixed orthographic view.
     */
    projection?: "orthographic" | "perspective";
    /**
     * Whether the learner may navigate the authored spatial model. Camera
     * navigation never changes the model-authored geometry or learner state.
     */
    interaction?: "fixed" | "orbit";
  };
  groups: SpatialGroup[];
}

export type GeneratedVisualScene =
  | PlotScene
  | DiagramScene
  | TimelineScene
  | ValueScene
  | TableScene
  | AnnotationScene
  | AnimatedMarkerScene
  | StatusScene
  | SpatialScene;

export interface GeneratedVisualizationDefinition {
  schemaVersion: 1;
  sdkVersion: string;
  title: string;
  description: string;
  accessibilityDescription: string;
  controls: GeneratedVisualControl[];
  outputs: GeneratedVisualOutput[];
  scenes: GeneratedVisualScene[];
  animation?: {
    durationMs: number;
    loop: boolean;
    autoplay: boolean;
  };
  theme?: {
    accent?: "green" | "blue" | "amber" | "violet";
  };
}

export function defineVisualization(
  definition: GeneratedVisualizationDefinition,
): GeneratedVisualizationDefinition {
  return definition;
}

export function Slider(
  control: Omit<GeneratedVisualControl, "type">,
): GeneratedVisualControl {
  return { ...control, type: "slider" };
}

export function Select(
  control: Omit<GeneratedVisualControl, "type">,
): GeneratedVisualControl {
  return { ...control, type: "select" };
}

export function Toggle(
  control: Omit<GeneratedVisualControl, "type">,
): GeneratedVisualControl {
  return { ...control, type: "toggle" };
}

export function NumberInput(
  control: Omit<GeneratedVisualControl, "type">,
): GeneratedVisualControl {
  return { ...control, type: "number" };
}

export function PlayControls(durationMs = 4000) {
  return { durationMs, loop: true, autoplay: false } as const;
}

export function ValueReadout(outputId: string): ValueScene {
  return { kind: "value", outputId };
}

export function Plot(scene: Omit<PlotScene, "kind">): PlotScene {
  return { kind: "plot", ...scene };
}

export function SvgCanvas(scene: Omit<DiagramScene, "kind">): DiagramScene {
  return { kind: "diagram", ...scene };
}

export function Formula(title: string, text: string): AnnotationScene {
  return { kind: "formula", title, text };
}

export function useVisualizationState(): never {
  throw new Error("useVisualizationState is available only inside the generated-visual sandbox runtime");
}

export function useAnimationClock(): never {
  throw new Error("useAnimationClock is available only inside the generated-visual sandbox runtime");
}
