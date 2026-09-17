/** Shared display types. Credentials and executable commands never enter this contract. */
export const BAMBU_MODELS = ["P1P", "P1S", "X1C", "X1E", "A1", "A1 mini", "H2S"] as const;
export type PrinterModel = typeof BAMBU_MODELS[number];
export const BUILD_PLATES = ["textured_plate", "hot_plate", "cool_plate", "engineering_plate", "supertack_plate"] as const;
export type BuildPlate = typeof BUILD_PLATES[number];
export type JobState = "needs_file" | "validating" | "review_required" | "blocked" | "awaiting_approval" | "approved" | "uploading" | "start_requested" | "start_unconfirmed" | "preparing" | "printing" | "paused" | "cancel_requested" | "cancelled" | "failed" | "completed";
export const TERMINAL_STATES: readonly JobState[] = ["completed", "failed", "cancelled"];
export const ACTIVE_STATES: readonly JobState[] = ["approved", "uploading", "start_requested", "start_unconfirmed", "preparing", "printing", "paused", "cancel_requested"];
export interface FilamentSource {
  id: string; // ams:<unit>:<tray> or external; never a material name
  unit: number | null;
  tray: number | null;
  label: string;
  material: string;
  color: string | null;
  available: boolean;
  provenance: "telemetry" | "configured";
}
export interface PrinterConfig {
  id: string;
  name: string;
  model: PrinterModel;
  revision: number;
  nozzle: number;
  buildPlate: BuildPlate;
  developerModeConfirmed: boolean;
  sources: FilamentSource[];
  photo: boolean;
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  startCapability: "not_tested" | "eligible_unverified" | "verified" | "blocked";
  lastTestAt: string | null;
  message: string | null;
}
export interface Telemetry {
  observedAt: string;
  connected: boolean;
  reachable?: boolean;
  authenticated?: boolean;
  state?: "idle" | "preparing" | "printing" | "paused" | "completed" | "failed" | "cancelled";
  stage?: string;
  filename?: string;
  taskId?: string;
  progress?: number;
  remainingMinutes?: number;
  layer?: number;
  totalLayers?: number;
  nozzleTemperature?: number;
  bedTemperature?: number;
  nozzleDiameter?: number;
  model?: string;
  printError?: number;
  sources?: FilamentSource[];
  identityObservedAt?: string;
  stateObservedAt?: string;
}
export interface SlicedFilament { index: number; material: string; color: string | null; }
export interface SlicedPlate {
  id: number;
  path: string;
  model: string | null;
  nozzle: number | null;
  buildPlate: BuildPlate | null;
  filaments: SlicedFilament[];
  projectFilamentCount: number;
  durationSeconds: number | null;
  grams: number | null;
  gcodeSha256: string;
  gcodeMd5: string;
  thumbnail: boolean;
  blockers: string[];
}
export interface StagedFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  plates: SlicedPlate[];
}
export interface FilamentMapping { filamentIndex: number; sourceId: string; acceptColorSubstitution: boolean; }
export interface PrintOptions { bedLeveling: boolean; flowCalibration: boolean; vibrationCalibration: boolean; }
export interface PrintReview {
  printerId: string;
  printerRevision?: number;
  plateId: number;
  mapping: FilamentMapping[];
  options: PrintOptions;
}
export interface JobScope {
  userId: number;
  conversationId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  runId: string;
  originatingTurnId: string; // RuntimeRunDispatch.clientMessageId
}
export interface ExecutionSnapshot {
  scope: JobScope;
  jobId: string;
  revision: number;
  fileId: string;
  fileSha256: string;
  fileSize: number;
  plate: SlicedPlate;
  printerId: string;
  physicalIdentity: string;
  printerRevision: number;
  review: PrintReview;
  sources: FilamentSource[];
  expiresAt: string;
}
export interface PrintJob {
  id: string;
  resourceId: string;
  nextJobId?: string;
  scope: JobScope;
  revision: number;
  state: JobState;
  file: StagedFile | null;
  review: PrintReview | null;
  blockers: string[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  telemetry: Telemetry | null;
  uploadBytes: number | null;
  uploadVerified: "size" | null;
  approval: { digest: string; expiresAt: string; consumedAt: string | null; snapshot: ExecutionSnapshot } | null;
  attempt: { id: string; remoteFilename: string; startIntentAt: string | null; startedObservedAt: string | null } | null;
  pendingControl: "pause" | "resume" | "cancel" | null;
  message: string | null;
  audit: { at: string; event: string }[];
}
export interface JobView { job: Omit<PrintJob, "approval">; printers: PrinterConfig[]; printer: PrinterConfig | null; stale: boolean; }
export class BambuError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function fail(message: string, code = "bambu_invalid", status = 409): never { throw new BambuError(status, code, message); }
export function isActive(state: JobState): boolean { return ACTIVE_STATES.includes(state); }
export function color(value: unknown): string | null {
  return typeof value === "string" && /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
    ? `#${value.replace(/^#/, "").slice(0, 6).toUpperCase()}` : null;
}
