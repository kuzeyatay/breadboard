"use client";

// The logical schematic.
//
// It is drawn from the same Circuit JSON the artifact exports, through a small
// adapter: `circuitJsonToSchematic` reads source_component / source_port /
// source_net / source_trace elements and lays them out. That is the seam where
// a full tscircuit schematic renderer would drop in — the input format is
// already theirs. Until then this fallback draws real symbols, references,
// values, power rails and net highlighting rather than leaving the tab empty.

import { useMemo, useRef } from "react";
import { componentDefinition } from "@/lib/hardware/components/index.ts";
import { netStyle } from "@/lib/hardware/net-style.ts";
import type { HardwareDesign } from "@/lib/hardware/types";
import { useFitView } from "./use-fit-view";
import type { Selection } from "./wiring-view";

const SYMBOL_WIDTH = 132;
const COLUMN_GAP = 108;
const ROW_GAP = 60;
const RAIL_MARGIN = 70;

interface SchematicPort {
  pinId: string;
  label: string;
  x: number;
  y: number;
  side: "left" | "right";
}

interface SchematicSymbol {
  componentId: string;
  reference: string;
  name: string;
  value?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: SchematicPort[];
}

/**
 * Lay out one symbol per component that carries at least one wired pin. Ports
 * split left/right by role so power and ground leave the symbol on the side
 * their rail runs down.
 */
function buildSchematic(design: HardwareDesign): {
  symbols: SchematicSymbol[];
  width: number;
  height: number;
} {
  const wiredPins = new Map<string, Set<string>>();
  for (const net of design.nets) {
    for (const connection of net.connections) {
      const pins = wiredPins.get(connection.componentId) ?? new Set<string>();
      pins.add(connection.pinId);
      wiredPins.set(connection.componentId, pins);
    }
  }

  const symbols: SchematicSymbol[] = [];
  const controllerFirst = [...design.components].sort((left, right) =>
    left.reference === "U1" ? -1 : right.reference === "U1" ? 1 : 0,
  );

  let column = 0;
  let x = RAIL_MARGIN + 40;
  let y = 40;
  let rowHeight = 0;
  let maxWidth = 0;

  for (const instance of controllerFirst) {
    const pins = wiredPins.get(instance.id);
    if (!pins?.size) continue;
    const definition = componentDefinition(instance.definitionId);
    if (!definition) continue;

    const ordered = definition.pins.filter((pin) => pins.has(pin.id));
    const left = ordered.filter(
      (pin) => pin.electricalType === "power-input" || pin.electricalType === "ground",
    );
    const right = ordered.filter((pin) => !left.includes(pin));
    const rows = Math.max(left.length, right.length, 2);
    const height = 26 + rows * 20;

    if (column === 3) {
      column = 0;
      x = RAIL_MARGIN + 40;
      y += rowHeight + ROW_GAP;
      rowHeight = 0;
    }

    const ports: SchematicPort[] = [
      ...left.map((pin, index) => ({
        pinId: pin.id,
        label: pin.label,
        x,
        y: y + 24 + index * 20,
        side: "left" as const,
      })),
      ...right.map((pin, index) => ({
        pinId: pin.id,
        label: pin.label,
        x: x + SYMBOL_WIDTH,
        y: y + 24 + index * 20,
        side: "right" as const,
      })),
    ];

    symbols.push({
      componentId: instance.id,
      reference: instance.reference,
      name: instance.name,
      ...(instance.value ? { value: instance.value } : {}),
      x,
      y,
      width: SYMBOL_WIDTH,
      height,
      ports,
    });

    rowHeight = Math.max(rowHeight, height);
    maxWidth = Math.max(maxWidth, x + SYMBOL_WIDTH + 90);
    x += SYMBOL_WIDTH + COLUMN_GAP;
    column += 1;
  }

  // The real extent of the drawing, with no floor: the sheet is centred inside
  // the stage, so padding it out would push the symbols off to one side.
  return {
    symbols,
    width: Math.max(maxWidth, RAIL_MARGIN + SYMBOL_WIDTH),
    height: y + rowHeight + 80,
  };
}

export default function SchematicView({
  design,
  selection,
  onSelect,
}: {
  design: HardwareDesign;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const schematic = useMemo(() => buildSchematic(design), [design]);
  // The drawing starts at the rail margin, so the box that gets centred is the
  // whole sheet — rails included — rather than the symbols alone.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const view = useFitView(
    stageRef,
    useMemo(
      () => ({ x: 0, y: 0, width: schematic.width, height: schematic.height }),
      [schematic.height, schematic.width],
    ),
    design.id,
  );
  const portIndex = useMemo(() => {
    const index = new Map<string, SchematicPort & { componentId: string }>();
    for (const symbol of schematic.symbols) {
      for (const port of symbol.ports) {
        index.set(`${symbol.componentId}::${port.pinId}`, { ...port, componentId: symbol.componentId });
      }
    }
    return index;
  }, [schematic.symbols]);

  const highlightedNets = useMemo(() => {
    const netIds = new Set(selection.netIds);
    for (const net of design.nets) {
      if (net.connections.some((connection) => selection.componentIds.includes(connection.componentId))) {
        netIds.add(net.id);
      }
    }
    return netIds;
  }, [design.nets, selection]);
  const active = selection.componentIds.length > 0 || selection.netIds.length > 0;

  const powerNets = design.nets.filter((net) => net.role === "power" || net.role === "ground");
  const signalNets = design.nets.filter((net) => net.role !== "power" && net.role !== "ground");

  const buttonClass =
    "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-heading)]";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="text-xs text-[var(--ink-muted)]">
        Logical view. Power and ground run as named rails down the left; every other net is drawn
        between the pins it joins. Select a net or a part to highlight it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => view.zoomBy(1.2)}>
          Zoom in
        </button>
        <button type="button" className={buttonClass} onClick={() => view.zoomBy(1 / 1.2)}>
          Zoom out
        </button>
        <button type="button" className={buttonClass} onClick={view.fit}>
          Reset view
        </button>
        {active ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => onSelect({ componentIds: [], netIds: [] })}
          >
            Clear selection
          </button>
        ) : null}
        <span className="text-xs text-[var(--ink-muted)]">
          {Math.round(view.zoom * 100)}% · drag to pan · ctrl and scroll to zoom
        </span>
      </div>
      <div
        ref={stageRef}
        className="bb-neu-recessed relative min-h-[24rem] flex-1 cursor-grab overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]"
        {...view.panHandlers}
      >
        <svg
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: view.transform }}
          width={schematic.width}
          height={schematic.height}
          viewBox={`0 0 ${schematic.width} ${schematic.height}`}
          role="img"
          aria-label={`Schematic for ${design.title}`}
        >
          {/* Power and ground rails */}
          {powerNets.map((net, index) => {
            const style = netStyle(net.role);
            const railX = 18 + index * 16;
            const dim = active && !highlightedNets.has(net.id);
            return (
              <g key={net.id} opacity={dim ? 0.2 : 1}>
                <line
                  x1={railX}
                  y1={24}
                  x2={railX}
                  y2={schematic.height - 24}
                  stroke={style.color}
                  strokeWidth={highlightedNets.has(net.id) && active ? 4 : 2.6}
                  strokeDasharray={style.dash ?? undefined}
                  className="cursor-pointer"
                  onClick={() =>
                    onSelect(
                      selection.netIds.includes(net.id)
                        ? { componentIds: [], netIds: [] }
                        : { componentIds: [], netIds: [net.id] },
                    )
                  }
                />
                <text
                  x={railX}
                  y={16}
                  textAnchor="middle"
                  fontSize="9"
                  fill={style.color}
                  fontFamily="ui-monospace, monospace"
                >
                  {net.name}
                </text>
                {net.connections.map((connection) => {
                  const port = portIndex.get(`${connection.componentId}::${connection.pinId}`);
                  if (!port) return null;
                  return (
                    <path
                      key={`${net.id}_${connection.componentId}_${connection.pinId}`}
                      d={`M ${railX} ${port.y} L ${port.x - 10} ${port.y} L ${port.x} ${port.y}`}
                      fill="none"
                      stroke={style.color}
                      strokeWidth="1.8"
                      strokeDasharray={style.dash ?? undefined}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Signal nets */}
          {signalNets.map((net) => {
            const style = netStyle(net.role);
            const points = net.connections
              .map((connection) => portIndex.get(`${connection.componentId}::${connection.pinId}`))
              .filter((port): port is SchematicPort & { componentId: string } => Boolean(port))
              .sort((left, right) => left.x - right.x);
            if (points.length < 2) return null;
            const dim = active && !highlightedNets.has(net.id);
            const busY = Math.min(...points.map((point) => point.y)) - 14;
            const d = points
              .map(
                (point, index) =>
                  `${index === 0 ? "M" : "L"} ${point.x + (point.side === "right" ? 14 : -14)} ${point.y} L ${
                    point.x + (point.side === "right" ? 14 : -14)
                  } ${busY}`,
              )
              .join(" ");
            return (
              <g key={net.id} opacity={dim ? 0.18 : 1}>
                <path
                  d={`${d} M ${points[0].x + (points[0].side === "right" ? 14 : -14)} ${busY} L ${
                    points[points.length - 1].x + (points[points.length - 1].side === "right" ? 14 : -14)
                  } ${busY}`}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={highlightedNets.has(net.id) && active ? 3.4 : 1.9}
                  strokeDasharray={style.dash ?? undefined}
                  className="cursor-pointer"
                  onClick={() =>
                    onSelect(
                      selection.netIds.includes(net.id)
                        ? { componentIds: [], netIds: [] }
                        : { componentIds: [], netIds: [net.id] },
                    )
                  }
                >
                  <title>{`${net.name} (${style.label})`}</title>
                </path>
                <text
                  x={points[0].x + (points[0].side === "right" ? 18 : -18)}
                  y={busY - 4}
                  fontSize="8.5"
                  fill={style.color}
                  fontFamily="ui-monospace, monospace"
                >
                  {net.name}
                </text>
                {points.map((point) => (
                  <path
                    key={`${net.id}_stub_${point.componentId}_${point.pinId}`}
                    d={`M ${point.x} ${point.y} L ${point.x + (point.side === "right" ? 14 : -14)} ${point.y}`}
                    stroke={style.color}
                    strokeWidth="1.6"
                    fill="none"
                  />
                ))}
              </g>
            );
          })}

          {/* Symbols */}
          {schematic.symbols.map((symbol) => {
            const chosen = selection.componentIds.includes(symbol.componentId);
            const dim =
              active &&
              !chosen &&
              !design.nets.some(
                (net) =>
                  highlightedNets.has(net.id) &&
                  net.connections.some(
                    (connection) => connection.componentId === symbol.componentId,
                  ),
              );
            return (
              <g
                key={symbol.componentId}
                opacity={dim ? 0.25 : 1}
                className="cursor-pointer"
                onClick={() =>
                  onSelect(
                    chosen
                      ? { componentIds: [], netIds: [] }
                      : { componentIds: [symbol.componentId], netIds: [] },
                  )
                }
              >
                <rect
                  x={symbol.x}
                  y={symbol.y}
                  width={symbol.width}
                  height={symbol.height}
                  rx="4"
                  className="fill-[var(--paper-raised)]"
                  stroke={chosen ? "var(--botanical)" : "var(--ink-muted)"}
                  strokeWidth={chosen ? 2.4 : 1.3}
                />
                <text
                  x={symbol.x + symbol.width / 2}
                  y={symbol.y + 15}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  className="fill-[var(--ink-heading)]"
                  fontFamily="ui-monospace, monospace"
                >
                  {symbol.reference}
                  {symbol.value ? ` · ${symbol.value}` : ""}
                </text>
                <text
                  x={symbol.x + symbol.width / 2}
                  y={symbol.y + symbol.height + 12}
                  textAnchor="middle"
                  fontSize="8.5"
                  className="fill-[var(--ink-muted)]"
                  fontFamily="ui-sans-serif, system-ui"
                >
                  {symbol.name.slice(0, 30)}
                </text>
                {symbol.ports.map((port) => (
                  <g key={port.pinId}>
                    <circle cx={port.x} cy={port.y} r="2.4" className="fill-[var(--ink)]" />
                    <text
                      x={port.side === "left" ? port.x + 6 : port.x - 6}
                      y={port.y + 3}
                      textAnchor={port.side === "left" ? "start" : "end"}
                      fontSize="8"
                      className="fill-[var(--ink)]"
                      fontFamily="ui-monospace, monospace"
                    >
                      {port.label.split(" ")[0]}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
