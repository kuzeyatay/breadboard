// Assembly instructions generated from the compiled graph.
//
// Every step names real references, real pin labels and real values because it
// reads them off the nets and pin assignments the compiler produced. No step is
// written by a model, so an instruction can never contradict the wiring.

import { componentDefinition } from "./components/index.ts";
import type { CompiledCircuit } from "./compiler.ts";
import type { AssemblyStep, ComponentInstance, ElectricalNet } from "./types.ts";

interface StepDraft {
  title: string;
  instruction: string;
  componentIds: string[];
  netIds: string[];
  verification?: string;
  warning?: string;
}

function pinLabel(instance: ComponentInstance, pinId: string): string {
  const definition = componentDefinition(instance.definitionId);
  return definition?.pins.find((pin) => pin.id === pinId)?.label ?? pinId;
}

/** "U2 SDA" style endpoint text used throughout the instructions. */
function endpoint(
  instance: ComponentInstance | undefined,
  pinId: string,
): string {
  if (!instance) return pinId;
  return `${instance.reference} ${pinLabel(instance, pinId)}`;
}

export function generateAssemblySteps(circuit: CompiledCircuit): AssemblyStep[] {
  const drafts: StepDraft[] = [];
  const byId = new Map(circuit.components.map((instance) => [instance.id, instance]));
  const controller = circuit.controllerInstance;
  const groundNet = circuit.nets.find((net) => net.id === circuit.groundNetId);
  const powerNets = circuit.nets.filter((net) => net.role === "power");
  const supportParts = circuit.components.filter((instance) => instance.automaticallyAdded);
  const modules = circuit.peripherals.map((placement) => placement.instance);

  drafts.push({
    title: "Disconnect all power",
    instruction:
      "Unplug the USB cable and disconnect any battery or bench supply before touching the circuit. Every step below is done on an unpowered board.",
    componentIds: [],
    netIds: [],
    warning: "Wiring a live circuit can short a supply through a part and destroy it.",
    verification: "Nothing on the board is lit and no supply is connected.",
  });

  const board = circuit.components.find(
    (instance) => componentDefinition(instance.definitionId)?.category === "prototyping" &&
      instance.definitionId === "breadboard-830",
  );
  drafts.push({
    title: `Place ${controller.reference} ${controller.name}`,
    instruction: board
      ? `Press ${controller.reference} (${controller.name}) into ${board.reference} so its two pin rows straddle the centre channel, with the USB connector facing off the end of the board.`
      : `Mount ${controller.reference} (${controller.name}) where its USB connector stays reachable.`,
    componentIds: [controller.id, ...(board ? [board.id] : [])],
    netIds: [],
    verification: `Each pin of ${controller.reference} sits in its own row, and no two pins share a row.`,
  });

  if (modules.length) {
    drafts.push({
      title: "Place the modules",
      instruction: modules
        .map(
          (instance) =>
            `${instance.reference} (${instance.name})${
              instance.properties.i2cAddress
                ? ` at I²C address ${instance.properties.i2cAddress}`
                : ""
            }`,
        )
        .join("; ") + ". Leave space between them so every header pin is reachable.",
      componentIds: modules.map((instance) => instance.id),
      netIds: [],
      verification: "Every module sits flat with all of its header pins in separate rows.",
    });
  }

  if (groundNet) {
    drafts.push({
      title: "Establish the ground rail",
      instruction: buildNetInstruction(groundNet, byId, controller, "ground"),
      componentIds: groundNet.connections.map((connection) => connection.componentId),
      netIds: [groundNet.id],
      verification:
        "With a multimeter in continuity mode, every ground point above beeps against the ground rail.",
    });
  }

  for (const net of powerNets) {
    const voltage = net.nominalVoltage ?? 0;
    drafts.push({
      title: `Establish the ${voltage} V rail`,
      instruction: buildNetInstruction(net, byId, controller, "power"),
      componentIds: net.connections.map((connection) => connection.componentId),
      netIds: [net.id],
      warning:
        voltage >= 5
          ? "Check each module's supply pin before you connect it. A 3.3 V-only part put on 5 V is destroyed immediately."
          : undefined,
      verification: `Nothing on the ${voltage} V rail is connected to the ground rail — a continuity test between them must stay silent.`,
    });
  }

  if (supportParts.length) {
    const described = supportParts
      .filter((instance) => instance.definitionId !== "breadboard-830" && instance.definitionId !== "power-rails")
      .map((instance) => {
        const connections = circuit.nets.flatMap((net) =>
          net.connections
            .filter((connection) => connection.componentId === instance.id)
            .map((connection) => ({ net, pinId: connection.pinId })),
        );
        const label = `${instance.reference}${instance.value ? ` (${instance.value})` : ""}`;

        // Two-lead parts read best as "between A and B"; a part with a header
        // needs each of its pins named, or the instruction is unfollowable.
        if (connections.length > 2) {
          const perPin = connections
            .map(({ net, pinId }) => `${pinLabel(instance, pinId)} to ${net.name}`)
            .join(", ");
          return `${label}: ${perPin}`;
        }
        const endpoints = connections
          .map(({ net }) => {
            const other = net.connections.find(
              (connection) => connection.componentId !== instance.id,
            );
            return other
              ? `${net.name} (${endpoint(byId.get(other.componentId), other.pinId)})`
              : net.name;
          })
          .join(" and ");
        return `${label} between ${endpoints}`;
      });
    if (described.length) {
      drafts.push({
        title: "Fit the support components",
        instruction: `Fit ${described.join("; ")}. ${supportParts
          .map((instance) => instance.additionReason)
          .filter(Boolean)
          .join(" ")}`,
        componentIds: supportParts.map((instance) => instance.id),
        netIds: circuit.nets
          .filter((net) =>
            net.connections.some((connection) =>
              supportParts.some((instance) => instance.id === connection.componentId),
            ),
          )
          .map((net) => net.id),
        verification: "Each support component's value matches the list above before you wire it in.",
      });
    }
  }

  const busNets = circuit.nets.filter((net) =>
    ["i2c-sda", "i2c-scl", "spi-clock", "spi-data", "uart-tx", "uart-rx"].includes(net.role),
  );
  for (const net of busNets) {
    drafts.push({
      title: `Connect ${net.name}`,
      instruction: buildNetInstruction(net, byId, controller, "signal"),
      componentIds: net.connections.map((connection) => connection.componentId),
      netIds: [net.id],
      verification: `${net.name} reaches every device listed and nothing else.`,
    });
  }

  const signalNets = circuit.nets.filter(
    (net) =>
      !busNets.includes(net) &&
      net.role !== "power" &&
      net.role !== "ground" &&
      net.connections.length > 1,
  );
  if (signalNets.length) {
    drafts.push({
      title: "Connect the remaining signals",
      instruction: signalNets
        .map((net) => buildNetInstruction(net, byId, controller, "signal"))
        .join(" "),
      componentIds: [
        ...new Set(signalNets.flatMap((net) => net.connections.map((c) => c.componentId))),
      ],
      netIds: signalNets.map((net) => net.id),
      verification: "Each signal wire runs to exactly the pin named above.",
    });
  }

  const oriented = circuit.components.filter((instance) =>
    ["led-5mm", "capacitor", "diode-1n4007", "mosfet-logic-level"].includes(instance.definitionId),
  );
  if (oriented.length) {
    drafts.push({
      title: "Check polarity and orientation",
      instruction: oriented
        .map((instance) => {
          if (instance.definitionId === "led-5mm") {
            return `${instance.reference}: the long leg (anode) goes to the resistor, the short leg beside the flat edge of the rim (cathode) goes to ground.`;
          }
          if (instance.definitionId === "diode-1n4007") {
            const cathodeNet = circuit.nets.find((net) =>
              net.connections.some(
                (connection) => connection.componentId === instance.id && connection.pinId === "K",
              ),
            );
            return `${instance.reference}: the banded end (cathode) goes to ${
              cathodeNet?.name ?? "the positive rail"
            }, the plain end to the switched side. Backwards it shorts the rail.`;
          }
          if (instance.definitionId === "mosfet-logic-level") {
            return `${instance.reference}: with the printed face towards you and the legs down, the pins are gate, drain, source from the left. The metal tab is the drain.`;
          }
          return `${instance.reference}: if it is polarised, the striped or shorter lead goes to ground.`;
        })
        .join(" "),
      componentIds: oriented.map((instance) => instance.id),
      netIds: [],
      warning:
        "A polarised part fitted backwards either does nothing or fails short. A flyback diode fitted backwards shorts the supply the moment you power up.",
      verification: "Every part above points the way described.",
    });
  }

  drafts.push({
    title: "Inspect and test continuity",
    instruction:
      "With the supply still disconnected, walk the wiring against the list above once. Then set a multimeter to continuity and check that the ground rail beeps against every ground pin, and that no power rail beeps against ground.",
    componentIds: [],
    netIds: [circuit.groundNetId, ...powerNets.map((net) => net.id)],
    warning:
      "A short between a power rail and ground found after power-up usually means a damaged regulator. Find it now.",
    verification: "Ground is continuous everywhere and no rail is shorted to it.",
  });

  const usbPowered = circuit.profile.rails.some((rail) => rail.voltage === 5);
  drafts.push({
    title: "Connect power",
    instruction: usbPowered
      ? `Plug ${controller.reference} into USB. If a bench supply is available, set it to current-limit at ${Math.max(
          200,
          Math.ceil((circuit.currentEstimate.totalMaximumMa * 1.3) / 50) * 50,
        )} mA first and power the board from that instead.`
      : `Connect the supply to ${controller.reference}.`,
    componentIds: [controller.id],
    netIds: powerNets.map((net) => net.id),
    warning:
      "If anything gets warm, smells, or the supply hits its current limit, disconnect immediately and re-check the rails.",
    verification: `The board's power LED lights and the supply settles near the estimated ${Math.round(
      circuit.currentEstimate.totalTypicalMa,
    )} mA.`,
  });

  drafts.push({
    title: "Verify start-up",
    instruction: `Open a serial monitor at ${circuit.profile.firmware.serialBaud} baud and reset ${controller.reference}. The firmware prints a start-up banner and then one line per initialised part.`,
    componentIds: [controller.id, ...modules.map((instance) => instance.id)],
    netIds: [],
    verification:
      "Every part reports that it initialised. A part that reports a failure is wired wrong or sitting on the wrong address.",
  });

  return drafts.map((draft, index) => ({
    id: `step_${index + 1}`,
    index: index + 1,
    ...draft,
  }));
}

/** One sentence per net, naming both ends of every wire it needs. */
function buildNetInstruction(
  net: ElectricalNet,
  byId: Map<string, ComponentInstance>,
  controller: ComponentInstance,
  kind: "ground" | "power" | "signal",
): string {
  const controllerEnd = net.connections.find(
    (connection) => connection.componentId === controller.id,
  );
  const others = net.connections.filter((connection) => connection.componentId !== controller.id);

  if (kind === "ground") {
    const railComponent = others.find(
      (connection) => byId.get(connection.componentId)?.definitionId === "power-rails",
    );
    const rail = railComponent
      ? `Run a wire from ${endpoint(controller, controllerEnd?.pinId ?? "GND")} to the − rail of ${
          byId.get(railComponent.componentId)?.reference ?? "the breadboard"
        }. `
      : "";
    const rest = others
      .filter((connection) => connection !== railComponent)
      .map((connection) => endpoint(byId.get(connection.componentId), connection.pinId));
    return `${rail}${
      rest.length
        ? `Then run a wire from ${rest.join(", from ")} to the same ground rail.`
        : ""
    }`.trim();
  }

  if (kind === "power") {
    const voltage = net.nominalVoltage ?? 0;
    const railComponent = others.find(
      (connection) => byId.get(connection.componentId)?.definitionId === "power-rails",
    );
    const rail = railComponent
      ? `Run a wire from ${endpoint(controller, controllerEnd?.pinId ?? "")} to the + rail of ${
          byId.get(railComponent.componentId)?.reference ?? "the breadboard"
        }. `
      : "";
    const rest = others
      .filter((connection) => connection !== railComponent)
      .map((connection) => endpoint(byId.get(connection.componentId), connection.pinId));
    return `${rail}${
      rest.length
        ? `Then run a wire from the ${voltage} V rail to ${rest.join(", and to ")}.`
        : `Bring ${voltage} V to ${endpoint(controller, controllerEnd?.pinId ?? "")}.`
    }`.trim();
  }

  const from = controllerEnd
    ? endpoint(controller, controllerEnd.pinId)
    : others[0]
      ? endpoint(byId.get(others[0].componentId), others[0].pinId)
      : net.name;
  const targets = (controllerEnd ? others : others.slice(1)).map((connection) =>
    endpoint(byId.get(connection.componentId), connection.pinId),
  );
  if (!targets.length) return `${net.name} has only one end and needs no wire yet.`;
  return `Connect ${from} to ${targets.join(" and to ")} on the ${net.name} net.`;
}
