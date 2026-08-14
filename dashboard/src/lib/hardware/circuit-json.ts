// Circuit JSON emitter.
//
// Circuit JSON is the tscircuit interchange format: a flat array of typed
// elements. What is emitted here is its source-level subset — components,
// ports, nets and traces — plus schematic placement boxes. That is enough for
// another tool to read the netlist; it is deliberately not a PCB, and nothing
// downstream should claim otherwise.

import { componentDefinitionForDesign } from "./components/index.ts";
import type { HardwareDesign } from "./types.ts";

export interface CircuitJsonSourceComponent {
  type: "source_component";
  source_component_id: string;
  name: string;
  ftype?: string;
  display_value?: string;
  manufacturer_part_number?: string;
  supplier_part_numbers?: Record<string, string[]>;
}

export interface CircuitJsonSourcePort {
  type: "source_port";
  source_port_id: string;
  source_component_id: string;
  name: string;
  pin_number?: number;
  port_hints: string[];
}

export interface CircuitJsonSourceNet {
  type: "source_net";
  source_net_id: string;
  name: string;
  member_source_group_ids: string[];
  is_power?: boolean;
  is_ground?: boolean;
}

export interface CircuitJsonSourceTrace {
  type: "source_trace";
  source_trace_id: string;
  connected_source_port_ids: string[];
  connected_source_net_ids: string[];
}

export interface CircuitJsonSchematicComponent {
  type: "schematic_component";
  schematic_component_id: string;
  source_component_id: string;
  center: { x: number; y: number };
  size: { width: number; height: number };
  symbol_name?: string;
}

export type CircuitJsonElement =
  | CircuitJsonSourceComponent
  | CircuitJsonSourcePort
  | CircuitJsonSourceNet
  | CircuitJsonSourceTrace
  | CircuitJsonSchematicComponent;

/** Circuit JSON's `ftype` vocabulary, for the parts that have one. */
const FTYPE_BY_DEFINITION: Record<string, string> = {
  resistor: "simple_resistor",
  capacitor: "simple_capacitor",
  "led-5mm": "simple_diode",
  "diode-1n4007": "simple_diode",
  "mosfet-logic-level": "simple_transistor",
  "push-button": "simple_push_button",
  potentiometer: "simple_potentiometer",
};

function portId(componentId: string, pinId: string): string {
  return `source_port_${componentId}_${pinId}`.replace(/[^A-Za-z0-9_]/g, "_");
}

export function toCircuitJson(design: HardwareDesign): CircuitJsonElement[] {
  const elements: CircuitJsonElement[] = [];

  for (const instance of design.components) {
    const definition = componentDefinitionForDesign(design, instance.definitionId);
    if (!definition) continue;
    elements.push({
      type: "source_component",
      source_component_id: instance.id,
      name: instance.reference,
      ...(FTYPE_BY_DEFINITION[instance.definitionId]
        ? { ftype: FTYPE_BY_DEFINITION[instance.definitionId] }
        : {}),
      ...(instance.value ? { display_value: instance.value } : {}),
      ...(definition.manufacturerPartNumber
        ? { manufacturer_part_number: definition.manufacturerPartNumber }
        : {}),
    });

    definition.pins.forEach((pin, index) => {
      elements.push({
        type: "source_port",
        source_port_id: portId(instance.id, pin.id),
        source_component_id: instance.id,
        name: pin.id,
        pin_number: index + 1,
        port_hints: [pin.id, pin.label, ...pin.functions],
      });
    });

    if (instance.position) {
      elements.push({
        type: "schematic_component",
        schematic_component_id: `schematic_${instance.id}`,
        source_component_id: instance.id,
        center: { x: instance.position.x, y: instance.position.y },
        size: {
          width: definition.visual.width,
          height: definition.visual.height,
        },
        symbol_name: definition.visual.assetId ?? definition.visual.elementName ?? "generic",
      });
    }
  }

  for (const net of design.nets) {
    elements.push({
      type: "source_net",
      source_net_id: net.id,
      name: net.name,
      member_source_group_ids: [],
      ...(net.role === "power" ? { is_power: true } : {}),
      ...(net.role === "ground" ? { is_ground: true } : {}),
    });
    elements.push({
      type: "source_trace",
      source_trace_id: `source_trace_${net.id}`,
      connected_source_port_ids: net.connections.map((connection) =>
        portId(connection.componentId, connection.pinId),
      ),
      connected_source_net_ids: [net.id],
    });
  }

  return elements;
}
