"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { MAX_NETLIST_BYTES } from "@/lib/netlist-viewer/format";
import { readCircuitDocument } from "@/lib/netlist-viewer/project";
import { blockSymbol, circuitNets, initialLayout, netColor, pinOffsets, type Placement, type Point, type Terminal } from "@/lib/netlist-viewer/layout";
import NetlistSymbol from "./netlist-symbol";
import ArtifactPreviewLoading from "./artifact-preview-loading";
import styles from "./artifact-netlist-viewer.module.css";

type Props = { sourceUrl: string; filename: string };
type ViewBox = { x: number; y: number; width: number; height: number };

/** Stream with a ceiling even when a legacy binary download has no size header. */
async function readNetlist(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Netlist could not be opened (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_NETLIST_BYTES) throw new Error("The interactive viewer accepts netlists up to 2 MiB. The original is available through Download.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The netlist response was empty.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_NETLIST_BYTES) throw new Error("The interactive viewer accepts netlists up to 2 MiB. The original is available through Download.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export default function ArtifactNetlistViewer({ sourceUrl, filename }: Props) {
  const [loaded, setLoaded] = useState<{ url: string; source?: string; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [circuitId, setCircuitId] = useState("");
  const [mode, setMode] = useState<"circuit" | "source">("circuit");
  const [selected, setSelected] = useState("");
  const [net, setNet] = useState("");
  const [query, setQuery] = useState("");
  const [showWires, setShowWires] = useState(true);
  const [moved, setMoved] = useState<Record<string, Placement>>({});
  const [camera, setCamera] = useState<ViewBox | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ id?: string; start: Point; placement?: Placement; camera: ViewBox; pointer: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoaded({ url: sourceUrl, error: "The netlist took too long to load. Try again." });
      controller.abort();
    }, 20_000);
    void fetch(sourceUrl, { signal: controller.signal, credentials: "same-origin" })
      .then(readNetlist)
      .then((source) => { if (!controller.signal.aborted) setLoaded({ url: sourceUrl, source }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ url: sourceUrl, error: error instanceof Error ? error.message : "The netlist could not be read." });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [sourceUrl, retry]);

  const source = loaded?.url === sourceUrl ? loaded.source : undefined;
  const error = loaded?.url === sourceUrl ? loaded.error : undefined;
  const content = useMemo(() => source === undefined ? null : readCircuitDocument(source, filename), [source, filename]);
  const parsed = content?.document;
  const project = content?.project;
  const circuit = parsed?.circuits.find((item) => item.id === circuitId)
    ?? parsed?.circuits.find((item) => item.devices.length > 0) ?? parsed?.circuits[0];
  const scene = circuit?.id === "@top" ? project?.schematic : null;
  const layout = useMemo(() => scene ?? (circuit ? initialLayout(circuit) : { positions: {}, width: 500, height: 300 }), [circuit, scene]);
  const positions = useMemo(() => ({ ...layout.positions, ...moved }), [layout, moved]);
  const nets = useMemo(() => circuit ? circuitNets(circuit, positions) : new Map<string, Terminal[]>(), [circuit, positions]);
  const routedWires = useMemo(() => scene?.wires.map((wire) => {
    const endpoint = ([id, pin]: [string, number]): [number, number] => {
      const d = circuit!.devices.find(item => item.id === id)!;
      const p = positions[id], q = pinOffsets(d)[pin - 1], a = p.rotation * Math.PI / 180;
      return [p.x + q.x * Math.cos(a) - q.y * Math.sin(a), p.y + q.x * Math.sin(a) + q.y * Math.cos(a)];
    };
    const points = wire.points.slice();
    const first = endpoint(wire.from), last = endpoint(wire.to);
    if (first.some((n, i) => Math.abs(n - points[0][i]) > 0.01)) points.unshift(first, [first[0], points[0][1]]);
    const oldLast = points[points.length - 1];
    if (last.some((n, i) => Math.abs(n - oldLast[i]) > 0.01)) points.push([last[0], oldLast[1]], last);
    return { ...wire, points };
  }) ?? [], [circuit, positions, scene]);
  const view = camera ?? { x: 0, y: 0, width: layout.width, height: layout.height };
  const device = circuit?.devices.find((item) => item.id === selected);
  const matching = circuit?.devices.filter((item) => `${item.id} ${item.value} ${item.pins.map((p) => p.node).join(" ")}`.toLowerCase().includes(query.toLowerCase())) ?? [];

  function chooseCircuit(id: string) {
    setCircuitId(id); setSelected(""); setNet(""); setMoved({}); setCamera(null); setQuery("");
  }
  function zoom(factor: number) {
    const width = Math.min(layout.width * 4, Math.max(100, view.width * factor));
    const height = view.height * width / view.width;
    setCamera({ x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height });
  }
  function point(event: PointerEvent): Point {
    const inverse = svg.current?.getScreenCTM()?.inverse();
    if (!inverse) return { x: 0, y: 0 };
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  }
  function start(event: PointerEvent<SVGElement>, id?: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (id) { setSelected(id); setNet(""); }
    gesture.current = { id, start: point(event), placement: id ? positions[id] : undefined, camera: view, pointer: event.pointerId };
    svg.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const next = point(event), dx = next.x - active.start.x, dy = next.y - active.start.y;
    if (active.id && active.placement) {
      const placement = { ...active.placement, x: active.placement.x + dx, y: active.placement.y + dy };
      setMoved((old) => ({ ...old, [active.id!]: placement }));
    } else {
      // The point uses the current camera; accumulate its delta to avoid drift.
      setCamera({ ...view, x: view.x - dx, y: view.y - dy });
    }
  }
  function fit() {
    const values = Object.values(positions);
    if (!values.length) { setCamera(null); return; }
    const x = Math.min(...values.map((p) => p.x)) - 120;
    const y = Math.min(...values.map((p) => p.y)) - 90;
    const maxX = Math.max(...values.map((p) => p.x)) + 120;
    const maxY = Math.max(...(circuit?.devices.map((d) => positions[d.id].y + Math.max(90, Math.ceil(d.pins.length / 2) * 12 + 50)) ?? [y + 200]));
    setCamera({ x, y, width: maxX - x, height: maxY - y });
  }
  function exportSvg() {
    if (!svg.current) return;
    const clone = svg.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1600"); clone.setAttribute("height", String(Math.round(1600 * view.height / view.width)));
    clone.setAttribute("style", "background:white;color:#172033;--nl-bg:#ffffff;font-family:system-ui,sans-serif");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const link = document.createElement("a"); link.href = url; link.download = `${filename.replace(/\.[^.]+$/, "")}-${circuit?.name ?? "circuit"}.svg`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveProject() {
    if (!project) return;
    const saved = scene ? { ...project, schematic: { ...scene, positions, wires: routedWires } } : project;
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={styles.viewer} aria-label="SPICE netlist viewer" aria-busy={source === undefined && !error}>
    <div className={styles.toolbar}>
      <div className={styles.tabs} aria-label="Netlist view">
        <button type="button" aria-pressed={mode === "circuit"} onClick={() => setMode("circuit")}>Circuit</button>
        <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>Source</button>
      </div>
      <select aria-label="Circuit or subcircuit" value={circuit?.id ?? ""} onChange={(e) => chooseCircuit(e.target.value)} disabled={!parsed}>
        {!parsed && <option value="">Circuit</option>}
        {parsed?.circuits.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.devices.length})</option>)}
      </select>
      <button type="button" onClick={exportSvg} disabled={!circuit?.devices.length || mode !== "circuit"}>Export SVG</button>
      {project && <button type="button" onClick={saveProject}>Save circuit project</button>}
    </div>
    {source === undefined && !error && <ArtifactPreviewLoading label="Loading circuit…" />}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setLoaded(undefined); setRetry((n) => n + 1); }}>Retry</button></p>}
    {mode === "source" && source !== undefined && <pre className={styles.source} aria-label="SPICE source">{content?.netlist ?? source}</pre>}
    {mode === "circuit" && <>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => zoom(0.75)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(1.333)} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit}>Fit</button>
        <button type="button" onClick={() => { setMoved({}); setCamera(null); }}>Reset layout</button>
        <label><input type="checkbox" checked={showWires} onChange={(e) => setShowWires(e.target.checked)} />All connections</label>
      </div>
      <p className={styles.hint}>{scene ? "Connected schematic. Labeled ground and supply rails are common. " : "Netlist connectivity view. "}Select a pin or net to trace connections. Drag symbols to move; drag the canvas to pan. Crossing lines without dots are not junctions.</p>
      <svg ref={svg} className={styles.canvas} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="group" aria-label={`${circuit?.name ?? filename} circuit`} onPointerDown={(e) => start(e)} onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }}>
        <title>{filename} — {circuit?.name}</title>
        <g fill="none" strokeWidth={1.3}>
          {scene ? routedWires.filter(wire => showWires || wire.net === net).map((wire, index) => <g key={index} data-net={wire.net} opacity={net && net !== wire.net ? 0.15 : 1}>
            <polyline points={wire.points.map(p => p.join(",")).join(" ")} stroke="var(--nl-bg, #ffffff)" strokeWidth={6} />
            <polyline points={wire.points.map(p => p.join(",")).join(" ")} stroke={netColor(wire.net)} strokeWidth={net === wire.net ? 2.5 : 1.5} />
          </g>) : Array.from(nets.entries()).filter(([name]) => name !== "0" && (showWires || name === net)).map(([name, pins]) => <g key={name} stroke={netColor(name)} opacity={net && net !== name ? 0.12 : net === name ? 1 : 0.65} data-net={name}>
            {pins.slice(1).map((pin, i) => <path key={`${pin.device}:${pin.pin}`} d={`M ${pins[i].x} ${pins[i].y} L ${pin.x} ${pin.y}`} strokeWidth={net === name ? 2.5 : 1.3} />)}
          </g>)}
          {scene?.junctions.filter(dot => showWires || dot.net === net).map((dot, i) => <circle key={i} cx={dot.x} cy={dot.y} r={3.5} fill={netColor(dot.net)} opacity={net && dot.net !== net ? 0.15 : 1} />)}
        </g>
        {circuit?.devices.map((item) => {
          const p = positions[item.id], offsets = pinOffsets(item);
          const labelY = scene ? -Math.max(96, blockSymbol(item) ? Math.ceil(item.pins.length / 2) * 12 + 48 : 96) : blockSymbol(item) ? -Math.max(22, Math.ceil(item.pins.length / 2) * 12) - 15 : -58;
          return <g key={item.id} transform={`translate(${p.x} ${p.y})`} data-component={item.id}>
            <g transform={`rotate(${p.rotation})`}>
              <rect x={-80} y={Math.min(-49, labelY + 4)} width={160} height={Math.max(100, -labelY * 2 - 5)} rx={8} fill="none" stroke={selected === item.id ? "#2563eb" : "none"} strokeWidth={2} />
              <g role="button" tabIndex={0} aria-label={`Select ${item.id}`} onPointerDown={(e) => start(e, item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(item.id); setNet(""); } }} style={{ cursor: "grab" }} stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinejoin="round">
                <rect x={-60} y={Math.min(-40, labelY + 8)} width={120} height={Math.max(80, -labelY * 2 - 16)} fill="transparent" stroke="none" />
                <NetlistSymbol device={item} />
                <title>{item.source}</title>
              </g>
              {offsets.map((pin, i) => {
                const node = item.pins[i].node;
                return <g key={i} role="button" tabIndex={0} aria-label={`${item.id} pin ${item.pins[i].name}: ${node}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setNet(node); setSelected(item.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setNet(node); setSelected(item.id); } }} style={{ cursor: "pointer" }}>
                  <circle cx={pin.x} cy={pin.y} r={10} fill="transparent" /><circle cx={pin.x} cy={pin.y} r={node === net ? 4 : 2.5} fill={netColor(node)} />
                  <text x={pin.x < 0 ? pin.x - 4 : pin.x + 4} y={pin.y - 7} textAnchor={pin.x < 0 ? "end" : "start"} fontSize={9} fill={netColor(node)}>{node.length > 12 ? `${node.slice(0, 11)}…` : node}</text>
                  {node === "0" && <path d={`M ${pin.x} ${pin.y + 3} v 8 m -8 0 h 16 m -13 4 h 10 m -7 4 h 4`} fill="none" stroke="currentColor" strokeWidth={1.2} />}
                </g>;
              })}
            </g>
            <text x={0} y={labelY - 4} textAnchor="middle" fill="currentColor" fontSize={13} fontWeight={600}>{item.id}</text>
            <text x={0} y={labelY + 10} textAnchor="middle" fill="currentColor" fontSize={10}>{item.value.length > 30 ? `${item.value.slice(0, 29)}…` : item.value}</text>
          </g>;
        })}
      </svg>
      <div className={styles.inspector}>
        <div className={styles.toolbar}>
          <input aria-label="Find component or net" placeholder="Find component or net…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Select component" value={selected} onChange={(e) => { setSelected(e.target.value); setNet(""); }}><option value="">{circuit?.devices.length ?? 0} components</option>{matching.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.value.slice(0, 50)}</option>)}</select>
          <select aria-label="Trace net" value={net} onChange={(e) => setNet(e.target.value)}><option value="">{nets.size} nets</option>{Array.from(nets.keys()).sort().map((name) => <option key={name} value={name}>{name} ({nets.get(name)?.length} pins)</option>)}</select>
        </div>
        {circuit?.ports.length ? <p className={styles.hint}>Ports: {circuit.ports.join(", ")}{circuit.parameters ? ` · ${circuit.parameters}` : ""}</p> : null}
        {device && <div className={styles.details}>
          <strong>{device.id}</strong><span>Line {device.line}</span>
          <button type="button" onClick={() => setCamera({ x: positions[device.id].x - 240, y: positions[device.id].y - 180, width: 480, height: 360 })}>Focus</button>
          <button type="button" onClick={() => setMoved((old) => ({ ...old, [device.id]: { ...positions[device.id], rotation: (positions[device.id].rotation + 90) % 360 } }))}>Rotate 90°</button>
          {device.subcircuit && <button type="button" onClick={() => chooseCircuit(device.subcircuit!)}>Open {device.model}</button>}
          <code>{device.source}</code>
          <div className={styles.pins}>{device.pins.map((pin, i) => <button key={i} type="button" aria-pressed={net === pin.node} onClick={() => setNet(pin.node)}>{pin.name}: {pin.node}</button>)}</div>
        </div>}
        {net && <p className={styles.netSummary} role="status"><strong>{net === "0" ? "0 (ground)" : net}</strong>: {nets.get(net)?.map((p) => `${p.device}.${p.pin}`).join(" · ")}</p>}
      </div>
    </>}
    {!!parsed?.diagnostics.length && <details className={styles.diagnostics} open={parsed.diagnostics.some((item) => item.severity === "error")}><summary>{parsed.diagnostics.length} netlist {parsed.diagnostics.length === 1 ? "diagnostic" : "diagnostics"}</summary><ul>{parsed.diagnostics.map((item, i) => <li key={i}>Line {item.line}: {item.message}</li>)}</ul></details>}
    {project && <details className={styles.diagnostics} open={project.review.warnings.length > 0}><summary>Design review · {project.review.component_counts.opamp ?? 0} op-amps</summary><ul>{project.review.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><p>Export does not establish simulation or hardware verification.</p></details>}
    <p className={styles.credit}>Adapted from <a href="https://github.com/f18m/netlist-viewer" target="_blank" rel="noreferrer">netlist-viewer</a>. Connections describe the source; they do not verify simulation results.</p>
  </section>;
}
