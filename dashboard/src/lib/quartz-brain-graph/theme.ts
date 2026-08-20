import type { BrainNodeKind, OptionalBrainNodeKind } from "../profile/brain-graph-types.ts";

export interface QuartzBrainNodeStyle {
  color: number;
  radius: number;
  halo: number;
}

interface QuartzBrainNodePalette {
  light: number;
  dark: number;
  radius: number;
  halo: number;
}

// The previous pastel-only palette disappeared into Breadboard's pale green
// canvas. Each semantic color now has a darker light-theme value and a lighter
// dark-theme counterpart, so color remains useful without carrying contrast by
// itself.
const STYLES: Record<BrainNodeKind | OptionalBrainNodeKind, QuartzBrainNodePalette> = {
  user: { light: 0x2563eb, dark: 0x60a5fa, radius: 8.2, halo: 8 },
  organization: { light: 0x15803d, dark: 0x4ade80, radius: 7.2, halo: 7 },
  garden: { light: 0x0e7490, dark: 0x22d3ee, radius: 6.3, halo: 6 },
  source: { light: 0x4f46e5, dark: 0x818cf8, radius: 4.8, halo: 4 },
  page: { light: 0x475569, dark: 0xcbd5e1, radius: 3.8, halo: 3 },
  concept: { light: 0xa16207, dark: 0xfacc15, radius: 3.2, halo: 3 },
  memory: { light: 0xbe185d, dark: 0xf472b6, radius: 4.4, halo: 4 },
  conversation: { light: 0x6d28d9, dark: 0xa78bfa, radius: 4.6, halo: 4 },
  artifact: { light: 0xc2410c, dark: 0xfb923c, radius: 4.8, halo: 4 },
  person: { light: 0x0f766e, dark: 0x5eead4, radius: 3.8, halo: 3 },
  member: { light: 0x0f766e, dark: 0x5eead4, radius: 3.8, halo: 3 },
  project: { light: 0xa16207, dark: 0xfacc15, radius: 4.5, halo: 4 },
  agent: { light: 0x7e22ce, dark: 0xc084fc, radius: 4.5, halo: 5 },
  buzz_channel: { light: 0x0369a1, dark: 0x38bdf8, radius: 5.2, halo: 5 },
  buzz_thread: { light: 0x6d28d9, dark: 0xa78bfa, radius: 3.8, halo: 3 },
  buzz_canvas: { light: 0x0369a1, dark: 0x38bdf8, radius: 4.2, halo: 4 },
  workflow: { light: 0x7e22ce, dark: 0xc084fc, radius: 4.4, halo: 4 },
  repository: { light: 0x334155, dark: 0x94a3b8, radius: 4.2, halo: 4 },
  task: { light: 0xa16207, dark: 0xfacc15, radius: 3.8, halo: 3 },
  schedule: { light: 0xb91c1c, dark: 0xf87171, radius: 4.1, halo: 4 },
  calendar_event: { light: 0xb91c1c, dark: 0xf87171, radius: 3.8, halo: 3 },
  agent_run: { light: 0x6b21a8, dark: 0xc084fc, radius: 3.5, halo: 3 },
};

export function quartzBrainNodeStyle(
  kind: BrainNodeKind | OptionalBrainNodeKind,
  weight = 0,
  darkMode = false,
): QuartzBrainNodeStyle {
  const base = STYLES[kind];
  return {
    color: darkMode ? base.dark : base.light,
    halo: base.halo,
    radius: base.radius + Math.sqrt(Math.max(0, weight)) * 1.8,
  };
}
