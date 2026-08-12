// The shape of `GET /api/comfyui`, kept in a module the browser can import.
//
// Separate from ./service.ts on purpose: that one spawns processes and reads
// the filesystem, so a panel that imported it for a type would drag node:
// modules into the client bundle.

import type { ComfyUiCapabilities } from "./client.ts";

export type ComfyUiState =
  /** Turned off by configuration; the tab should not appear. */
  | "disabled"
  /** Answering, with at least one checkpoint to render with. */
  | "ready"
  /** Answering, but the models directory is empty. */
  | "no_models"
  /** Installed and startable, just not running yet. */
  | "stopped"
  /** The environment is being built right now. */
  | "installing"
  /** No environment yet, and Breadboard could build one. */
  | "not_installed"
  /** Nothing here to manage and nothing answering. */
  | "unavailable";

export interface ComfyUiSetupProgress {
  phase: string;
  message: string;
  step: number | null;
  totalSteps: number | null;
  detail: string | null;
  progress: { receivedBytes: number; totalBytes: number } | null;
  /** The installer stopped reporting: it died rather than finished. */
  stalled: boolean;
}

export interface ComfyUiStatus {
  state: ComfyUiState;
  message: string;
  baseUrl: string;
  /** Whether Breadboard may start or install this ComfyUI at all. */
  managed: boolean;
  capabilities: ComfyUiCapabilities | null;
  setup: ComfyUiSetupProgress | null;
}

/** States where the only sensible next move is waiting and re-asking. */
export const COMFYUI_TRANSIENT_STATES: ReadonlySet<ComfyUiState> = new Set(["installing"]);
