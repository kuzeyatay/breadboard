// Bill of materials, built from the compiled component list.
//
// Prices are the library's own coarse estimates and are always marked as such.
// Nothing here queries a supplier, and no price is invented for a part that has
// no figure in the library.

import { componentDefinition } from "./components/index.ts";
import type { CompiledCircuit } from "./compiler.ts";
import type { BomItem } from "./types.ts";

function purposeFor(
  circuit: CompiledCircuit,
  instanceId: string,
  fallback: string,
): string {
  const instance = circuit.components.find((candidate) => candidate.id === instanceId);
  if (instance?.additionReason) return instance.additionReason;
  const placement = circuit.peripherals.find(
    (candidate) => candidate.instance.id === instanceId,
  );
  if (placement) {
    const bus =
      placement.interfaceKind === "i2c"
        ? "on the shared I²C bus"
        : placement.interfaceKind === "spi"
          ? "on the SPI bus"
          : placement.interfaceKind === "uart"
            ? "on the UART link"
            : placement.signalPins.length
              ? `on ${placement.signalPins
                  .map((signal) => signal.assignment.controllerPinLabel)
                  .join(" and ")}`
              : "";
    return `${placement.definition.description.split(".")[0]}${bus ? `, ${bus}` : ""}.`;
  }
  return fallback;
}

export function generateBom(circuit: CompiledCircuit): BomItem[] {
  // Identical automatically added parts (three 220 Ω resistors, say) collapse
  // into one row so the list reads like something you can order.
  const groups = new Map<string, { references: string[]; instanceIds: string[] }>();
  for (const instance of circuit.components) {
    const key = `${instance.definitionId}::${instance.value ?? ""}`;
    const group = groups.get(key) ?? { references: [], instanceIds: [] };
    group.references.push(instance.reference);
    group.instanceIds.push(instance.id);
    groups.set(key, group);
  }

  const items: BomItem[] = [];
  for (const [key, group] of groups) {
    const [definitionId] = key.split("::");
    const definition = componentDefinition(definitionId, circuit.scopedDefinitions);
    if (!definition) continue;
    const first = circuit.components.find((instance) => instance.id === group.instanceIds[0])!;
    const quantity = group.instanceIds.length;
    const unitPrice = definition.estimatedUnitPrice;
    items.push({
      reference: group.references.join(", "),
      componentDefinitionId: definition.id,
      name: definition.name,
      ...(first.value ? { valueOrModel: first.value } : {}),
      quantity,
      purpose: purposeFor(circuit, first.id, definition.description),
      ...(definition.manufacturer ? { manufacturer: definition.manufacturer } : {}),
      ...(definition.manufacturerPartNumber
        ? { manufacturerPartNumber: definition.manufacturerPartNumber }
        : {}),
      ...(unitPrice === undefined
        ? {}
        : {
            estimatedUnitPrice: unitPrice,
            estimatedTotalPrice: Math.round(unitPrice * quantity * 100) / 100,
          }),
      priceIsEstimate: true,
      substitutes: definition.substitutes ?? [],
    });
  }

  // Controller first, then the parts that do something, then passives and
  // prototyping hardware — the order somebody would actually buy them in.
  const rank = (item: BomItem): number => {
    const category = componentDefinition(item.componentDefinitionId, circuit.scopedDefinitions)?.category ?? "";
    if (category === "controller") return 0;
    if (["sensor", "display", "actuator", "input", "indicator"].includes(category)) return 1;
    if (category === "passive") return 2;
    return 3;
  };
  return items.sort(
    (left, right) => rank(left) - rank(right) || left.reference.localeCompare(right.reference),
  );
}

export function bomToCsv(items: BomItem[]): string {
  const header = [
    "Reference",
    "Component",
    "Value or model",
    "Quantity",
    "Purpose",
    "Manufacturer",
    "MPN",
    "Estimated unit price",
    "Estimated total price",
    "Price is an estimate",
    "Substitutes",
  ];
  const escape = (value: string | number | boolean | undefined): string => {
    if (value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = items.map((item) =>
    [
      item.reference,
      item.name,
      item.valueOrModel,
      item.quantity,
      item.purpose,
      item.manufacturer,
      item.manufacturerPartNumber,
      item.estimatedUnitPrice,
      item.estimatedTotalPrice,
      item.priceIsEstimate ? "yes" : "no",
      item.substitutes.join("; "),
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}
