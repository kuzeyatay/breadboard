/** Non-overlapping placement and colored airwires adapted from svCircuit. */
import type { Circuit, Device } from "./model.ts";
export type Point = { x: number; y: number };
export type Placement = Point & { rotation: number };
export type Terminal = Point & { device: string; pin: string; node: string };
export type Layout = { positions: Record<string, Placement>; width: number; height: number };
export const netColor = (node: string): string => {
  let hash = 0;
  for (const char of node) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return ["#2563eb", "#c2410c", "#0f766e", "#9333ea", "#be185d", "#4d7c0f", "#0369a1"][Math.abs(hash) % 7];
};

export function blockSymbol(device: Device): boolean {
  if (device.symbol === "opamp") return false;
  return device.kind === "X" || device.pins.length > 4 || ["S", "W", "T", "O"].includes(device.kind);
}

export function pinOffsets(device: Device): Point[] {
  if (device.symbol === "opamp") return [{ x: -60, y: -24 }, { x: -60, y: 24 }, { x: 0, y: -60 }, { x: 0, y: 60 }, { x: 72, y: 0 }];
  if (blockSymbol(device)) {
    const half = Math.ceil(device.pins.length / 2);
    return device.pins.map((_, i) => ({ x: i < half ? -72 : 72, y: ((i % half) - (half - 1) / 2) * 24 }));
  }
  if (["Q", "M", "J"].includes(device.kind)) return [{ x: 36, y: -60 }, { x: -60, y: 0 }, { x: 36, y: 60 }, { x: 60, y: 0 }].slice(0, device.pins.length);
  const ends = [{ x: -48, y: 0 }, { x: 48, y: 0 }];
  return device.pins.length === 4 ? [...ends, { x: -20, y: 50 }, { x: 20, y: 50 }] : ends;
}

export function initialLayout(circuit: Circuit): Layout {
  const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(circuit.devices.length))));
  const positions: Record<string, Placement> = Object.create(null);
  let y = 90;
  for (let start = 0; start < circuit.devices.length; start += columns) {
    const row = circuit.devices.slice(start, start + columns);
    const height = Math.max(180, ...row.map((d) => blockSymbol(d) ? Math.ceil(d.pins.length / 2) * 24 + 110 : 180));
    row.forEach((device, column) => { positions[device.id] = { x: 130 + column * 250, y: y + height / 2 - 90, rotation: 0 }; });
    y += height;
  }
  return { positions, width: columns * 250 + 10, height: Math.max(200, y - 30) };
}

export function terminals(device: Device, placement: Placement): Terminal[] {
  const angle = placement.rotation * Math.PI / 180;
  return pinOffsets(device).map((point, i) => ({
    x: placement.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: placement.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
    device: device.id, ...device.pins[i], pin: device.pins[i].name,
  }));
}

/** Connect adjacent terminals, O(pins), rather than a quadratic complete graph. */
export function circuitNets(circuit: Circuit, positions: Layout["positions"]): Map<string, Terminal[]> {
  const nets = new Map<string, Terminal[]>();
  for (const device of circuit.devices) for (const terminal of terminals(device, positions[device.id])) {
    const members = nets.get(terminal.node) ?? [];
    members.push(terminal); nets.set(terminal.node, members);
  }
  return nets;
}
