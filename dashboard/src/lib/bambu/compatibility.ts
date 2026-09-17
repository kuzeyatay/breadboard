import { isIP } from "node:net";
import { BAMBU_MODELS, BUILD_PLATES, color, fail, type PrinterConfig, type PrintReview, type SlicedPlate, type FilamentSource } from "./types.ts";

export function configuredHost(value: unknown): string {
  if (typeof value !== "string" || isIP(value) !== 4) fail("Enter the printer's private IPv4 LAN address, without a port or URL.", "invalid_printer_host", 400);
  const [a, b, c, d] = value.split(".").map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) || d === 0 || d === 255 || [a,b,c,d].some(p => p > 255)) fail("Use a private LAN address for this printer.", "invalid_printer_host", 400);
  return value;
}
export function configuredPrinter(value: unknown, id: string, revision: number): PrinterConfig {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object" || typeof v.name !== "string" || !v.name.trim() || v.name.length > 80 || !(BAMBU_MODELS as readonly unknown[]).includes(v.model) || ![0.2,0.4,0.6,0.8].includes(Number(v.nozzle)) || !(BUILD_PLATES as readonly unknown[]).includes(v.buildPlate)) fail("Provide a printer name, supported model, nozzle diameter and build plate. Unknown or multiple-nozzle configurations are unsupported.", "invalid_printer_config", 400);
  if (!Array.isArray(v.sources) || v.sources.length > 17) fail("Configure the physical filament sources (up to four classic AMS units).", "invalid_sources", 400);
  const sources = v.sources.map((raw): FilamentSource => {
    const s = raw as Record<string, unknown>;
    const external = s.id === "external";
    const match = typeof s.id === "string" ? /^ams:([0-3]):([0-3])$/.exec(s.id) : null;
    if ((!external && !match) || typeof s.material !== "string" || !/^[A-Za-z0-9 +._-]{1,32}$/.test(s.material) || (s.color != null && !color(s.color)) || typeof s.available !== "boolean") fail("Use stable AMS unit/tray IDs or one external spool, with explicit material and availability. AMS HT and multiple-nozzle mapping are not supported.", "invalid_sources", 400);
    const unit = match ? Number(match[1]) : null, tray = match ? Number(match[2]) : null;
    return { id: String(s.id), unit, tray, label: external ? "External spool" : `AMS ${unit! + 1} · Tray ${tray! + 1}`, material: s.material.toUpperCase(), color: color(s.color), available: s.available, provenance: "configured" };
  });
  if (new Set(sources.map(s => s.id)).size !== sources.length) fail("Each physical filament source must appear once.", "duplicate_source", 400);
  if ((v.model === "A1" || v.model === "A1 mini") && sources.some(s => s.unit !== null && s.unit !== 0)) fail("A1 supports one AMS Lite in this adapter.", "unsupported_ams", 400);
  return { id, revision, name: v.name.trim(), model: v.model as PrinterConfig["model"], nozzle: Number(v.nozzle), buildPlate: v.buildPlate as PrinterConfig["buildPlate"], sources, developerModeConfirmed: v.developerModeConfirmed === true, photo: false, configured: true, reachable: false, authenticated: false, startCapability: "not_tested", lastTestAt: null, message: null };
}
export function modelName(value: string): string {
  return value.replace(/^Bambu Lab\s*/i, "").replace(/^Bambu\s*/i, "").replace(/\s+\d\.\d\s*(?:mm)?\s*(?:nozzle)?.*$/i, "").replace(/[ _-]/g, "").toUpperCase().replace(/^A1M$/, "A1MINI");
}
export function validateReview(review: PrintReview, plate: SlicedPlate, printer: PrinterConfig, sources = printer.sources): string[] {
  const reasons = [...plate.blockers];
  if (!plate.model || modelName(plate.model) !== modelName(printer.model)) reasons.push("The sliced printer profile does not match the selected printer.");
  if (plate.nozzle !== printer.nozzle) reasons.push("The sliced nozzle diameter does not match the configured physical nozzle.");
  if (plate.buildPlate !== printer.buildPlate) reasons.push("The sliced build plate does not match the installed plate configuration.");
  if (!printer.developerModeConfirmed) reasons.push("Confirm supported LAN/Developer Mode on the physical printer in Connections.");
  if (!printer.authenticated || !["eligible_unverified", "verified"].includes(printer.startCapability)) reasons.push("Test this connection and confirm supported LAN control in Connections.");
  if (!review.options || Object.keys(review.options).sort().join(",") !== "bedLeveling,flowCalibration,vibrationCalibration" || Object.values(review.options).some(v => typeof v !== "boolean")) reasons.push("Choose all supported print options explicitly.");
  if (!Array.isArray(review.mapping) || review.mapping.length !== plate.filaments.length || new Set(review.mapping.map(m => m.filamentIndex)).size !== review.mapping.length) return [...reasons, "Map each required project filament index exactly once."];
  for (const requirement of plate.filaments) {
    const mapping = review.mapping.find(m => m.filamentIndex === requirement.index);
    const source = sources.find(s => s.id === mapping?.sourceId);
    if (!source?.available) { reasons.push(`Filament ${requirement.index + 1}: select an available physical source.`); continue; }
    if (source.material.toUpperCase() !== requirement.material.toUpperCase()) reasons.push(`Filament ${requirement.index + 1}: ${source.label} has a different material.`);
    if ((!requirement.color || !source.color || requirement.color !== source.color) && mapping?.acceptColorSubstitution !== true) reasons.push(`Filament ${requirement.index + 1}: explicitly accept the changed or unverified colour.`);
    if (source.id === "external" && plate.filaments.length !== 1) reasons.push("A multi-material plate cannot run from one external spool.");
    if (source.id !== "external" && !/^ams:[0-3]:[0-3]$/.test(source.id)) reasons.push("This AMS configuration is unsupported.");
  }
  return [...new Set(reasons)];
}
