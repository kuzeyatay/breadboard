import { parseNetlist, type Netlist } from "./model.ts";
import { pinOffsets, type Placement, type Point } from "./layout.ts";

export type ProjectWire = { net: string; from: [string, number]; to: [string, number]; points: [number, number][] };
export type CircuitProject = {
  schema: "breadboard.circuit-project/v1";
  title: string;
  netlist: string;
  circuit_sha256: string;
  circuit: { components: Array<{ id: string; type: string; nodes: string[] }>; [key: string]: unknown };
  schematic: { width: number; height: number; positions: Record<string, Placement>; wires: ProjectWire[]; junctions: Array<Point & { net: string }>; global_nets: string[]; connected: boolean; issues: string[] };
  review: { component_counts: Record<string, number>; warnings: string[]; simulation_status: string; hardware_status: string };
};
const bounded = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000;

export function readCircuitDocument(source: string, filename: string): { document: Netlist; project: CircuitProject | null; netlist: string } {
  if (!filename.toLowerCase().endsWith(".bbcir")) return { document: parseNetlist(source), project: null, netlist: source };
  try {
    const value = JSON.parse(source) as CircuitProject;
    if (value.schema !== "breadboard.circuit-project/v1" || typeof value.netlist !== "string" || !value.circuit || !Array.isArray(value.circuit.components)) throw Error("Unsupported circuit project.");
    const document = parseNetlist(value.netlist), top = document.circuits[0];
    if (document.diagnostics.some(d => d.severity === "error")) throw Error("Circuit project contains an invalid netlist.");
    const scene = value.schematic;
    if (!scene || !bounded(scene.width) || !bounded(scene.height) || scene.width < 1 || scene.height < 1 || !scene.positions || !Array.isArray(scene.wires) || scene.wires.length > 5000 || !Array.isArray(scene.junctions) || scene.junctions.length > 10000 || !Array.isArray(scene.global_nets) || scene.global_nets.some(n => typeof n !== "string")) throw Error("Invalid schematic geometry.");
    if (top.devices.length !== value.circuit.components.length) throw Error("Project circuit and netlist component counts disagree.");
    if (scene.connected !== true || !Array.isArray(scene.issues) || scene.issues.length) throw Error("Project schematic has incomplete connections.");
    const groups = new Map<string, Set<string>>();
    const parent = new Map<string, string>();
    const root = (id: string): string => { const p = parent.get(id); if (!p || p === id) return id; const r = root(p); parent.set(id, r); return r; };
    for (const device of top.devices) {
      const component = value.circuit.components.find(c => c.id === device.id);
      if (!component) throw Error("Circuit component is missing.");
      if (component.nodes.length && component.nodes.map(n => n.toLowerCase()).join("\0") !== device.pins.map(p => p.node).join("\0")) throw Error(`Circuit and netlist terminals disagree for ${device.id}.`);
      if (component.type === "opamp") device.symbol = "opamp";
      const p = scene.positions[device.id];
      if (!p || !bounded(p.x) || !bounded(p.y) || ![0, 90, 180, 270].includes(p.rotation)) throw Error(`Invalid placement for ${device.id}.`);
      device.pins.forEach((pin, i) => { const members = groups.get(pin.node) ?? new Set<string>(); members.add(`${device.id}.${i + 1}`); groups.set(pin.node, members); });
    }
    let pointCount = 0;
    for (const wire of scene.wires) {
      if (typeof wire.net !== "string" || !Array.isArray(wire.points) || wire.points.length < 2 || wire.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(bounded))) throw Error("Invalid wire points.");
      pointCount += wire.points.length;
      if (pointCount > 100_000) throw Error("Schematic has too many wire points.");
      if (wire.points.some((p, i) => i > 0 && Math.abs(p[0] - wire.points[i - 1][0]) > 0.01 && Math.abs(p[1] - wire.points[i - 1][1]) > 0.01)) throw Error("Schematic wire is not orthogonal.");
      for (const [end, index] of [[wire.from, 0], [wire.to, wire.points.length - 1]] as const) {
        if (!Array.isArray(end)) throw Error("Missing wire endpoint.");
        const device = top.devices.find(d => d.id === end[0]);
        if (!device || !Number.isInteger(end[1]) || device.pins[end[1] - 1]?.node !== wire.net) throw Error("Wire connects incompatible circuit terminals.");
        const pin = pinOffsets(device)[end[1] - 1], p = scene.positions[device.id], angle = p.rotation * Math.PI / 180;
        const expected = [p.x + pin.x * Math.cos(angle) - pin.y * Math.sin(angle), p.y + pin.x * Math.sin(angle) + pin.y * Math.cos(angle)];
        if (expected.some((n, i) => Math.abs(n - wire.points[index][i]) > 0.01)) throw Error("Wire endpoint does not meet its symbol pin.");
      }
      parent.set(root(`${wire.from[0]}.${wire.from[1]}`), root(`${wire.to[0]}.${wire.to[1]}`));
    }
    // Only ground and the actual static supply rails may replace drawn wires.
    const allowedGlobals = new Set(["0"]);
    for (const d of top.devices) if (d.kind === "V" && /^(VCC|VEE|VDD|VSS)$/i.test(d.id) && !/\b(?:sin|pulse|pwl)\s*\(/i.test(d.value)) d.pins.forEach(p => allowedGlobals.add(p.node));
    if (scene.global_nets.some(n => !allowedGlobals.has(n))) throw Error("A signal net cannot be hidden as a supply label.");
    for (const [net, members] of groups) if (!scene.global_nets.includes(net) && new Set([...members].map(root)).size > 1) throw Error(`Schematic is missing connections on ${net}.`);
    if (scene.junctions.some(p => !bounded(p.x) || !bounded(p.y) || typeof p.net !== "string")) throw Error("Invalid wire junction.");
    if (!value.review || !Array.isArray(value.review.warnings) || value.review.warnings.some(w => typeof w !== "string")) throw Error("Missing project review.");
    return { document, project: value, netlist: value.netlist };
  } catch (error) {
    const document = parseNetlist("");
    document.diagnostics = [{ severity: "error", line: 1, message: error instanceof Error ? error.message : "Invalid circuit project." }];
    return { document, project: null, netlist: source };
  }
}
