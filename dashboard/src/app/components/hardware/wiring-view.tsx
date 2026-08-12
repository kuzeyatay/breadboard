"use client";

// The physical wiring view: parts drawn where the deterministic layout put
// them, with every net's wires in an SVG overlay above them.
//
// Wire endpoints come from the source-controlled pin anchors, never from
// measuring the DOM, so the picture is the same whether or not the Wokwi
// element for a part managed to load.

import { useMemo, useRef } from "react";
import { componentDefinition } from "@/lib/hardware/components/index.ts";
import { netLegend, netStyle } from "@/lib/hardware/net-style.ts";
import type { ComponentInstance, ElectricalNet, HardwareDesign } from "@/lib/hardware/types";
import PartGraphic from "./part-graphic";
import { useFitView, type ContentBox } from "./use-fit-view";

export interface Selection {
  componentIds: string[];
  netIds: string[];
}

interface Endpoint {
  componentId: string;
  pinId: string;
  pinLabel: string;
  reference: string;
  x: number;
  y: number;
}

interface WireSegment {
  key: string;
  netId: string;
  path: string;
  from: Endpoint;
  to: Endpoint;
}

function canvasSize(design: HardwareDesign): { width: number; height: number } {
  let width = 640;
  let height = 420;
  for (const instance of design.components) {
    const definition = componentDefinition(instance.definitionId);
    if (!definition || !instance.position) continue;
    width = Math.max(width, instance.position.x + definition.visual.width + 48);
    height = Math.max(height, instance.position.y + definition.visual.height + 48);
  }
  return { width, height };
}

/**
 * The box the parts actually occupy, which is what gets centred. The canvas has
 * a floor size, so framing the canvas instead would leave a small circuit
 * sitting off to one side of its own empty space.
 */
export function contentBox(design: HardwareDesign): ContentBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const instance of design.components) {
    const definition = componentDefinition(instance.definitionId);
    if (!definition || !instance.position) continue;
    minX = Math.min(minX, instance.position.x);
    minY = Math.min(minY, instance.position.y);
    maxX = Math.max(maxX, instance.position.x + definition.visual.width);
    maxY = Math.max(maxY, instance.position.y + definition.visual.height);
  }
  if (!Number.isFinite(minX)) {
    const canvas = canvasSize(design);
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  // The reference caption hangs above each part, so the box reaches past it.
  const margin = 18;
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

function endpointsOf(
  net: ElectricalNet,
  byId: Map<string, ComponentInstance>,
): Endpoint[] {
  const points: Endpoint[] = [];
  for (const connection of net.connections) {
    const instance = byId.get(connection.componentId);
    if (!instance?.position) continue;
    const definition = componentDefinition(instance.definitionId);
    const anchor = definition?.visual.pinAnchors[connection.pinId];
    if (!definition || !anchor) continue;
    points.push({
      componentId: connection.componentId,
      pinId: connection.pinId,
      pinLabel: definition.pins.find((pin) => pin.id === connection.pinId)?.label ?? connection.pinId,
      reference: instance.reference,
      x: instance.position.x + anchor.x,
      y: instance.position.y + anchor.y,
    });
  }
  return points.sort((left, right) => left.x - right.x || left.y - right.y);
}

/**
 * Orthogonal routing through a per-net channel. Channels are spaced by net
 * index so two nets between the same two rows never sit on top of each other.
 */
function routeNet(net: ElectricalNet, points: Endpoint[], channelIndex: number): WireSegment[] {
  const segments: WireSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const channelY =
      (Math.max(from.y, to.y) + Math.min(from.y, to.y)) / 2 + (channelIndex % 8) * 7 - 24;
    const path =
      Math.abs(from.y - to.y) < 2
        ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
        : `M ${from.x} ${from.y} L ${from.x} ${channelY} L ${to.x} ${channelY} L ${to.x} ${to.y}`;
    segments.push({ key: `${net.id}_${index}`, netId: net.id, path, from, to });
  }
  return segments;
}

export interface WiringViewProps {
  design: HardwareDesign;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export default function WiringView({ design, selection, onSelect }: WiringViewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const box = useMemo(() => contentBox(design), [design]);
  const view = useFitView(stageRef, box, design.id);

  const byId = useMemo(
    () => new Map(design.components.map((instance) => [instance.id, instance])),
    [design.components],
  );
  const canvas = useMemo(() => canvasSize(design), [design]);
  const wires = useMemo(
    () =>
      design.nets.flatMap((net, index) => routeNet(net, endpointsOf(net, byId), index)),
    [byId, design.nets],
  );
  const legend = useMemo(() => netLegend(design.nets.map((net) => net.role)), [design.nets]);

  const highlighted = useMemo(() => {
    // Exactly one step out from what was selected. Expanding transitively would
    // walk the whole board through the shared ground and light up everything.
    const selectedComponents = new Set(selection.componentIds);
    const selectedNets = new Set(selection.netIds);
    const netIds = new Set(selectedNets);
    const componentIds = new Set(selectedComponents);
    for (const net of design.nets) {
      if (net.connections.some((connection) => selectedComponents.has(connection.componentId))) {
        netIds.add(net.id);
      }
      if (selectedNets.has(net.id)) {
        for (const connection of net.connections) componentIds.add(connection.componentId);
      }
    }
    return { netIds, componentIds };
  }, [design.nets, selection]);

  const active = selection.componentIds.length > 0 || selection.netIds.length > 0;

  const buttonClass =
    "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-heading)]";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
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
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: view.transform,
            width: canvas.width,
            height: canvas.height,
          }}
        >
          {design.components.map((instance) => {
            const definition = componentDefinition(instance.definitionId);
            if (!definition || !instance.position) return null;
            const dim = active && !highlighted.componentIds.has(instance.id);
            const chosen = selection.componentIds.includes(instance.id);
            return (
              <button
                key={instance.id}
                type="button"
                aria-pressed={chosen}
                title={`${instance.reference} — ${instance.name}${instance.value ? ` (${instance.value})` : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(
                    chosen
                      ? { componentIds: [], netIds: [] }
                      : { componentIds: [instance.id], netIds: [] },
                  );
                }}
                className={`absolute rounded-md p-0 text-left transition-opacity ${
                  dim ? "opacity-25" : "opacity-100"
                } ${chosen ? "ring-2 ring-[var(--botanical)] ring-offset-2 ring-offset-[var(--paper-strong)]" : ""}`}
                style={{
                  left: instance.position.x,
                  top: instance.position.y,
                  width: definition.visual.width,
                  height: definition.visual.height,
                }}
              >
                <PartGraphic
                  definition={definition}
                  label={
                    typeof instance.properties.railVoltage === "number"
                      ? `${instance.properties.railVoltage} V`
                      : undefined
                  }
                  value={instance.value}
                />
                <span
                  className="pointer-events-none absolute -top-4 left-0 rounded bg-[var(--paper-raised)] px-1 text-[10px] font-medium text-[var(--ink-heading)] shadow-sm"
                >
                  {instance.reference}
                  {instance.value ? ` ${instance.value}` : ""}
                </span>
              </button>
            );
          })}

          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={canvas.width}
            height={canvas.height}
            aria-label="Wiring between the parts"
          >
            {wires.map((wire) => {
              const net = design.nets.find((candidate) => candidate.id === wire.netId)!;
              const style = netStyle(net.role);
              const dim = active && !highlighted.netIds.has(net.id);
              return (
                <g key={wire.key} className="pointer-events-auto">
                  <path
                    d={wire.path}
                    fill="none"
                    stroke={style.color}
                    strokeWidth={highlighted.netIds.has(net.id) && active ? 3.6 : 2.2}
                    strokeDasharray={style.dash ?? undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={dim ? 0.15 : 1}
                  />
                  <path
                    d={wire.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="12"
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(
                        selection.netIds.includes(net.id)
                          ? { componentIds: [], netIds: [] }
                          : { componentIds: [], netIds: [net.id] },
                      );
                    }}
                  >
                    <title>
                      {`${net.name} (${style.label}) — ${wire.from.reference} ${wire.from.pinLabel} to ${wire.to.reference} ${wire.to.pinLabel}`}
                    </title>
                  </path>
                  {[wire.from, wire.to].map((point) => (
                    <circle
                      key={`${wire.key}_${point.componentId}_${point.pinId}`}
                      cx={point.x}
                      cy={point.y}
                      r={2.8}
                      fill={style.color}
                      opacity={dim ? 0.15 : 1}
                    >
                      <title>{`${point.reference} ${point.pinLabel} · ${net.name}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--ink-muted)]">
        {legend.map((style) => (
          <li key={style.label} className="flex items-center gap-1.5" title={style.description}>
            <svg width="26" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="25"
                y2="4"
                stroke={style.color}
                strokeWidth="2.4"
                strokeDasharray={style.dash ?? undefined}
              />
            </svg>
            {style.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
