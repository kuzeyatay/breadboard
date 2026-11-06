/** SVG equivalents of netlist-viewer's device symbols. See vendor notices. */
import type { Device } from "@/lib/netlist-viewer/model";
import { blockSymbol, pinOffsets } from "@/lib/netlist-viewer/layout";

export default function NetlistSymbol({ device }: { device: Device }) {
  const offsets = pinOffsets(device);
  if (device.symbol === "opamp") return <g>
    <path d="M-36 -48 L48 0 L-36 48 Z" fill="var(--nl-bg, #ffffff)" />
    <path d="M-60 -24 H-36 M-60 24 H-36 M48 0 H72 M0 -60 V-28 M0 60 V28" />
    <text x={-29} y={-18} fontSize={12} stroke="none" fill="currentColor">+</text>
    <text x={-29} y={29} fontSize={12} stroke="none" fill="currentColor">−</text>
  </g>;
  if (blockSymbol(device)) {
    const height = Math.max(44, Math.ceil(device.pins.length / 2) * 24);
    return <g>
      <rect x={-44} y={-height / 2} width={88} height={height} rx={4} fill="var(--nl-bg, #ffffff)" />
      {offsets.map((p, i) => <g key={i}><path d={`M ${p.x} ${p.y} H ${p.x < 0 ? -44 : 44}`} /><text x={p.x < 0 ? -38 : 38} y={p.y + 3} textAnchor={p.x < 0 ? "start" : "end"} fontSize="9" stroke="none" fill="currentColor">{device.pins[i].name.slice(0, 9)}</text></g>)}
    </g>;
  }
  if (["Q", "M", "J"].includes(device.kind)) {
    const bipolar = device.kind === "Q";
    const pType = device.modelType?.startsWith("P") ?? false;
    return <g>
      <path d="M -60 0 H -16 M -16 -23 V 23 M 36 -60 V -24 L -8 -12 M 36 60 V 24 L -8 12" />
      {!bipolar && <path d="M -8 -23 V 23" />}
      {bipolar ? <path d={pType ? "M 6 17 L 17 17 L 12 27 Z" : "M 28 33 L 16 29 L 22 21 Z"} fill="currentColor" /> : <path d={pType ? "M -8 0 L 0 -4 V 4 Z" : "M -2 0 L -10 -4 V 4 Z"} fill="currentColor" />}
      {device.pins.length === 4 && <path d="M 60 0 H 2" />}
      <text x={42} y={-28} fontSize="9" stroke="none" fill="currentColor">{bipolar ? "C" : "D"}</text>
      <text x={-43} y={-7} fontSize="9" stroke="none" fill="currentColor">{bipolar ? "B" : "G"}</text>
      <text x={42} y={30} fontSize="9" stroke="none" fill="currentColor">{bipolar ? "E" : "S"}</text>
    </g>;
  }
  const leads = <path d="M -48 0 H -24 M 24 0 H 48" />;
  if (device.kind === "R") return <g>{leads}<path d="M -24 0 L -20 -8 L -12 8 L -4 -8 L 4 8 L 12 -8 L 20 8 L 24 0" /></g>;
  if (device.kind === "C") return <path d="M -48 0 H -5 M -5 -17 V 17 M 5 -17 V 17 M 5 0 H 48" />;
  if (device.kind === "L") return <g>{leads}<path d="M -24 0 A 8 10 0 0 1 -8 0 A 8 10 0 0 1 8 0 A 8 10 0 0 1 24 0" /></g>;
  if (device.kind === "D") return <g><path d="M -48 0 H -14 M 14 0 H 48 M -14 -17 L 14 0 L -14 17 Z M 14 -17 V 17" /></g>;
  const dependent = ["E", "G", "F", "H"].includes(device.kind);
  const current = ["I", "G", "F"].includes(device.kind) || (device.kind === "B" && /^i\s*=/i.test(device.value));
  return <g>{leads}
    {dependent ? <path d="M -24 0 L 0 -24 L 24 0 L 0 24 Z" fill="var(--nl-bg, #ffffff)" /> : <circle r={24} fill="var(--nl-bg, #ffffff)" />}
    {current ? <path d="M -12 0 H 12 M 5 -6 L 12 0 L 5 6" /> : <path d="M -15 0 H -5 M -10 -5 V 5 M 5 0 H 15" />}
    {device.pins.length === 4 && <g><path d="M -20 50 V 30 M 20 50 V 30" /><text x={0} y={43} textAnchor="middle" fontSize="9" stroke="none" fill="currentColor">+ −</text></g>}
  </g>;
}
