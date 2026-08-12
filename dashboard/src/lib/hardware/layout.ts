// Deterministic placement for the physical wiring view.
//
// A layered layout, not a router: peripherals across the top, the controller in
// the middle, support parts and prototyping hardware below. It is stable — the
// same design always produces the same coordinates — which is what lets the
// artifact be reopened without recomputing anything.

import { componentDefinition } from "./components/index.ts";
import type { ComponentInstance, HardwareDesign } from "./types.ts";

const COLUMN_GAP = 56;
const ROW_GAP = 96;
const MARGIN = 48;

interface Row {
  instances: ComponentInstance[];
  y: number;
  height: number;
}

function sizeOf(instance: ComponentInstance): { width: number; height: number } {
  const definition = componentDefinition(instance.definitionId);
  return definition
    ? { width: definition.visual.width, height: definition.visual.height }
    : { width: 120, height: 60 };
}

function layerOf(instance: ComponentInstance): number {
  const category = componentDefinition(instance.definitionId)?.category ?? "";
  if (category === "controller") return 1;
  if (category === "prototyping") return instance.definitionId === "power-rails" ? 3 : 2;
  if (category === "passive" || category === "semiconductor") return 2;
  // Sources sit with the rails they feed, below everything they power.
  if (category === "power-source") return 3;
  return 0;
}

export interface LaidOutDesign {
  components: ComponentInstance[];
  canvas: { width: number; height: number };
}

/** Assign every component a position, leaving existing positions untouched. */
export function layoutDesign(design: HardwareDesign): LaidOutDesign {
  const layers = new Map<number, ComponentInstance[]>();
  for (const instance of design.components) {
    const layer = layerOf(instance);
    layers.set(layer, [...(layers.get(layer) ?? []), instance]);
  }

  const rows: Row[] = [];
  let cursorY = MARGIN;
  for (const layer of [...layers.keys()].sort((left, right) => left - right)) {
    const instances = layers.get(layer)!;
    const height = Math.max(...instances.map((instance) => sizeOf(instance).height));
    rows.push({ instances, y: cursorY, height });
    cursorY += height + ROW_GAP;
  }

  let canvasWidth = 0;
  const positioned: ComponentInstance[] = [];
  for (const row of rows) {
    const totalWidth =
      row.instances.reduce((sum, instance) => sum + sizeOf(instance).width, 0) +
      COLUMN_GAP * Math.max(0, row.instances.length - 1);
    canvasWidth = Math.max(canvasWidth, totalWidth + MARGIN * 2);
  }

  for (const row of rows) {
    const totalWidth =
      row.instances.reduce((sum, instance) => sum + sizeOf(instance).width, 0) +
      COLUMN_GAP * Math.max(0, row.instances.length - 1);
    let cursorX = Math.round((canvasWidth - totalWidth) / 2);
    for (const instance of row.instances) {
      const size = sizeOf(instance);
      positioned.push({
        ...instance,
        position: instance.position ?? {
          x: cursorX,
          // Centre each part vertically inside its row so short parts do not
          // hug the top of a row set by a tall board.
          y: Math.round(row.y + (row.height - size.height) / 2),
        },
      });
      cursorX += size.width + COLUMN_GAP;
    }
  }

  const byId = new Map(positioned.map((instance) => [instance.id, instance]));
  return {
    components: design.components.map((instance) => byId.get(instance.id) ?? instance),
    canvas: {
      width: Math.max(canvasWidth, 640),
      height: Math.max(cursorY - ROW_GAP + MARGIN, 420),
    },
  };
}
