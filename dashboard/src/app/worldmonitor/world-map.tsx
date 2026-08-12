"use client";

// The map, in both of upstream worldmonitor's projections: a flat 2D panel and
// a 3D globe. Upstream reaches for deck.gl and globe.gl for those; both are
// drawn here as plain SVG, so the dashboard gains no WebGL dependency and the
// coastlines take the theme's ink like everything else on the page.
//
// Geometry is world-atlas 110m TopoJSON, the same file the upstream clone
// serves, decoded here (quantized delta arcs → rings) because pulling in
// topojson-client for one function would be silly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HazardEvent, HubActivity, ThreatLevel } from "@/lib/worldmonitor/types.ts";

interface Topology {
  type: "Topology";
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, TopoObject>;
}

interface TopoObject {
  type: string;
  geometries?: TopoGeometry[];
}

interface TopoGeometry {
  type: "Polygon" | "MultiPolygon" | string;
  arcs?: unknown;
}

type Ring = [number, number][];

/** Absolute lon/lat ring from the quantized delta encoding. */
function decodeArc(arc: number[][], transform: Topology["transform"]): Ring {
  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;
  let x = 0;
  let y = 0;
  return arc.map(([dx = 0, dy = 0]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty] as [number, number];
  });
}

/** A negative index means "that arc, reversed" — TopoJSON's ~i convention. */
function ringOf(indices: number[], arcs: Ring[]): Ring {
  const points: Ring = [];
  for (const index of indices) {
    const arc = index < 0 ? [...arcs[~index]!].reverse() : arcs[index]!;
    // Consecutive arcs share an endpoint; dropping it avoids doubled vertices.
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  return points;
}

/** Countries as lon/lat rings, decoded once and projected per frame. */
function landRings(topology: Topology): Ring[][] {
  const arcs = topology.arcs.map((arc) => decodeArc(arc, topology.transform));
  const object = topology.objects.countries ?? topology.objects.land;
  const geometries = object?.geometries ?? [];

  const out: Ring[][] = [];
  for (const geometry of geometries) {
    const polygons: number[][][] =
      geometry.type === "Polygon"
        ? [geometry.arcs as number[][]]
        : geometry.type === "MultiPolygon"
          ? (geometry.arcs as number[][][])
          : [];

    const rings: Ring[] = [];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const points = ringOf(ring, arcs);
        if (points.length >= 3) rings.push(points);
      }
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

// ── 2D: equirectangular ─────────────────────────────────────────────────────

/**
 * An asymmetric latitude window: north far enough for the Arctic hub, south
 * only to the tip of South America. Antarctica is the one continent with no
 * feed and no hub, and giving it a fifth of the frame would squash everywhere
 * the news happens.
 *
 * Height follows from the window so degrees stay square and coastlines are not
 * stretched: HEIGHT = WIDTH × span / 360.
 */
const LAT_NORTH = 78;
const LAT_SOUTH = -58;
const WIDTH = 1000;
const HEIGHT = Math.round((WIDTH * (LAT_NORTH - LAT_SOUTH)) / 360);

function project(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * WIDTH;
  const clamped = Math.max(LAT_SOUTH, Math.min(LAT_NORTH, lat));
  const y = ((LAT_NORTH - clamped) / (LAT_NORTH - LAT_SOUTH)) * HEIGHT;
  return [x, y];
}

function flatPath(rings: Ring[]): string {
  let d = "";
  for (const ring of rings) {
    d += ring
      .map(([lon, lat], index) => {
        const [x, y] = project(lon, lat);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    d += "Z";
  }
  return d;
}

// ── 3D: orthographic globe ──────────────────────────────────────────────────

const GLOBE_R = 210;
const GLOBE_BOX = 470;

interface Rotation {
  lambda: number;
  phi: number;
}

/**
 * A point on a sphere seen from outside.
 *
 * Back-facing points are not dropped but pushed radially onto the limb: a
 * country straddling the horizon then gets cut along the edge of the globe
 * rather than taking a straight-line shortcut across it, which is what naively
 * skipping the hidden points does — and it looks like the map has been torn.
 */
function orthographic(
  lon: number,
  lat: number,
  rotation: Rotation,
): { x: number; y: number; visible: boolean } {
  const toRad = Math.PI / 180;
  const l = (lon + rotation.lambda) * toRad;
  const p = lat * toRad;
  const p0 = rotation.phi * toRad;

  const cosP = Math.cos(p);
  const px = cosP * Math.sin(l);
  const py = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cosP * Math.cos(l);
  const z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cosP * Math.cos(l);

  const visible = z >= 0;
  const length = Math.hypot(px, py) || 1;
  const scale = visible ? 1 : 1 / length;

  return { x: GLOBE_R * px * scale, y: -GLOBE_R * py * scale, visible };
}

function globePath(rings: Ring[], rotation: Rotation): string {
  let d = "";
  for (const ring of rings) {
    let started = false;
    let anyVisible = false;
    let segment = "";
    for (const [lon, lat] of ring) {
      const point = orthographic(lon, lat, rotation);
      if (point.visible) anyVisible = true;
      segment += `${started ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      started = true;
    }
    // A country entirely on the far side collapses onto the limb; drawing it
    // would smear a shape along the horizon that is not there.
    if (anyVisible) d += `${segment}Z`;
  }
  return d;
}

/** Meridians and parallels, drawn as short chords so they curve with the ball. */
function globeGraticule(rotation: Rotation): string {
  let d = "";
  for (let lon = -180; lon < 180; lon += 30) {
    let started = false;
    for (let lat = -80; lat <= 80; lat += 5) {
      const point = orthographic(lon, lat, rotation);
      if (!point.visible) {
        started = false;
        continue;
      }
      d += `${started ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      started = true;
    }
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    let started = false;
    for (let lon = -180; lon <= 180; lon += 5) {
      const point = orthographic(lon, lat, rotation);
      if (!point.visible) {
        started = false;
        continue;
      }
      d += `${started ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      started = true;
    }
  }
  return d;
}

// ── Markers ─────────────────────────────────────────────────────────────────

/**
 * Marker shape. Upstream draws almost everything as a solid filled dot with a
 * soft halo and keeps shapes for the few site types its legend calls out
 * (▲ base, ■ datacenter), so capitals and conflict hubs are circles here and
 * only the two site kinds take a shape. Solid fill, no ring: a hollow marker
 * reads as "empty" at four pixels, which is the size most of them are.
 */
function markPath(type: HubActivity["type"], x: number, y: number, r: number): string {
  switch (type) {
    case "strategic": {
      const h = r * 1.2;
      return `M${x} ${y - h} L${x + h * 0.95} ${y + h * 0.75} L${x - h * 0.95} ${y + h * 0.75} Z`;
    }
    case "organization": {
      const s = r * 0.88;
      return `M${x - s} ${y - s} H${x + s} V${y + s} H${x - s} Z`;
    }
    default:
      return "";
  }
}

/**
 * Radius grows with the square root of accumulated weight, so one loud hub
 * cannot swallow the map. Kept small on purpose: the Gulf and western Europe
 * carry a dozen hubs within a few degrees, and markers big enough to admire
 * individually merge into one blob there.
 */
function radiusFor(weight: number, max: number): number {
  if (max <= 0) return 2.4;
  return 2.1 + 5.4 * Math.sqrt(Math.min(1, weight / max));
}

/**
 * Hazard marks are diamonds, at a fixed size. A hub's dot is sized by how much
 * is being *reported* there; a hazard has already been assessed by somebody
 * else, so scaling it by the same rule would invent a comparison. Shape and
 * level colour carry it instead.
 */
function hazardPath(x: number, y: number, r: number): string {
  return `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
}

export interface MapLayer {
  id: string;
  label: string;
  enabled: boolean;
}

export type MapMode = "2d" | "3d";

interface Props {
  hubs: HubActivity[];
  selectedHub: string | null;
  onSelectHub: (hubId: string | null) => void;
  layers: MapLayer[];
  onToggleLayer: (layerId: string) => void;
  ranges: Array<{ id: string; label: string }>;
  range: string;
  onRange: (rangeId: string) => void;
  mode: MapMode;
  /** Live natural-hazard alerts, already filtered by the hazard layers. */
  hazards?: HazardEvent[];
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export default function WorldMap({
  hubs,
  selectedHub,
  onSelectHub,
  layers,
  onToggleLayer,
  ranges,
  range,
  onRange,
  mode,
  hazards = [],
}: Props) {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<HubActivity | null>(null);
  const [hoveredHazard, setHoveredHazard] = useState<HazardEvent | null>(null);
  const [layersOpen, setLayersOpen] = useState(true);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [rotation, setRotation] = useState<Rotation>({ lambda: -20, phi: 18 });
  const [globeZoom, setGlobeZoom] = useState(1);
  const dragRef = useRef<
    { kind: "pan"; x: number; y: number; vx: number; vy: number }
    | { kind: "spin"; x: number; y: number; lambda: number; phi: number }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/worldmonitor/countries-110m.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("map"))))
      .then((data: Topology) => {
        if (!cancelled) setTopology(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rings = useMemo(() => (topology ? landRings(topology) : []), [topology]);
  const flatPaths = useMemo(
    () => (mode === "2d" ? rings.map(flatPath) : []),
    [rings, mode],
  );
  const globePaths = useMemo(
    () => (mode === "3d" ? rings.map((country) => globePath(country, rotation)) : []),
    [rings, mode, rotation],
  );
  const graticule3d = useMemo(
    () => (mode === "3d" ? globeGraticule(rotation) : ""),
    [mode, rotation],
  );

  const maxWeight = useMemo(
    () => hubs.reduce((max, hub) => Math.max(max, hub.weight), 0),
    [hubs],
  );

  // Draw the loudest hubs last so their marks sit on top of the quiet ones.
  const ordered = useMemo(() => [...hubs].sort((a, b) => a.weight - b.weight), [hubs]);
  const active = hovered ?? hubs.find((hub) => hub.id === selectedHub) ?? null;

  const clamp = useCallback((next: { x: number; y: number; k: number }) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.k));
    const w = WIDTH / k;
    const h = HEIGHT / k;
    return {
      k,
      x: Math.min(Math.max(0, next.x), WIDTH - w),
      y: Math.min(Math.max(0, next.y), HEIGHT - h),
    };
  }, []);

  /** Zoom about the frame's centre, which is what the +/− buttons imply. */
  const zoomBy = useCallback(
    (factor: number) => {
      if (mode === "3d") {
        setGlobeZoom((current) => Math.min(2.6, Math.max(1, current * factor)));
        return;
      }
      setView((current) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        const cx = current.x + WIDTH / current.k / 2;
        const cy = current.y + HEIGHT / current.k / 2;
        return clamp({ k, x: cx - WIDTH / k / 2, y: cy - HEIGHT / k / 2 });
      });
    },
    [clamp, mode],
  );

  function startDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (mode === "3d") {
      dragRef.current = {
        kind: "spin",
        x: event.clientX,
        y: event.clientY,
        lambda: rotation.lambda,
        phi: rotation.phi,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (view.k <= 1) return;
    dragRef.current = {
      kind: "pan",
      x: event.clientX,
      y: event.clientY,
      vx: view.x,
      vy: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    if (drag.kind === "spin") {
      // A drag across the full width turns the globe roughly half a revolution;
      // latitude stops short of the poles, where the projection degenerates.
      const dx = ((event.clientX - drag.x) / rect.width) * 220;
      const dy = ((event.clientY - drag.y) / rect.height) * 160;
      setRotation({
        lambda: drag.lambda + dx,
        phi: Math.max(-75, Math.min(75, drag.phi + dy)),
      });
      return;
    }

    const scale = WIDTH / view.k / rect.width;
    setView((current) =>
      clamp({
        k: current.k,
        x: drag.vx - (event.clientX - drag.x) * scale,
        y: drag.vy - (event.clientY - drag.y) * scale,
      }),
    );
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /**
   * Wheel zoom, anchored on the pointer so the place under the cursor stays
   * under it. Registered natively rather than through React's onWheel because
   * React attaches wheel listeners passively, and a passive listener cannot
   * call preventDefault — the page behind would scroll along with the zoom.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);

      if (mode === "3d") {
        setGlobeZoom((current) => Math.min(2.6, Math.max(1, current * factor)));
        return;
      }

      const rect = svg.getBoundingClientRect();
      setView((current) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        // Where the cursor is in map units, before and after the scale change.
        const px = current.x + ((event.clientX - rect.left) / rect.width) * (WIDTH / current.k);
        const py = current.y + ((event.clientY - rect.top) / rect.height) * (HEIGHT / current.k);
        return clamp({
          k,
          x: px - ((event.clientX - rect.left) / rect.width) * (WIDTH / k),
          y: py - ((event.clientY - rect.top) / rect.height) * (HEIGHT / k),
        });
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [clamp, mode]);

  const is3d = mode === "3d";
  const box = GLOBE_BOX / globeZoom;
  const viewBox = is3d
    ? `${-box / 2} ${-box / 2} ${box} ${box}`
    : `${view.x} ${view.y} ${WIDTH / view.k} ${HEIGHT / view.k}`;

  return (
    <div
      className={`bb-wm-map neu-inset relative flex-1 overflow-hidden rounded-xl ${is3d ? "is-globe" : ""}`}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio={is3d ? "xMidYMid meet" : "xMidYMid slice"}
        className={`block h-full w-full ${is3d || view.k > 1 ? "cursor-grab" : ""}`}
        role="img"
        aria-label={`${is3d ? "Globe" : "World map"} of current headline activity`}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <radialGradient id="bb-wm-pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          {/* The lit side of the ball. Without it a flat disc reads as a circle
              with a map on it rather than as a sphere. */}
          <radialGradient id="bb-wm-globe-shade" cx="35%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="60%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
          </radialGradient>
          <clipPath id="bb-wm-globe-clip">
            <circle cx="0" cy="0" r={GLOBE_R} />
          </clipPath>
        </defs>

        {is3d ? (
          <g clipPath="url(#bb-wm-globe-clip)">
            <circle className="bb-wm-globe-sphere" cx="0" cy="0" r={GLOBE_R} />
            <path className="bb-wm-graticule-path" d={graticule3d} />
            <g className="bb-wm-land">
              {globePaths.map((d, index) => (d ? <path key={index} d={d} /> : null))}
            </g>
            <circle cx="0" cy="0" r={GLOBE_R} fill="url(#bb-wm-globe-shade)" />
          </g>
        ) : (
          <>
            {/* Graticule: every 30° of longitude, 20° of latitude. */}
            <g className="bb-wm-graticule">
              {Array.from({ length: 11 }, (_, i) => -150 + i * 30).map((lon) => (
                <line
                  key={`lon-${lon}`}
                  x1={project(lon, 0)[0]}
                  y1={0}
                  x2={project(lon, 0)[0]}
                  y2={HEIGHT}
                />
              ))}
              {Array.from({ length: 7 }, (_, i) => -40 + i * 20).map((lat) => (
                <line
                  key={`lat-${lat}`}
                  x1={0}
                  y1={project(0, lat)[1]}
                  x2={WIDTH}
                  y2={project(0, lat)[1]}
                />
              ))}
            </g>

            <g className="bb-wm-land">
              {flatPaths.map((d, index) => (
                <path key={index} d={d} />
              ))}
            </g>
          </>
        )}

        {/* Hazards sit under the hubs: they are the state of the ground, and a
            reported story about a place should still be the thing you click. */}
        <g className="bb-wm-hazards">
          {hazards.map((hazard) => {
            let x: number;
            let y: number;
            let r: number;

            if (is3d) {
              const point = orthographic(hazard.lon, hazard.lat, rotation);
              if (!point.visible) return null;
              x = point.x;
              y = point.y;
              r = 3.1 / globeZoom;
            } else {
              [x, y] = project(hazard.lon, hazard.lat);
              r = 4.4 / Math.sqrt(view.k);
            }

            return (
              <g
                key={hazard.id}
                className={`bb-wm-hazard bb-wm-level-${hazard.level}`}
                onMouseEnter={() => setHoveredHazard(hazard)}
                onMouseLeave={() => setHoveredHazard(null)}
                aria-label={`${hazard.kind} alert: ${hazard.title}`}
              >
                <path className="bb-wm-hazard-mark" d={hazardPath(x, y, r)} />
              </g>
            );
          })}
        </g>

        <g>
          {ordered.map((hub) => {
            let x: number;
            let y: number;
            let r: number;

            if (is3d) {
              const point = orthographic(hub.lon, hub.lat, rotation);
              if (!point.visible) return null;
              x = point.x;
              y = point.y;
              r = (radiusFor(hub.weight, maxWeight) * 0.62) / globeZoom;
            } else {
              [x, y] = project(hub.lon, hub.lat);
              r = radiusFor(hub.weight, maxWeight) / Math.sqrt(view.k);
            }

            const isSelected = hub.id === selectedHub;
            const shape = markPath(hub.type, x, y, r);
            return (
              <g
                key={hub.id}
                className={`bb-wm-hub bb-wm-level-${hub.level}${isSelected ? " is-selected" : ""}`}
                onMouseEnter={() => setHovered(hub)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectHub(isSelected ? null : hub.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectHub(isSelected ? null : hub.id);
                  }
                }}
                aria-label={`${hub.name}: ${hub.count} headlines, highest level ${hub.level}`}
              >
                {/* Every marker carries a halo, not just the loud ones — that
                    soft bloom around a solid dot is what upstream's map looks
                    like. It scales with the dot, so severity still reads. */}
                <circle cx={x} cy={y} r={r * 2.5} fill="url(#bb-wm-pulse)" />
                {shape ? (
                  <path className="bb-wm-hub-dot" d={shape} />
                ) : (
                  <circle className="bb-wm-hub-dot" cx={x} cy={y} r={r} />
                )}
                {isSelected && (
                  <circle className="bb-wm-hub-ring" cx={x} cy={y} r={r + 3.5} />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Overlays ── */}

      <div className="bb-wm-map-panel absolute top-2.5 left-2.5 w-[11.5rem]">
        <div className="bb-wm-range flex items-center gap-0.5 rounded-lg border p-0.5">
          {ranges.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onRange(option.id)}
              aria-pressed={range === option.id}
              className={`flex-1 rounded-md px-1 py-0.5 text-[0.62rem] tracking-wide uppercase ${
                range === option.id ? "is-selected" : ""
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="bb-wm-layers mt-1.5 rounded-lg border">
          <button
            type="button"
            onClick={() => setLayersOpen((open) => !open)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-[0.62rem] tracking-[0.08em] uppercase"
            aria-expanded={layersOpen}
          >
            Layers
            <span aria-hidden="true">{layersOpen ? "▾" : "▸"}</span>
          </button>
          {/* The list is tall enough for every layer on a normal window, and
              capped against the map's own height on a short one. */}
          {layersOpen && (
            <ul className="max-h-[min(21rem,44vh)] overflow-y-auto px-1 pb-1.5">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-[0.18rem] text-[0.65rem]">
                    <input
                      type="checkbox"
                      checked={layer.enabled}
                      onChange={() => onToggleLayer(layer.id)}
                      className="bb-wm-check"
                    />
                    <span className="truncate">{layer.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="absolute top-2.5 right-2.5 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomBy(1.6)}
          className="bb-wm-map-button"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.6)}
          className="bb-wm-map-button"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setView({ x: 0, y: 0, k: 1 });
            setGlobeZoom(1);
            setRotation({ lambda: -20, phi: 18 });
          }}
          className="bb-wm-map-button"
          aria-label="Reset view"
          title="Reset view"
        >
          ⌂
        </button>
      </div>

      <div className="bb-wm-legend absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1">
        {(["critical", "high", "medium", "low", "info"] as ThreatLevel[]).map((level) => (
          <span key={level} className="flex items-center gap-1 text-[0.6rem] tracking-wide uppercase">
            <span className={`bb-wm-dot bb-wm-level-${level}`} aria-hidden="true" />
            {levelName(level)}
          </span>
        ))}
        <span className="bb-wm-legend-divider" aria-hidden="true" />
        <span className="flex items-center gap-1 text-[0.6rem] tracking-wide uppercase">
          <svg viewBox="-6 -6 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <circle r="4.5" className="bb-wm-legend-mark" />
          </svg>
          City
        </span>
        <span className="flex items-center gap-1 text-[0.6rem] tracking-wide uppercase">
          <svg viewBox="-6 -6 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M0 -5 L5 4 L-5 4 Z" className="bb-wm-legend-mark" />
          </svg>
          Strategic
        </span>
        <span className="flex items-center gap-1 text-[0.6rem] tracking-wide uppercase">
          <svg viewBox="-6 -6 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M-4 -4 H4 V4 H-4 Z" className="bb-wm-legend-mark" />
          </svg>
          Org
        </span>
        {hazards.length > 0 && (
          <span
            className="flex items-center gap-1 text-[0.6rem] tracking-wide uppercase"
            title="Natural-hazard alerts (GDACS)"
          >
            <svg viewBox="-6 -6 12 12" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M0 -5 L5 0 L0 5 L-5 0 Z" className="bb-wm-legend-mark" />
            </svg>
            Hazard
          </span>
        )}
      </div>

      {failed && (
        <p className="absolute inset-0 flex items-center justify-center text-xs bb-wm-ink-muted">
          Map geometry unavailable — the hotspot grid still reflects the window.
        </p>
      )}

      {/* One callout slot. A hazard under the cursor wins it, because that is
          the thing being pointed at right now; the hub selection is still
          there when the pointer leaves. */}
      {hoveredHazard ? (
        <div className="bb-wm-map-callout absolute right-2.5 bottom-2.5 max-w-[22rem] rounded-lg border px-2.5 py-1.5">
          <p className="bb-wm-heading flex items-center gap-1.5 text-[0.66rem] font-medium tracking-wide uppercase">
            <span className={`bb-wm-dot bb-wm-level-${hoveredHazard.level}`} aria-hidden="true" />
            {hoveredHazard.kind}
            <span className="bb-wm-ink-muted normal-case">
              {hoveredHazard.country || "—"} · {hoveredHazard.alert} alert
            </span>
          </p>
          <p className="bb-wm-ink mt-0.5 line-clamp-2 text-[0.7rem]">{hoveredHazard.title}</p>
        </div>
      ) : (
        active && (
          <div className="bb-wm-map-callout absolute right-2.5 bottom-2.5 max-w-[22rem] rounded-lg border px-2.5 py-1.5">
            <p className="bb-wm-heading flex items-center gap-1.5 text-[0.66rem] font-medium tracking-wide uppercase">
              <span className={`bb-wm-dot bb-wm-level-${active.level}`} aria-hidden="true" />
              {active.name}
              <span className="bb-wm-ink-muted normal-case">
                {active.country} · {active.count} {active.count === 1 ? "story" : "stories"}
              </span>
            </p>
            <p className="bb-wm-ink mt-0.5 line-clamp-2 text-[0.7rem]">{active.topHeadline}</p>
          </div>
        )
      )}
    </div>
  );
}

export function levelName(level: ThreatLevel): string {
  return level === "info" ? "Background" : level[0]!.toUpperCase() + level.slice(1);
}
