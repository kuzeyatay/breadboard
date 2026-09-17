import type { PrinterConfig, PrinterModel } from "./types.ts";
/** No official marketing photo has been licensed for redistribution. A user's
 * own model photograph is locally retained; unknown/unpictured models stay honest.
 * Add licensed bundled photography here only with a matching provenance entry. */
export const PRINTER_PHOTOS: Record<PrinterModel, { src: string | null; provenance: string }> = {
  P1P: { src: null, provenance: "User-provided photo" }, P1S: { src: null, provenance: "User-provided photo" },
  X1C: { src: null, provenance: "User-provided photo" }, X1E: { src: null, provenance: "User-provided photo" },
  A1: { src: null, provenance: "User-provided photo" }, "A1 mini": { src: null, provenance: "User-provided photo" },
  H2S: { src: null, provenance: "User-provided photo" },
};
export function printerPhoto(printer: PrinterConfig | null): string | null {
  if (!printer) return null;
  return printer.photo ? `/api/hermes/connections/bambu/${encodeURIComponent(printer.id)}/photo` : PRINTER_PHOTOS[printer.model]?.src ?? null;
}
