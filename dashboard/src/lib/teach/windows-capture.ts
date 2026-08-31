import "server-only";

// The Windows implementation of DemonstrationCaptureBackend.
//
// Same shape as Understudy's macOS recorder -- a child process that writes an
// event log and keyframes, driven by simple commands -- with a Windows helper in
// place of the Swift one. Everything platform-specific stops at this file; the
// teaching coordinator above it never learns which operating system it is on.
//
// The process is owned here, not by the browser. Nothing the web client sends
// reaches an OS input hook: it can ask this module to pause, resume or stop a
// session it started, and that is the entire vocabulary.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ensureDirectory } from "./artifacts.ts";
import { teachLog, teachWarn } from "./redaction.ts";
import type {
  CaptureArtifact,
  CaptureOptions,
  CaptureSession,
  DemonstrationCaptureBackend,
} from "./types.ts";
import { ensureHelperBinary, helperAvailability, helperChildEnvironment } from "./windows-helper.ts";

const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 12_000;

interface ActiveCapture {
  sessionId: string;
  child: ChildProcessWithoutNullStreams;
  startedAtEpochMs: number;
  eventLogPath: string;
  framesDirectory: string | null;
  screenDimensions: { width: number; height: number } | null;
  exited: Promise<number | null>;
  stopping: Promise<CaptureArtifact> | null;
  paused: boolean;
}

/**
 * Live recorders, on globalThis.
 *
 * Next.js gives each route bundle its own module instance in development, so a
 * plain module-level map would let the route that starts a recording and the
 * route that stops it disagree about whether one exists -- and the recorder would
 * keep its input hooks after the user pressed Finish. Every run manager in this
 * repo uses the same convention for the same reason.
 */
const registry = (): Map<string, ActiveCapture> => {
  const holder = globalThis as typeof globalThis & {
    __breadboardTeachCaptures?: Map<string, ActiveCapture>;
  };
  if (!holder.__breadboardTeachCaptures) holder.__breadboardTeachCaptures = new Map();
  return holder.__breadboardTeachCaptures;
};

function readLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
      index = buffer.indexOf("\n");
    }
    // A helper that goes quiet mid-line must not be able to grow this forever.
    if (buffer.length > 64 * 1024) buffer = "";
  });
}

function countEvents(eventLogPath: string): number {
  try {
    const contents = fs.readFileSync(eventLogPath, "utf8");
    return contents.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

export class WindowsDemonstrationCaptureBackend implements DemonstrationCaptureBackend {
  readonly platform = "win32";

  available(): { available: boolean; reason?: string } {
    return helperAvailability();
  }

  async start(options: CaptureOptions): Promise<CaptureSession> {
    const captures = registry();
    if (captures.has(options.sessionId)) {
      throw new Error("That teaching session is already recording.");
    }

    const binary = await ensureHelperBinary();
    const outputDirectory = ensureDirectory(options.outputDirectory);
    const eventLogPath = path.join(outputDirectory, "events.jsonl");
    const framesDirectory = options.captureFrames ? path.join(outputDirectory, "frames") : null;

    const args = [
      "record",
      "--out",
      outputDirectory,
      "--max-frames",
      String(Math.max(1, Math.min(2000, options.maxFrames))),
      "--frame-width",
      String(Math.max(320, Math.min(2560, options.frameMaxWidth))),
      ...(options.captureFrames ? [] : ["--no-frames"]),
    ];

    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: helperChildEnvironment(),
      cwd: outputDirectory,
    }) as ChildProcessWithoutNullStreams;

    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });

    let ready: (value: Record<string, unknown>) => void = () => {};
    let readyFailed: (reason: Error) => void = () => {};
    const readySignal = new Promise<Record<string, unknown>>((resolve, reject) => {
      ready = resolve;
      readyFailed = reject;
    });

    readLines(child.stdout, (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.status === "ready") ready(message);
      } catch {
        // The helper speaks JSON on stdout; anything else is not for us.
      }
    });
    // The helper never prints captured content to stderr, only failures to start.
    readLines(child.stderr, (line) => teachWarn("capture", "recorder reported a problem", { line }));

    child.once("error", (error) => readyFailed(error));
    void exited.then((code) => {
      if (code !== 0 && code !== null) {
        readyFailed(new Error(`The demonstration recorder exited with code ${code}.`));
      }
    });

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The demonstration recorder did not start in time.")),
        READY_TIMEOUT_MS,
      );
      void readySignal.finally(() => clearTimeout(timer));
    });

    let handshake: Record<string, unknown>;
    try {
      handshake = await Promise.race([readySignal, timeout]);
    } catch (error) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      throw error;
    }

    const width = typeof handshake.screenWidth === "number" ? handshake.screenWidth : null;
    const height = typeof handshake.screenHeight === "number" ? handshake.screenHeight : null;
    const startedAtEpochMs =
      typeof handshake.timestampMs === "number" ? handshake.timestampMs : Date.now();

    const capture: ActiveCapture = {
      sessionId: options.sessionId,
      child,
      startedAtEpochMs,
      eventLogPath,
      framesDirectory,
      screenDimensions: width !== null && height !== null ? { width, height } : null,
      exited,
      stopping: null,
      paused: false,
    };
    captures.set(options.sessionId, capture);

    // A recorder whose owner disappeared is a process holding global input hooks
    // with nobody to stop it, so it is dropped from the registry the moment it
    // ends rather than at the next request that happens to look.
    void exited.then(() => {
      if (captures.get(options.sessionId) === capture) captures.delete(options.sessionId);
    });

    teachLog("capture", "recording started", {
      sessionId: options.sessionId,
      frames: options.captureFrames,
    });

    return {
      id: options.sessionId,
      startedAtEpochMs,
      eventLogPath,
      framesDirectory,
      screenDimensions: capture.screenDimensions,
    };
  }

  private require(sessionId: string): ActiveCapture {
    const capture = registry().get(sessionId);
    if (!capture) throw new Error("That teaching session is not recording.");
    return capture;
  }

  async pause(sessionId: string): Promise<void> {
    const capture = this.require(sessionId);
    if (capture.paused) return;
    capture.child.stdin.write("pause\n");
    capture.paused = true;
    teachLog("capture", "recording paused", { sessionId });
  }

  async resume(sessionId: string): Promise<void> {
    const capture = this.require(sessionId);
    if (!capture.paused) return;
    capture.child.stdin.write("resume\n");
    capture.paused = false;
    teachLog("capture", "recording resumed", { sessionId });
  }

  async stop(sessionId: string): Promise<CaptureArtifact> {
    const capture = this.require(sessionId);
    if (capture.stopping) return capture.stopping;
    capture.stopping = this.stopCapture(capture);
    return capture.stopping;
  }

  private async stopCapture(capture: ActiveCapture): Promise<CaptureArtifact> {
    try {
      capture.child.stdin.write("stop\n");
      capture.child.stdin.end();
    } catch {
      // The helper is already gone; the deadline below settles it either way.
    }

    const settled = await Promise.race([
      capture.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
    ]);
    if (!settled) {
      // A recorder that will not stop is holding global input hooks. It does not
      // get the benefit of the doubt.
      teachWarn("capture", "recorder did not stop on request; terminating", {
        sessionId: capture.sessionId,
      });
      try {
        capture.child.kill();
      } catch {
        // Nothing left to kill.
      }
      await Promise.race([
        capture.exited,
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }

    registry().delete(capture.sessionId);
    const stoppedAtEpochMs = Date.now();
    const artifact: CaptureArtifact = {
      sessionId: capture.sessionId,
      eventLogPath: capture.eventLogPath,
      framesDirectory: capture.framesDirectory,
      startedAtEpochMs: capture.startedAtEpochMs,
      stoppedAtEpochMs,
      durationMs: Math.max(0, stoppedAtEpochMs - capture.startedAtEpochMs),
      eventCount: countEvents(capture.eventLogPath),
    };
    teachLog("capture", "recording stopped", {
      sessionId: capture.sessionId,
      durationMs: artifact.durationMs,
      eventCount: artifact.eventCount,
    });
    return artifact;
  }

  async cancel(sessionId: string): Promise<void> {
    const capture = registry().get(sessionId);
    if (!capture) return;
    try {
      await this.stopCapture(capture);
    } catch {
      // Cancellation must release the hooks whatever the shutdown reported.
    }
  }
}

/** True when a recorder for this session is still alive in this process. */
export function hasActiveCapture(sessionId: string): boolean {
  return registry().has(sessionId);
}

/** Every session this process is still recording. Used to clean up on restart. */
export function activeCaptureSessionIds(): string[] {
  return [...registry().keys()];
}
