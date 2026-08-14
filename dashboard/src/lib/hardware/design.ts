// The design orchestrator: request in, HardwareDesign out.
//
// A modification never patches a design in place. It rewrites the request and
// recompiles from scratch, so wiring, schematic, BOM, assembly steps, firmware
// and validation can never drift apart.

import { generateAssemblySteps } from "./assembly.ts";
import { generateBom } from "./bom.ts";
import { toCircuitJson } from "./circuit-json.ts";
import {
  componentDefinition,
  isController,
  scopedDefinitionsForDesign,
} from "./components/index.ts";
import { compileCircuit, resolveRequestPeripherals, type CompiledCircuit } from "./compiler.ts";
import { resolveComponentPhrase } from "./resolver.ts";
import { generateFirmware } from "./firmware.ts";
import { layoutDesign } from "./layout.ts";
import { assessSafety, type SafetyDecision } from "./safety.ts";
import type { FirmwareLogic, HardwareDesignModification } from "./schemas.ts";
import { countBySeverity, designStatus, validateCircuit } from "./validation.ts";
import {
  HARDWARE_DESIGN_SCHEMA_VERSION,
  type ComponentDefinition,
  type ComponentResearchRecord,
  type HardwareDesign,
  type HardwareProjectRequest,
  type ValidationResult,
} from "./types.ts";

export interface BuildDesignInput {
  request: HardwareProjectRequest;
  /** The person's own words, retained for product-completeness validation. */
  sourceBrief?: string;
  /** Stable id so a revision keeps the same identity. */
  designId: string;
  firmwareLogic?: FirmwareLogic | null;
  /** Pre-computed safety decision; recomputed from the purpose when absent. */
  safety?: SafetyDecision;
  /** Source-backed definitions and their audit trail for this blueprint. */
  componentResearch?: readonly ComponentResearchRecord[];
}

export interface BuildDesignResult {
  design: HardwareDesign;
  circuit: CompiledCircuit;
  /** Set when supplied firmware logic was rejected during generation. */
  firmwareNotice?: string;
}

function projectTitle(request: HardwareProjectRequest, circuit: CompiledCircuit): string {
  if (request.title?.trim()) return request.title.trim();
  const parts = circuit.peripherals
    .map((placement) => placement.definition.name)
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, 2);
  const suffix = parts.length ? ` with ${parts.join(" and ")}` : "";
  return `${circuit.controllerDefinition.name} project${suffix}`;
}

function projectSummary(
  request: HardwareProjectRequest,
  circuit: CompiledCircuit,
  results: ValidationResult[],
): string {
  const counts = countBySeverity(results);
  const partCount = circuit.components.filter(
    (instance) =>
      componentDefinition(instance.definitionId, circuit.scopedDefinitions)?.category !== "prototyping",
  ).length;
  const busses = [...new Set(circuit.peripherals.map((placement) => placement.interfaceKind))]
    .filter((kind) => kind !== "none" && kind !== "passive")
    .join(", ");
  const unknownLoads = circuit.currentEstimate.unknownComponentIds.length;
  const currentSummary = unknownLoads
    ? `accounting for at least ${Math.round(
        circuit.currentEstimate.totalTypicalMa,
      )} mA of known typical load; ${unknownLoads} active part${unknownLoads === 1 ? " is" : "s are"} still unaccounted for`
    : `drawing about ${Math.round(circuit.currentEstimate.totalTypicalMa)} mA typical`;
  return [
    `${request.purpose.trim().replace(/\.$/, "")}.`,
    `Built around ${circuit.controllerDefinition.name} with ${partCount} part${
      partCount === 1 ? "" : "s"
    }${busses ? ` over ${busses}` : ""}, ${currentSummary}.`,
    counts.errors
      ? `${counts.errors} error${counts.errors === 1 ? "" : "s"} must be resolved before building.`
      : counts.warnings
        ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"} to read before building.`
        : "Validation found nothing to fix.",
  ].join(" ");
}

function annotateResearchFindings(
  results: ValidationResult[],
  records: readonly ComponentResearchRecord[],
  circuit: CompiledCircuit,
): void {
  for (const record of records) {
    if (record.status === "used") continue;
    const resolved = resolveComponentPhrase(record.requestedAs, circuit.scopedDefinitions);
    const definitionId =
      record.definition?.id ??
      (resolved.status === "resolved" ? resolved.definition.id : null);
    const componentIds = new Set(
      definitionId
        ? circuit.components
            .filter((component) => component.definitionId === definitionId)
            .map((component) => component.id)
        : [],
    );
    const phrase = record.requestedAs.toLowerCase();
    const finding = results.find(
      (result) =>
        [
          "UNSUPPORTED_COMPONENT",
          "PREFERRED_COMPONENT_MISSING",
          "REQUESTED_POWER_PART_MISSING",
        ].includes(result.rule) &&
        (`${result.title} ${result.message}`.toLowerCase().includes(phrase) ||
          result.componentIds.some((id) => componentIds.has(id))),
    ) ?? results.find(
      (result) =>
        result.rule === "ELECTRICAL_PLACEHOLDER" &&
        result.componentIds.some((id) => componentIds.has(id)),
    );
    if (!finding) continue;
    finding.message = `${finding.message} Online component research was attempted: ${record.note}`;
    if (record.sources.length) {
      finding.remediation =
        "A real product was found, but the evidence or interface was not sufficient for safe automatic wiring. Review its saved sources and choose a compiler-supported module or complete the missing verified facts.";
    }
  }
}

export function buildDesign(input: BuildDesignInput): BuildDesignResult {
  const componentResearch = [...(input.componentResearch ?? [])];
  const scopedDefinitions: ComponentDefinition[] = componentResearch.flatMap((record) =>
    record.status === "used" && record.definition ? [record.definition] : [],
  );
  const safety =
    input.safety ??
    assessSafety(
      [
        input.request.purpose,
        input.request.title ?? "",
        ...input.request.inputs.map((entry) => entry.type),
        ...input.request.outputs.map((entry) => entry.type),
      ].join(" "),
    );

  const circuit = compileCircuit({
    request: input.request,
    resolved: resolveRequestPeripherals(input.request, scopedDefinitions),
    scopedDefinitions,
  });

  const validationResults = validateCircuit(circuit, input.request, input.sourceBrief);
  annotateResearchFindings(validationResults, componentResearch, circuit);
  if (safety.level !== "supported") {
    validationResults.unshift({
      id: "safety_scope",
      rule: "UNSUPPORTED_COMPONENT",
      severity: "error",
      title: `${safety.category} is outside this agent's scope`,
      message: safety.reason,
      componentIds: [],
      netIds: [],
      remediation:
        "The low-voltage control side below is a starting point only. Do not treat it as a build-ready design for the part that falls outside scope.",
    });
  }

  const firmware = generateFirmware({
    circuit,
    request: input.request,
    logic: input.firmwareLogic ?? null,
  });

  const status = designStatus(validationResults, {
    conceptOnly: safety.level !== "supported",
  });
  const unknownLoads = circuit.currentEstimate.unknownComponentIds.length;
  const powerRationale = unknownLoads
    ? `Known loads account for at least ${Math.round(
        circuit.currentEstimate.totalTypicalMa,
      )} mA typical and ${Math.round(
        circuit.currentEstimate.totalMaximumMa,
      )} mA worst case. ${unknownLoads} active part${unknownLoads === 1 ? " is" : "s are"} missing a documented or connected load, so both figures are lower bounds.`
    : `Estimated draw is about ${Math.round(
        circuit.currentEstimate.totalTypicalMa,
      )} mA typical and ${Math.round(circuit.currentEstimate.totalMaximumMa)} mA worst case.`;

  const design: HardwareDesign = {
    schemaVersion: HARDWARE_DESIGN_SCHEMA_VERSION,
    id: input.designId,
    title: projectTitle(input.request, circuit),
    summary: projectSummary(input.request, circuit, validationResults),
    status,
    request: input.request,
    decisions: [
      ...circuit.decisions,
      {
        category: "Power",
        selection: `${input.request.power.source === "unknown" ? "USB" : input.request.power.source} supply`,
        rationale: powerRationale,
      },
      {
        category: "Prototype",
        selection: input.request.prototypeType,
        rationale:
          input.request.prototypeType === "breadboard"
            ? "Nothing here needs soldering, so the design targets a solderless breadboard."
            : "The requested build style was kept.",
      },
      {
        category: "Firmware",
        selection: `${input.request.firmware.platform} / ${input.request.firmware.language}`,
        rationale: `Pin constants are generated from the compiled circuit into include/generated_pins.h and used everywhere.`,
      },
    ],
    components: circuit.components,
    nets: circuit.nets,
    validationResults,
    bom: generateBom(circuit),
    assemblySteps: generateAssemblySteps(circuit),
    ...(componentResearch.length ? { componentResearch } : {}),
    powerEstimate: {
      totalTypicalMa: circuit.currentEstimate.totalTypicalMa,
      totalMaximumMa: circuit.currentEstimate.totalMaximumMa,
      perRailTypicalMa: { ...circuit.currentEstimate.perRailTypicalMa },
      unknownComponentIds: [...circuit.currentEstimate.unknownComponentIds],
    },
    firmware: firmware.project,
  };

  const laidOut = layoutDesign(design);
  design.components = laidOut.components;
  design.circuitJson = toCircuitJson(design);

  return {
    design,
    circuit,
    ...(firmware.rejectedLogicReason ? { firmwareNotice: firmware.rejectedLogicReason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Modification
// ---------------------------------------------------------------------------

export interface ModificationOutcome {
  request: HardwareProjectRequest;
  applied: string[];
  rejected: string[];
}

function describePeripheral(design: HardwareDesign, componentId: string): string | null {
  const instance = design.components.find((candidate) => candidate.id === componentId);
  return instance ? instance.definitionId : null;
}

/**
 * Rewrite the request so that recompiling produces the asked-for change.
 * Operations that name something the design does not contain are rejected with
 * a reason rather than silently ignored.
 */
export function applyModification(
  design: HardwareDesign,
  modification: HardwareDesignModification,
): ModificationOutcome {
  const scopedDefinitions = scopedDefinitionsForDesign(design);
  const definitionOf = (id: string) => componentDefinition(id, scopedDefinitions);
  const request: HardwareProjectRequest = structuredClone(design.request);
  const applied: string[] = [];
  const rejected: string[] = [];

  const removeByDefinitionId = (definitionId: string): boolean => {
    let removed = false;
    for (const key of ["inputs", "outputs"] as const) {
      const remaining = request[key].filter((entry) => {
        const matches = matchesDefinition(entry.type, definitionId, scopedDefinitions);
        if (matches) removed = true;
        return !matches;
      });
      request[key] = remaining;
    }
    return removed;
  };

  for (const operation of modification.operations) {
    if (operation.type === "replace-component") {
      const definitionId = describePeripheral(design, operation.targetComponentId);
      const replacement = definitionOf(operation.replacementDefinitionId);
      if (!definitionId) {
        rejected.push(`No component ${operation.targetComponentId} exists in this design.`);
        continue;
      }
      if (!replacement) {
        rejected.push(`${operation.replacementDefinitionId} is not in the component library.`);
        continue;
      }
      const current = definitionOf(definitionId);
      if (current && isController(definitionId)) {
        if (!isController(replacement.id)) {
          rejected.push(`${replacement.name} is not a controller board.`);
          continue;
        }
        request.controller = replacement.name;
        applied.push(`Controller changed to ${replacement.name}.`);
        continue;
      }
      if (!removeByDefinitionId(definitionId)) {
        rejected.push(`${current?.name ?? definitionId} was not listed in the request.`);
        continue;
      }
      request.outputs.push({ type: replacement.name, quantity: 1 });
      applied.push(`${current?.name ?? definitionId} replaced with ${replacement.name}.`);
      continue;
    }

    if (operation.type === "add-component") {
      const definition = definitionOf(operation.componentDefinitionId);
      if (!definition) {
        rejected.push(`${operation.componentDefinitionId} is not in the component library.`);
        continue;
      }
      if (isController(definition.id)) {
        request.controller = definition.name;
        applied.push(`Controller changed to ${definition.name}.`);
        continue;
      }
      const list = definition.category === "sensor" || definition.category === "input"
        ? request.inputs
        : request.outputs;
      list.push({
        type: definition.name,
        quantity: operation.quantity,
        ...(operation.requestedPurpose
          ? { constraints: { purpose: operation.requestedPurpose } }
          : {}),
      });
      applied.push(
        `${definition.name}${operation.quantity > 1 ? ` ×${operation.quantity}` : ""} added.`,
      );
      continue;
    }

    if (operation.type === "remove-component") {
      const definitionId = describePeripheral(design, operation.targetComponentId);
      if (!definitionId) {
        rejected.push(`No component ${operation.targetComponentId} exists in this design.`);
        continue;
      }
      if (isController(definitionId)) {
        rejected.push("The controller cannot be removed; replace it instead.");
        continue;
      }
      if (!removeByDefinitionId(definitionId)) {
        rejected.push(
          `${definitionOf(definitionId)?.name ?? definitionId} was added automatically and cannot be removed on its own.`,
        );
        continue;
      }
      applied.push(`${definitionOf(definitionId)?.name ?? definitionId} removed.`);
      continue;
    }

    if (operation.type === "change-power") {
      request.power = { ...operation.source };
      applied.push(`Power source changed to ${operation.source.source}.`);
      continue;
    }

    if (operation.type === "change-constraint") {
      const { key, value } = operation;
      if (key === "beginnerFriendly" && typeof value === "boolean") {
        request.constraints.beginnerFriendly = value;
        applied.push(`Beginner-friendly set to ${value}.`);
      } else if (key === "maximumCost" && typeof value === "number") {
        request.constraints.maximumCost = value;
        applied.push(`Maximum cost set to ${value}.`);
      } else if (key === "prototypeType" && isPrototypeType(value)) {
        request.prototypeType = value;
        applied.push(`Prototype style set to ${value}.`);
      } else if (key === "firmwarePlatform" && isFirmwarePlatform(value)) {
        request.firmware.platform = value;
        applied.push(`Firmware platform set to ${value}.`);
      } else if (key === "purpose" && typeof value === "string" && value.trim()) {
        request.purpose = value.trim();
        applied.push("Project purpose updated.");
      } else {
        rejected.push(`Constraint "${key}" cannot be changed to that value.`);
      }
    }
  }

  return { request, applied, rejected };
}

function isPrototypeType(value: unknown): value is HardwareProjectRequest["prototypeType"] {
  return value === "breadboard" || value === "perfboard" || value === "pcb";
}

function isFirmwarePlatform(
  value: unknown,
): value is HardwareProjectRequest["firmware"]["platform"] {
  return value === "arduino" || value === "platformio" || value === "esp-idf" || value === "pico-sdk";
}

/** Does a request phrase name this library part? Used when rewriting a request. */
function matchesDefinition(
  phrase: string,
  definitionId: string,
  scopedDefinitions: readonly ComponentDefinition[] = [],
): boolean {
  const definition = componentDefinition(definitionId, scopedDefinitions);
  if (!definition) return false;
  const normalized = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === definition.name.toLowerCase() ||
    normalized === definition.id ||
    definition.aliases.some((alias) => normalized === alias || normalized.includes(alias))
  );
}
