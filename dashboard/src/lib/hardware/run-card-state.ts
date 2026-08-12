import { componentDefinition } from "./components/index.ts";
import type { HardwareDesign, ValidationResult } from "./types.ts";
import { countBySeverity } from "./validation.ts";

export interface HardwareBlueprintRunCardFinding {
  id: string;
  severity: "error" | "warning";
  title: string;
  message: string;
  remediation?: string;
}

export interface HardwareBlueprintRunCardState extends Record<string, unknown> {
  kind: "hardware-blueprint";
  designTitle: string;
  designSummary: string;
  note: string;
  safetyNotice: string;
  pins: Array<{ pin: string; purpose: string }>;
  counts: { errors: number; warnings: number; info: number };
  findings: HardwareBlueprintRunCardFinding[];
  specs: Array<[string, string]>;
  firmwareFiles: string[];
  firmwareNotice: string;
  enclosureTitle: string;
  enclosureNotice: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HardwareBlueprintRunCardStateOptions {
  note?: string;
  safetyNotice?: string;
  pins?: Array<{ pin: string; purpose: string }>;
  controllerName?: string;
  typicalCurrentMa?: number;
  firmwareNotice?: string;
  enclosureTitle?: string;
  enclosureNotice?: string;
  startedAt?: string;
  completedAt?: string;
}

export function presentHardwareBlueprintFindings(
  results: ValidationResult[],
): HardwareBlueprintRunCardFinding[] {
  return results
    .filter(
      (result): result is ValidationResult & { severity: "error" | "warning" } =>
        result.severity === "error" || result.severity === "warning",
    )
    .map((result) => ({
      id: result.id,
      severity: result.severity,
      title: result.title,
      message: result.message,
      ...(result.remediation ? { remediation: result.remediation } : {}),
    }));
}

function recoveredSafetyNotice(design: HardwareDesign): string {
  const safetyFinding = design.validationResults.find(
    (result) => result.id === "safety_scope",
  );
  return safetyFinding
    ? `${safetyFinding.title} — ${safetyFinding.message}`
    : "";
}

function recoveredPins(
  design: HardwareDesign,
): Array<{ pin: string; purpose: string }> {
  const controller = design.components.find(
    (component) => component.reference === "U1",
  );
  if (!controller) return [];
  const definition = componentDefinition(controller.definitionId);
  const labelsById = new Map(
    definition?.pins.map((pin) => [pin.id, pin.label]) ?? [],
  );
  const seen = new Set<string>();
  const pins: Array<{ pin: string; purpose: string }> = [];

  for (const net of design.nets) {
    if (net.role === "power" || net.role === "ground") continue;
    const connection = net.connections.find(
      (candidate) => candidate.componentId === controller.id,
    );
    if (!connection) continue;
    const pin = labelsById.get(connection.pinId) ?? connection.pinId;
    const key = `${pin}\u0000${net.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({ pin, purpose: net.role });
  }
  return pins;
}

/**
 * Build the bounded presentation payload used by the finished inline card.
 *
 * Live runs can supply compiler-only details such as exact pin labels. On an
 * old transcript, the stored HardwareDesign is still enough to recover the
 * useful design, validation, wiring, power and firmware fields without
 * invoking a model or recompiling the circuit.
 */
export function hardwareBlueprintRunCardState(
  design: HardwareDesign,
  options: HardwareBlueprintRunCardStateOptions = {},
): HardwareBlueprintRunCardState {
  const controller = design.components.find(
    (component) => component.reference === "U1",
  );
  const typicalCurrentMa = options.typicalCurrentMa ??
    design.powerEstimate?.totalTypicalMa;
  const hasTypicalCurrent =
    typeof typicalCurrentMa === "number" && Number.isFinite(typicalCurrentMa);

  return {
    kind: "hardware-blueprint",
    designTitle: design.title,
    designSummary: design.summary,
    note: options.note ?? "",
    safetyNotice: options.safetyNotice ?? recoveredSafetyNotice(design),
    pins: options.pins ?? recoveredPins(design),
    counts: countBySeverity(design.validationResults),
    findings: presentHardwareBlueprintFindings(design.validationResults),
    specs: [
      ["Controller", options.controllerName ?? controller?.name ?? "Not recorded"],
      ["Parts", String(design.components.length)],
      ["Nets", String(design.nets.length)],
      [
        "Typical draw",
        hasTypicalCurrent ? `${Math.round(typicalCurrentMa)} mA` : "Not estimated",
      ],
    ],
    firmwareFiles: design.firmware?.files.map((file) => file.path) ?? [],
    firmwareNotice: options.firmwareNotice ?? "",
    enclosureTitle: options.enclosureTitle ?? "",
    enclosureNotice: options.enclosureNotice ?? "",
    ...(options.startedAt ? { startedAt: options.startedAt } : {}),
    ...(options.completedAt ? { completedAt: options.completedAt } : {}),
  };
}
