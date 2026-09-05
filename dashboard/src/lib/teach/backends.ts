import "server-only";

// Choosing platform implementations, and saying so plainly when there isn't one.
//
// Demonstration capture remains platform-specific. Replay does not: Hermes
// Agent's background computer-use backend owns Windows, macOS, and Linux, so
// every learned workflow gets the same controller and safety behavior.
//
// A platform with no implementation gets a backend that refuses clearly rather
// than one that pretends. Teaching then shows as unavailable and the rest of
// Breadboard -- including every existing workflow -- is untouched.

import type {
  CaptureArtifact,
  CaptureSession,
  DemonstrationCaptureBackend,
  WorkflowComputerBackend,
} from "./types.ts";
import { WindowsDemonstrationCaptureBackend } from "./windows-capture.ts";
import { HermesComputerBackend } from "./hermes-computer.ts";

function unsupportedReason(): string {
  return `Teaching by demonstration needs a capture backend for ${process.platform}, and this build only ships the Windows one.`;
}

class UnsupportedCaptureBackend implements DemonstrationCaptureBackend {
  readonly platform = process.platform;

  available(): { available: boolean; reason?: string } {
    return { available: false, reason: unsupportedReason() };
  }
  async start(): Promise<CaptureSession> {
    throw new Error(unsupportedReason());
  }
  async pause(): Promise<void> {
    throw new Error(unsupportedReason());
  }
  async resume(): Promise<void> {
    throw new Error(unsupportedReason());
  }
  async stop(): Promise<CaptureArtifact> {
    throw new Error(unsupportedReason());
  }
  async cancel(): Promise<void> {
    // Cancelling something that never started is a success, on every platform.
  }
}

let captureBackend: DemonstrationCaptureBackend | null = null;

/** The capture backend for this platform. One instance: it owns live recorders. */
export function demonstrationCaptureBackend(): DemonstrationCaptureBackend {
  if (!captureBackend) {
    captureBackend =
      process.platform === "win32"
        ? new WindowsDemonstrationCaptureBackend()
        : new UnsupportedCaptureBackend();
  }
  return captureBackend;
}

/**
 * A computer backend for one run.
 *
 * Deliberately not a singleton: each backend owns a child process that is
 * started when a run starts and killed when it stops, so two runs can never end
 * up sharing one process and one Stop button.
 */
export function createWorkflowComputerBackend(): WorkflowComputerBackend {
  return new HermesComputerBackend();
}

export interface TeachAvailability {
  available: boolean;
  capture: { available: boolean; reason?: string };
  computer: { available: boolean; reason?: string };
  platform: string;
  reason?: string;
}

/**
 * Whether this machine can teach and replay.
 *
 * The Workflows page asks before it offers the button, so an install without a
 * backend says why instead of failing after the user has already started
 * talking.
 */
export function teachAvailability(): TeachAvailability {
  const capture = demonstrationCaptureBackend().available();
  const computer = new HermesComputerBackend().available();
  return {
    available: capture.available && computer.available,
    capture,
    computer,
    platform: process.platform,
    ...(capture.available && computer.available
      ? {}
      : { reason: capture.reason ?? computer.reason ?? unsupportedReason() }),
  };
}
