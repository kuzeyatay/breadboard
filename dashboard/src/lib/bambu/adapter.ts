import type { ExecutionSnapshot, Telemetry } from "./types.ts";
/** Backend-only LAN credentials. Never serialize to a tool or browser response. */
export interface PrinterAccess { id: string; host: string; serial: string; accessCode: string; model: string; }
export interface PrinterAdapter {
  test(access: PrinterAccess): Promise<Telemetry>;
  observe(access: PrinterAccess, fresh?: boolean): Promise<Telemetry>;
  upload(access: PrinterAccess, input: { attemptId: string; remoteFilename: string; localPath: string; sha256: string; size: number }): Promise<{ verified: "size" }>;
  start(access: PrinterAccess, input: { remoteFilename: string; attemptId: string; snapshot: ExecutionSnapshot }): Promise<void>;
  control(access: PrinterAccess, input: { command: "pause" | "resume" | "cancel"; remoteFilename: string; taskId: string }): Promise<void>;
}
