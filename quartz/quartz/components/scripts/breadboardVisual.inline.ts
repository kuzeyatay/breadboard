/**
 * Breadboard visual renderer. Hydrates `code.breadboard-visual-block` nodes
 * (emitted by the BreadboardVisuals transformer) into interactive cards.
 *
 * Safety: specs are data only. Every node is built with createElement /
 * createElementNS / textContent — spec strings are never parsed as HTML and
 * never executed.
 */

const SVG_NS = "http://www.w3.org/2000/svg"

type Dict = Record<string, unknown>

interface Spec {
  id: string
  type: string
  title: string
  subtitle?: string
  sourceAnchors: Array<Dict>
  conceptTargets: string[]
  pedagogicalPurpose: string
  props: Dict
  controls?: Array<Dict>
  annotations?: Array<Dict>
  caption?: string
  regenerationPrompt: string
  version: number
}

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback
const str = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value))
  }
  return node
}

// ---------------------------------------------------------------------- plot

interface Series {
  fn: (x: number) => number
  color: string
  label: string
  dash?: string
}

interface PlotOptions {
  xMin: number
  xMax: number
  yMin?: number
  yMax?: number
  series: Series[]
  markerX?: number
  xLabel?: string
  yLabel?: string
}

const W = 640
const H = 300
const PAD = { left: 46, right: 14, top: 16, bottom: 34 }

function drawPlot(container: HTMLElement, opts: PlotOptions): void {
  container.textContent = ""
  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "bv-svg",
    role: "img",
  }) as SVGSVGElement

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const samples = 240

  let yMin = opts.yMin ?? Infinity
  let yMax = opts.yMax ?? -Infinity
  const sampled = opts.series.map((series) => {
    const points: Array<[number, number]> = []
    for (let index = 0; index <= samples; index++) {
      const x = opts.xMin + ((opts.xMax - opts.xMin) * index) / samples
      let y = series.fn(x)
      if (!Number.isFinite(y)) y = NaN
      points.push([x, y])
      if (opts.yMin === undefined && Number.isFinite(y)) yMin = Math.min(yMin, y)
      if (opts.yMax === undefined && Number.isFinite(y)) yMax = Math.max(yMax, y)
    }
    return points
  })
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1
    yMax = 1
  }
  if (yMax - yMin < 1e-9) {
    yMax += 1
    yMin -= 1
  }
  const spread = (yMax - yMin) * 0.08
  yMin -= spread
  yMax += spread

  const toX = (x: number) => PAD.left + ((x - opts.xMin) / (opts.xMax - opts.xMin)) * innerW
  const toY = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * innerH

  // axes
  if (yMin < 0 && yMax > 0) {
    svg.appendChild(
      svgEl("line", {
        x1: PAD.left, y1: toY(0), x2: W - PAD.right, y2: toY(0), class: "bv-axis",
      }),
    )
  }
  if (opts.xMin < 0 && opts.xMax > 0) {
    svg.appendChild(
      svgEl("line", {
        x1: toX(0), y1: PAD.top, x2: toX(0), y2: H - PAD.bottom, class: "bv-axis",
      }),
    )
  }
  svg.appendChild(
    svgEl("rect", {
      x: PAD.left, y: PAD.top, width: innerW, height: innerH, class: "bv-frame", fill: "none",
    }),
  )

  // ticks (min / max labels)
  const tickLabel = (text: string, x: number, y: number, anchor: string) => {
    const label = svgEl("text", { x, y, class: "bv-tick", "text-anchor": anchor })
    label.textContent = text
    svg.appendChild(label)
  }
  tickLabel(opts.xMin.toFixed(1), PAD.left, H - PAD.bottom + 16, "start")
  tickLabel(opts.xMax.toFixed(1), W - PAD.right, H - PAD.bottom + 16, "end")
  tickLabel(yMax.toFixed(1), PAD.left - 6, PAD.top + 10, "end")
  tickLabel(yMin.toFixed(1), PAD.left - 6, H - PAD.bottom, "end")
  if (opts.xLabel) tickLabel(opts.xLabel, PAD.left + innerW / 2, H - 8, "middle")

  sampled.forEach((points, index) => {
    const series = opts.series[index]
    let d = ""
    let pen = false
    for (const [x, y] of points) {
      if (!Number.isFinite(y)) {
        pen = false
        continue
      }
      const clampedY = Math.min(Math.max(y, yMin), yMax)
      d += `${pen ? "L" : "M"}${toX(x).toFixed(2)},${toY(clampedY).toFixed(2)}`
      pen = true
    }
    const path = svgEl("path", { d, fill: "none", stroke: series.color, "stroke-width": 2 })
    if (series.dash) path.setAttribute("stroke-dasharray", series.dash)
    svg.appendChild(path)
  })

  if (opts.markerX !== undefined && opts.markerX >= opts.xMin && opts.markerX <= opts.xMax) {
    svg.appendChild(
      svgEl("line", {
        x1: toX(opts.markerX), y1: PAD.top, x2: toX(opts.markerX), y2: H - PAD.bottom,
        class: "bv-marker",
      }),
    )
  }

  container.appendChild(svg)

  if (opts.series.length > 1 || opts.series[0]?.label) {
    const legend = el("div", "bv-legend")
    for (const series of opts.series) {
      if (!series.label) continue
      const item = el("span", "bv-legend-item")
      const swatch = el("span", "bv-swatch")
      swatch.style.background = series.color
      item.appendChild(swatch)
      item.appendChild(document.createTextNode(series.label))
      legend.appendChild(item)
    }
    container.appendChild(legend)
  }
}

// ------------------------------------------------------------ visual types

const COLORS = { a: "#4f6f68", b: "#7b97aa", c: "#a45c5c", d: "#9a7b2e" }

type Renderer = (figure: HTMLElement, state: Dict) => void

function functionValue(family: string, params: Dict, x: number): number {
  const a = num(params.a, 1)
  const b = num(params.b, 1)
  const c = num(params.c, 0)
  const d = num(params.d, 0)
  switch (family) {
    case "cosine":
      return a * Math.cos(b * x + c) + d
    case "damped_sine":
      return a * Math.exp(-Math.abs(c) * x) * Math.sin(b * x)
    case "exp_decay":
      return a * Math.exp(-Math.abs(b) * x) + d
    case "exponential":
      return a * Math.exp(b * x) + d
    case "gaussian": {
      const sigma = Math.abs(num(params.c, 1)) || 1
      return a * Math.exp(-((x - b) ** 2) / (2 * sigma * sigma)) + d
    }
    case "linear":
      return a * x + b
    case "abs":
      return a * Math.abs(x - b) + c
    case "reciprocal":
      return x === 0 ? NaN : a / x + d
    case "polynomial": {
      const coefficients = Array.isArray(params.coefficients)
        ? (params.coefficients as unknown[]).map((value) => num(value, 0))
        : [0, 1]
      let y = 0
      for (let index = coefficients.length - 1; index >= 0; index--) {
        y = y * x + coefficients[index]
      }
      return y
    }
    case "sine":
    default:
      return a * Math.sin(b * x + c) + d
  }
}

const renderFunctionPlot: Renderer = (figure, state) => {
  const family = str(state.family, "sine")
  const params = { ...(state.parameters as Dict | undefined), ...state }
  drawPlot(figure, {
    xMin: num(state.xMin, -5),
    xMax: num(state.xMax, 5),
    yMin: typeof state.yMin === "number" ? (state.yMin as number) : undefined,
    yMax: typeof state.yMax === "number" ? (state.yMax as number) : undefined,
    series: [
      {
        fn: (x) => functionValue(family, params, x),
        color: COLORS.a,
        label: str(state.expressionLatex, "f(x)"),
      },
    ],
    xLabel: "x",
  })
}

const renderLinkedTimePlots: Renderer = (figure, state) => {
  const A = num(state.amplitude, 1)
  const w = Math.max(num(state.angularFrequency, 1), 0.01)
  const phi = num(state.phase, 0)
  const duration = num(state.duration, (4 * Math.PI) / w)
  const series: Series[] = []
  if (bool(state.showPosition, true)) {
    series.push({ fn: (t) => A * Math.cos(w * t + phi), color: COLORS.a, label: "x(t) = A cos(ωt + φ)" })
  }
  if (bool(state.showVelocity, true)) {
    series.push({
      fn: (t) => -A * w * Math.sin(w * t + phi),
      color: COLORS.b,
      label: "v(t) = −Aω sin(ωt + φ)",
    })
  }
  if (bool(state.showAcceleration, true)) {
    series.push({
      fn: (t) => -A * w * w * Math.cos(w * t + phi),
      color: COLORS.c,
      label: "a(t) = −Aω² cos(ωt + φ)",
      dash: "6 4",
    })
  }
  drawPlot(figure, { xMin: 0, xMax: Math.max(duration, 0.5), series, xLabel: "t" })
}

function arrow(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, color: string, label?: string) {
  if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return
  const line = svgEl("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 3 })
  svg.appendChild(line)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 9
  const head = svgEl("path", {
    d: `M${x2},${y2} L${x2 - size * Math.cos(angle - 0.45)},${y2 - size * Math.sin(angle - 0.45)} L${
      x2 - size * Math.cos(angle + 0.45)
    },${y2 - size * Math.sin(angle + 0.45)} Z`,
    fill: color,
  })
  svg.appendChild(head)
  if (label) {
    const text = svgEl("text", {
      x: (x1 + x2) / 2,
      y: y1 - 8,
      class: "bv-tick",
      "text-anchor": "middle",
      fill: color,
    })
    text.textContent = label
    svg.appendChild(text)
  }
}

const renderMassSpring: Renderer = (figure, state) => {
  figure.textContent = ""
  const A = num(state.amplitude, 1)
  const w = Math.max(num(state.angularFrequency, 1), 0.01)
  const phi = num(state.phase, 0)
  const x = A * Math.cos(phi)
  const v = -A * w * Math.sin(phi)

  const width = 640
  const height = 220
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "bv-svg" }) as SVGSVGElement

  const wallX = 40
  const equilibriumX = 340
  const scale = 110 // px per unit displacement
  const massX = equilibriumX + x * scale
  const massY = 120
  const massSize = 52

  // wall + floor
  svg.appendChild(svgEl("rect", { x: wallX - 12, y: 40, width: 12, height: 130, class: "bv-solid" }))
  svg.appendChild(svgEl("line", { x1: 10, y1: massY + massSize / 2 + 4, x2: width - 10, y2: massY + massSize / 2 + 4, class: "bv-axis" }))

  // equilibrium line
  svg.appendChild(
    svgEl("line", { x1: equilibriumX, y1: 34, x2: equilibriumX, y2: massY + massSize / 2 + 4, class: "bv-marker" }),
  )
  const eqLabel = svgEl("text", { x: equilibriumX, y: 26, class: "bv-tick", "text-anchor": "middle" })
  eqLabel.textContent = "x = 0"
  svg.appendChild(eqLabel)

  // spring zigzag from wall to mass
  const springY = massY
  const coils = 9
  const springStart = wallX
  const springEnd = massX - massSize / 2
  let d = `M${springStart},${springY}`
  for (let index = 0; index <= coils; index++) {
    const sx = springStart + ((springEnd - springStart) * (index + 0.5)) / (coils + 1)
    const sy = springY + (index % 2 === 0 ? -14 : 14)
    d += ` L${sx.toFixed(1)},${sy}`
  }
  d += ` L${springEnd},${springY}`
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: "#50615a", "stroke-width": 2.5 }))

  // mass
  svg.appendChild(
    svgEl("rect", {
      x: massX - massSize / 2,
      y: massY - massSize / 2,
      width: massSize,
      height: massSize,
      rx: 6,
      class: "bv-mass",
    }),
  )
  const massLabel = svgEl("text", { x: massX, y: massY + 5, class: "bv-mass-label", "text-anchor": "middle" })
  massLabel.textContent = "m"
  svg.appendChild(massLabel)

  // displacement arrow (equilibrium -> mass)
  if (Math.abs(x) > 0.02) {
    arrow(svg, equilibriumX, 52, massX, 52, COLORS.d, `x = ${x.toFixed(2)}`)
  }
  // restoring force arrow F = -kx (opposite displacement)
  if (bool(state.showForceVector, true) && Math.abs(x) > 0.02) {
    arrow(svg, massX, 88, massX - x * scale * 0.55, 88, COLORS.c, "F = −kx")
  }
  // velocity arrow
  if (bool(state.showVelocityVector, false) && Math.abs(v) > 0.02) {
    arrow(svg, massX, 176, massX + v * scale * 0.4, 176, COLORS.b, `v = ${v.toFixed(2)}`)
  }

  figure.appendChild(svg)
}

const renderEnergyExchange: Renderer = (figure, state) => {
  figure.textContent = ""
  const A = num(state.amplitude, 1)
  const k = Math.max(num(state.springConstant, 1), 0.0001)
  const m = Math.max(num(state.mass, 1), 0.0001)
  const phi = num(state.phase, 0)
  const w = Math.sqrt(k / m)
  const x = A * Math.cos(phi)
  const v = -A * w * Math.sin(phi)
  const U = 0.5 * k * x * x
  const K = 0.5 * m * v * v
  const E = 0.5 * k * A * A

  const width = 640
  const height = 260
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "bv-svg" }) as SVGSVGElement

  const baseY = 210
  const maxBar = 150
  const barWidth = 90
  const bars: Array<{ label: string; value: string; height: number; x: number; color: string }> = [
    { label: "U = ½kx²", value: U.toFixed(2), height: (U / E) * maxBar, x: 120, color: COLORS.a },
    { label: "K = ½mv²", value: K.toFixed(2), height: (K / E) * maxBar, x: 280, color: COLORS.b },
    { label: "E = K + U", value: E.toFixed(2), height: maxBar, x: 440, color: COLORS.d },
  ]
  for (const bar of bars) {
    const barHeight = Math.max(Math.min(bar.height, maxBar), 0)
    svg.appendChild(
      svgEl("rect", {
        x: bar.x, y: baseY - barHeight, width: barWidth, height: Math.max(barHeight, 1),
        rx: 4, fill: bar.color, opacity: 0.85,
      }),
    )
    const label = svgEl("text", { x: bar.x + barWidth / 2, y: baseY + 20, class: "bv-tick", "text-anchor": "middle" })
    label.textContent = bar.label
    svg.appendChild(label)
    const value = svgEl("text", {
      x: bar.x + barWidth / 2, y: baseY - barHeight - 7, class: "bv-tick", "text-anchor": "middle",
    })
    value.textContent = bar.value
    svg.appendChild(value)
  }
  // total-energy reference line across U and K bars
  svg.appendChild(
    svgEl("line", { x1: 100, y1: baseY - maxBar, x2: 550, y2: baseY - maxBar, class: "bv-marker" }),
  )
  const info = svgEl("text", { x: 100, y: 26, class: "bv-tick", "text-anchor": "start" })
  info.textContent = `x = ${x.toFixed(2)}, v = ${v.toFixed(2)}, ω = √(k/m) = ${w.toFixed(2)}`
  svg.appendChild(info)

  figure.appendChild(svg)
}

const renderResonanceCurve: Renderer = (figure, state) => {
  const w0 = Math.max(num(state.naturalFrequency, 1), 0.01)
  const gamma = Math.max(num(state.damping, 0.2), 0.001)
  const drive = num(state.driveFrequency, w0)
  const response = (wd: number) => 1 / Math.sqrt((w0 * w0 - wd * wd) ** 2 + (gamma * wd) ** 2)
  drawPlot(figure, {
    xMin: 0,
    xMax: 2.5 * w0,
    series: [
      { fn: response, color: COLORS.a, label: "steady-state amplitude A(ω_drive)" },
    ],
    markerX: drive,
    xLabel: "drive frequency ω",
  })
  const note = el(
    "p",
    "bv-readout",
    `A(${drive.toFixed(2)}) = ${response(drive).toFixed(2)} — natural frequency ω₀ = ${w0.toFixed(2)}, damping γ = ${gamma.toFixed(2)}`,
  )
  figure.appendChild(note)
}

// ----------------------------------------------------- spiking-network visuals

/** Nearest-sample lookup over a precomputed trace, for feeding drawPlot. */
function traceLookup(trace: Array<[number, number]>): (x: number) => number {
  return (x: number) => {
    if (trace.length === 0) return NaN
    if (x <= trace[0][0]) return trace[0][1]
    if (x >= trace[trace.length - 1][0]) return trace[trace.length - 1][1]
    let lo = 0
    let hi = trace.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (trace[mid][0] < x) lo = mid + 1
      else hi = mid
    }
    return trace[lo][1]
  }
}

/** Leaky integrate-and-fire membrane potential simulator: input drives the
 * potential up, leak pulls it toward rest, a threshold crossing emits a spike
 * and resets, and a refractory period holds the neuron silent. */
function renderLifNeuron(figure: HTMLElement, state: Dict): void {
  const rest = num(state.restPotential, 0)
  const threshold = num(state.threshold, 1)
  const reset = num(state.resetPotential, rest)
  const input = num(state.inputCurrent, 1.2)
  const leak = Math.min(1, Math.max(0.01, num(state.leak, 0.15)))
  const refractory = Math.max(0, num(state.refractory, 2))
  const duration = Math.min(200, Math.max(10, num(state.duration, 40)))
  const dt = 0.1

  const trace: Array<[number, number]> = []
  const spikes: number[] = []
  let V = rest
  let refractoryUntil = -1
  for (let t = 0; t <= duration + 1e-9; t += dt) {
    if (t < refractoryUntil) {
      V = reset
    } else {
      V += dt * (-(V - rest) * leak + input)
      if (V >= threshold) {
        trace.push([t, threshold + 0.4]) // spike tip
        spikes.push(t)
        V = reset
        refractoryUntil = t + refractory
      }
    }
    trace.push([t, V])
  }

  drawPlot(figure, {
    xMin: 0,
    xMax: duration,
    yMin: Math.min(reset, rest) - 0.25,
    yMax: threshold + 0.7,
    series: [
      { fn: traceLookup(trace), color: COLORS.a, label: "membrane potential V(t)" },
      { fn: () => threshold, color: COLORS.c, label: "firing threshold", dash: "5 4" },
    ],
    xLabel: "time (ms)",
  })

  const rate = spikes.length / (duration || 1)
  figure.appendChild(
    el(
      "p",
      "bv-readout",
      `${spikes.length} spike${spikes.length === 1 ? "" : "s"} in ${duration.toFixed(0)} ms · ` +
        `input ${input.toFixed(2)} · leak ${leak.toFixed(2)} · refractory ${refractory.toFixed(1)} ms · ` +
        `firing rate ${(rate * 1000).toFixed(0)} Hz. ` +
        (spikes.length === 0
          ? "Input is too weak to reach threshold — leak cancels it out."
          : "Each spike resets the potential; leak then pulls it back toward rest."),
    ),
  )
}

/** Rate coding vs temporal coding: the same stimulus strength produces either
 * more spikes (rate) or an earlier first spike (temporal). */
function renderNeuralCoding(figure: HTMLElement, state: Dict): void {
  const strength = Math.min(1, Math.max(0, num(state.strength, 0.6)))
  const mode = str(state.mode, "both")
  const window = 400 // ms
  const w = 640
  const rowH = 54
  const rows = mode === "both" ? 2 : 1
  const h = 40 + rows * rowH
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "bv-svg", role: "img" }) as SVGSVGElement

  const drawRow = (y: number, label: string, times: number[], color: string) => {
    svg.appendChild(svgEl("line", { x1: 60, y1: y + rowH / 2, x2: w - 16, y2: y + rowH / 2, class: "bv-axis" }))
    const caption = svgEl("text", { x: 60, y: y + 12, class: "bv-tick", "text-anchor": "start" })
    caption.textContent = label
    svg.appendChild(caption)
    for (const t of times) {
      const x = 60 + (t / window) * (w - 76)
      svg.appendChild(
        svgEl("line", { x1: x, y1: y + rowH / 2 - 14, x2: x, y2: y + rowH / 2 + 14, stroke: color, "stroke-width": 2.5 }),
      )
    }
  }

  let top = 28
  const rateTimes: number[] = []
  const spikeCount = Math.round(1 + strength * 11)
  for (let i = 0; i < spikeCount; i++) rateTimes.push(((i + 0.5) / spikeCount) * window)
  const latency = (1 - strength) * window * 0.85 + 10
  const temporalTimes = [latency]

  if (mode === "rate" || mode === "both") {
    drawRow(top, "rate coding", rateTimes, COLORS.b)
    top += rowH
  }
  if (mode === "temporal" || mode === "both") {
    drawRow(top, "temporal coding", temporalTimes, COLORS.d)
  }
  figure.textContent = ""
  figure.appendChild(svg)
  figure.appendChild(
    el(
      "p",
      "bv-readout",
      `Stimulus strength ${(strength * 100).toFixed(0)}%. ` +
        `Rate coding fires ${spikeCount} spikes across the window — count carries the signal. ` +
        `Temporal coding fires once at ${latency.toFixed(0)} ms — a stronger stimulus spikes earlier, so timing carries the signal.`,
    ),
  )
}

/** STDP learning window: the synaptic weight change depends on the sign and
 * size of the pre/post spike timing difference. */
function renderStdpWindow(figure: HTMLElement, state: Dict): void {
  const aPlus = Math.max(0, num(state.aPlus, 1))
  const aMinus = Math.max(0, num(state.aMinus, 1))
  const tauPlus = Math.max(1, num(state.tauPlus, 20))
  const tauMinus = Math.max(1, num(state.tauMinus, 20))
  const deltaT = num(state.deltaT, 8)
  const win = Math.max(tauPlus, tauMinus) * 3
  const dw = (dt: number) => (dt >= 0 ? aPlus * Math.exp(-dt / tauPlus) : -aMinus * Math.exp(dt / tauMinus))

  drawPlot(figure, {
    xMin: -win,
    xMax: win,
    series: [{ fn: dw, color: COLORS.b, label: "Δw (synaptic weight change)" }],
    markerX: deltaT,
    xLabel: "Δt = t(post) − t(pre), ms",
  })

  const regime =
    deltaT > 0.5
      ? "pre fires before post → the synapse strengthens (potentiation, LTP)"
      : deltaT < -0.5
        ? "post fires before pre → the synapse weakens (depression, LTD)"
        : "near-simultaneous spikes → almost no change"
  figure.appendChild(
    el("p", "bv-readout", `Δt = ${deltaT.toFixed(1)} ms → Δw = ${dw(deltaT).toFixed(3)}. ${regime}.`),
  )
}

function renderMetricCalculator(figure: HTMLElement, state: Dict): void {
  const correct = Math.max(0, num(state.correct, 920))
  const total = Math.max(1, num(state.total, 1000))
  const stimulusTime = num(state.stimulusTime, 0)
  const decisionTime = Math.max(stimulusTime, num(state.decisionTime, 24))
  const spikeCount = Math.max(0, num(state.spikeCount, 180))
  const energyPerSpike = Math.max(0.0001, num(state.energyPerSpike, 0.002))
  const accuracy = Math.min(1, correct / total)
  const latency = decisionTime - stimulusTime
  const energy = spikeCount * energyPerSpike
  const normalizedEfficiency = energy > 0 ? accuracy / energy : accuracy
  const values = [
    { label: "Accuracy", value: accuracy, display: `${(accuracy * 100).toFixed(1)}%`, better: "higher" },
    { label: "Latency", value: Math.min(1, latency / 100), display: `${latency.toFixed(0)} ms`, better: "lower" },
    { label: "Energy", value: Math.min(1, energy), display: energy.toFixed(3), better: "lower" },
    { label: "Efficiency", value: Math.min(1, normalizedEfficiency / 10), display: normalizedEfficiency.toFixed(2), better: "higher" },
  ]

  figure.textContent = ""
  const grid = el("div", "bv-metric-grid")
  for (const item of values) {
    const card = el("div", "bv-metric-card")
    card.appendChild(el("span", "bv-metric-label", item.label))
    card.appendChild(el("strong", "bv-metric-value", item.display))
    const bar = el("span", "bv-metric-bar")
    const fill = el("span", "bv-metric-fill")
    fill.style.width = `${Math.max(4, Math.min(100, item.value * 100))}%`
    fill.style.background = item.better === "higher" ? COLORS.a : COLORS.c
    bar.appendChild(fill)
    card.appendChild(bar)
    grid.appendChild(card)
  }
  figure.appendChild(grid)
  figure.appendChild(
    el(
      "p",
      "bv-readout",
      `This input set gives ${(accuracy * 100).toFixed(1)}% accuracy, ${latency.toFixed(0)} ms latency, ` +
        `${spikeCount.toFixed(0)} spikes, and ${energy.toFixed(3)} estimated energy. ` +
        `Changing spike count can improve energy even when accuracy barely changes.`,
    ),
  )
}

function renderTrainingCurve(figure: HTMLElement, state: Dict): void {
  const learningRate = Math.max(0.01, num(state.learningRate, 0.35))
  const noise = Math.max(0, num(state.noise, 0.08))
  const threshold = Math.min(0.99, Math.max(0.5, num(state.threshold, 0.9)))
  const epochs = Math.max(8, Math.round(num(state.epochs, 30)))
  const accAt = (epoch: number) => {
    const base = 0.45 + 0.52 * (1 - Math.exp((-learningRate * epoch) / 5))
    const wobble = noise * 0.08 * Math.sin(epoch * 1.7)
    return Math.min(0.99, Math.max(0, base - wobble))
  }
  const lossAt = (epoch: number) => {
    const base = 1.2 * Math.exp((-learningRate * epoch) / 4) + 0.12
    const wobble = noise * 0.08 * Math.cos(epoch * 1.3)
    return Math.max(0.02, base + wobble)
  }
  let convergenceEpoch = epochs
  for (let epoch = 0; epoch <= epochs; epoch++) {
    if (accAt(epoch) >= threshold) {
      convergenceEpoch = epoch
      break
    }
  }
  drawPlot(figure, {
    xMin: 0,
    xMax: epochs,
    yMin: 0,
    yMax: 1.25,
    markerX: convergenceEpoch,
    xLabel: "epoch",
    series: [
      { fn: (x) => accAt(x), color: COLORS.a, label: "accuracy" },
      { fn: (x) => lossAt(x), color: COLORS.c, label: "loss", dash: "5 4" },
      { fn: () => threshold, color: COLORS.d, label: "target", dash: "2 3" },
    ],
  })
  figure.appendChild(
    el(
      "p",
      "bv-readout",
      accAt(convergenceEpoch) >= threshold
        ? `The accuracy curve first reaches the target near epoch ${convergenceEpoch}.`
        : `The accuracy curve does not reach the target inside ${epochs} epochs.`,
    ),
  )
}

interface TradeoffModel {
  label: string
  accuracy: number // 0..1, higher better
  latency: number // 0..1, lower better
  energy: number // 0..1, lower better
}

function tradeoffModels(state: Dict): TradeoffModel[] {
  const raw = Array.isArray(state.models) ? (state.models as Dict[]) : []
  const models = raw
    .map((model) => ({
      label: str(model.label, "model"),
      accuracy: Math.min(1, Math.max(0, num(model.accuracy, 0.8))),
      latency: Math.min(1, Math.max(0, num(model.latency, 0.5))),
      energy: Math.min(1, Math.max(0, num(model.energy, 0.5))),
    }))
    .filter((model) => model.label !== "model")
  if (models.length >= 2) return models
  // Sensible SNN-family defaults so the visual is never empty.
  return [
    { label: "ANN", accuracy: 0.99, latency: 0.9, energy: 0.95 },
    { label: "Converted SNN", accuracy: 0.95, latency: 0.6, energy: 0.45 },
    { label: "Surrogate-gradient SNN", accuracy: 0.96, latency: 0.45, energy: 0.4 },
    { label: "STDP SNN", accuracy: 0.86, latency: 0.35, energy: 0.2 },
  ]
}

/** Accuracy / latency / energy tradeoff explorer: score each model family under
 * the learner-chosen deployment priority and recommend the best fit. */
function renderTradeoffExplorer(figure: HTMLElement, state: Dict): void {
  const models = tradeoffModels(state)
  const priority = str(state.priority, "balanced")
  const weights =
    priority === "accuracy"
      ? { accuracy: 0.7, latency: 0.15, energy: 0.15 }
      : priority === "latency"
        ? { accuracy: 0.2, latency: 0.6, energy: 0.2 }
        : priority === "energy"
          ? { accuracy: 0.2, latency: 0.2, energy: 0.6 }
          : { accuracy: 0.34, latency: 0.33, energy: 0.33 }

  const score = (m: TradeoffModel) =>
    weights.accuracy * m.accuracy + weights.latency * (1 - m.latency) + weights.energy * (1 - m.energy)

  const w = 640
  const h = 300
  const padL = 150
  const padR = 20
  const padT = 16
  const padB = 24
  const barGap = 10
  const rowH = (h - padT - padB) / models.length
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "bv-svg", role: "img" }) as SVGSVGElement
  const best = models.reduce((a, b) => (score(b) > score(a) ? b : a), models[0])

  models.forEach((model, index) => {
    const y = padT + index * rowH
    const s = score(model)
    const barW = s * (w - padL - padR)
    const label = svgEl("text", { x: padL - 8, y: y + rowH / 2, class: "bv-tick", "text-anchor": "end" })
    label.textContent = model.label
    svg.appendChild(label)
    svg.appendChild(
      svgEl("rect", {
        x: padL,
        y: y + barGap / 2,
        width: Math.max(1, barW),
        height: rowH - barGap,
        fill: model.label === best.label ? COLORS.a : COLORS.b,
        rx: 3,
      }),
    )
    const value = svgEl("text", { x: padL + Math.max(1, barW) + 6, y: y + rowH / 2, class: "bv-tick", "text-anchor": "start" })
    value.textContent = s.toFixed(2)
    svg.appendChild(value)
  })

  figure.textContent = ""
  figure.appendChild(svg)
  const priorityLabel =
    priority === "accuracy"
      ? "highest accuracy"
      : priority === "latency"
        ? "lowest latency"
        : priority === "energy"
          ? "lowest energy"
          : "a balance of all three"
  figure.appendChild(
    el(
      "p",
      "bv-readout",
      `Prioritizing ${priorityLabel}, the best fit is ${best.label}. ` +
        `Change the priority to see why deployment goals, not accuracy alone, drive the model choice.`,
    ),
  )
}

const RENDERERS: Record<string, Renderer> = {
  function_plot: renderFunctionPlot,
  linked_time_plots: renderLinkedTimePlots,
  mass_spring: renderMassSpring,
  energy_exchange: renderEnergyExchange,
  resonance_curve: renderResonanceCurve,
  lif_neuron: renderLifNeuron,
  neural_coding: renderNeuralCoding,
  stdp_window: renderStdpWindow,
  metric_calculator: renderMetricCalculator,
  training_curve: renderTrainingCurve,
  tradeoff_explorer: renderTradeoffExplorer,
}

// ------------------------------------------------------------------- card

function resolveDashboardBaseUrl(): string {
  try {
    const current = new URL(window.location.href)
    if (/^garden\./i.test(current.hostname)) {
      return current.origin.replace("//garden.", "//")
    }
    if (/^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(current.hostname) || current.port === "8081") {
      return `${current.protocol}//${current.hostname}:3000`
    }
    return current.origin
  } catch {
    return ""
  }
}

function pageLocation(): { gardenId: string; pageSlug: string } {
  let pathname = window.location.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // keep raw
  }
  const segments = pathname.split("/").map((segment) => segment.trim()).filter(Boolean)
  if (segments[0] === "garden") segments.shift()
  return { gardenId: segments[0] ?? "", pageSlug: segments.slice(1).join("/") }
}

function sourceNote(anchors: Array<Dict>): string {
  const parts: string[] = []
  for (const anchor of anchors.slice(0, 4)) {
    const bits: string[] = []
    const title = typeof anchor.sourceTitle === "string" ? anchor.sourceTitle : ""
    const sourceId = typeof anchor.sourceId === "string" ? anchor.sourceId : ""
    if (title || sourceId) bits.push(title || sourceId)
    if (typeof anchor.page === "number") bits.push(`p. ${anchor.page}`)
    if (typeof anchor.figureId === "string") bits.push(`figure ${anchor.figureId}`)
    if (typeof anchor.tableId === "string") bits.push(`table ${anchor.tableId}`)
    if (bits.length === 0 && typeof anchor.description === "string") bits.push(anchor.description)
    parts.push(bits.join(", "))
  }
  return parts.filter(Boolean).join(" · ")
}

function buildCard(spec: Spec): HTMLElement {
  const card = el("div", "breadboard-visual-card")
  card.dataset.visualId = spec.id
  card.dataset.visualType = spec.type

  const header = el("div", "bv-header")
  header.appendChild(el("p", "bv-kicker", "Interactive visual"))
  header.appendChild(el("h4", "bv-title", spec.title))
  if (spec.subtitle) header.appendChild(el("p", "bv-subtitle", spec.subtitle))
  card.appendChild(header)

  const figure = el("div", "bv-figure")
  card.appendChild(figure)

  const state: Dict = { ...spec.props }
  for (const control of spec.controls ?? []) {
    const name = control.name as string
    if (state[name] === undefined && control.defaultValue !== undefined) {
      state[name] = control.defaultValue
    }
  }

  // Interactive or nothing: dispatch guarantees a renderer exists for this
  // type. If drawing still fails, the whole card is removed — a broken visual
  // must never degrade into a static explainer card.
  const renderer = (RENDERERS as Record<string, Renderer | undefined>)[spec.type]
  const draw = () => {
    if (!renderer) {
      card.remove()
      return
    }
    try {
      renderer(figure, state)
    } catch {
      card.remove()
    }
  }

  if (renderer && (spec.controls ?? []).length > 0) {
    const controlsBox = el("div", "bv-controls")
    for (const control of spec.controls ?? []) {
      const name = control.name as string
      const row = el("label", "bv-control")
      row.appendChild(el("span", "bv-control-label", String(control.label ?? name)))
      const type = control.type as string
      if (type === "slider") {
        const input = el("input") as HTMLInputElement
        input.type = "range"
        const min = num(control.min, 0)
        const max = num(control.max, Math.max(min + 1, 1))
        input.min = String(min)
        input.max = String(max)
        input.step = String(num(control.step, (max - min) / 100 || 0.01))
        const initial = num(state[name], num(control.defaultValue, (min + max) / 2))
        input.value = String(initial)
        state[name] = initial
        const readout = el("span", "bv-control-value", String(initial))
        input.addEventListener("input", () => {
          state[name] = Number(input.value)
          readout.textContent = input.value
          draw()
        })
        row.appendChild(input)
        row.appendChild(readout)
      } else if (type === "toggle") {
        const input = el("input") as HTMLInputElement
        input.type = "checkbox"
        const initial = bool(state[name], bool(control.defaultValue, false))
        input.checked = initial
        state[name] = initial
        input.addEventListener("change", () => {
          state[name] = input.checked
          draw()
        })
        row.classList.add("bv-control-toggle")
        row.appendChild(input)
      } else if (type === "select") {
        const select = el("select") as HTMLSelectElement
        for (const option of (control.options as string[] | undefined) ?? []) {
          const optionEl = el("option", undefined, option) as HTMLOptionElement
          optionEl.value = option
          select.appendChild(optionEl)
        }
        const initial = str(state[name], str(control.defaultValue, select.options[0]?.value ?? ""))
        if (initial) select.value = initial
        state[name] = select.value
        select.addEventListener("change", () => {
          state[name] = select.value
          draw()
        })
        row.appendChild(select)
      }
      controlsBox.appendChild(row)
    }
    card.appendChild(controlsBox)
  }

  if (spec.caption) card.appendChild(el("p", "bv-caption", spec.caption))
  const source = sourceNote(spec.sourceAnchors ?? [])
  if (source) card.appendChild(el("p", "bv-source", `Source: ${source}`))

  if (spec.pedagogicalPurpose) {
    const details = el("details", "bv-why")
    details.appendChild(el("summary", undefined, "Why this visual is here"))
    details.appendChild(el("p", undefined, spec.pedagogicalPurpose))
    for (const annotation of spec.annotations ?? []) {
      if (typeof annotation.label === "string" && typeof annotation.explanation === "string") {
        details.appendChild(el("p", "bv-annotation", `${annotation.label}: ${annotation.explanation}`))
      }
    }
    card.appendChild(details)
  }

  const footer = el("div", "bv-footer")
  const regenerate = el("button", "bv-regenerate", "Regenerate visualization") as HTMLButtonElement
  regenerate.type = "button"
  const status = el("span", "bv-status")
  footer.appendChild(regenerate)
  footer.appendChild(status)
  card.appendChild(footer)

  regenerate.addEventListener("click", async () => {
    const base = resolveDashboardBaseUrl()
    const { gardenId, pageSlug } = pageLocation()
    if (!base || !gardenId) {
      status.textContent = "Open this page from the dashboard to regenerate"
      return
    }
    regenerate.disabled = true
    status.textContent = "Regenerating…"
    try {
      const response = await fetch(
        `${base}/api/gardens/${encodeURIComponent(gardenId)}/visualizations/${encodeURIComponent(spec.id)}/regenerate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageSlug, reason: spec.regenerationPrompt }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not regenerate")
      }
      status.textContent = "Regenerated — reloading…"
      window.setTimeout(() => window.location.reload(), 2500)
    } catch (error) {
      regenerate.disabled = false
      status.textContent = error instanceof Error ? error.message : "Could not regenerate"
    }
  })

  draw()
  return card
}

document.addEventListener("nav", () => {
  const nodes = document.querySelectorAll("code.breadboard-visual-block") as NodeListOf<HTMLElement>
  for (const code of nodes) {
    const host = (code.closest("pre") as HTMLElement | null) ?? code
    if (host.dataset.bvBound === "true") continue
    host.dataset.bvBound = "true"

    // Interactive or nothing: invalid or non-interactive blocks render nothing
    // at all. The validation script and the garden event ledger are the places
    // where a missing visual gets diagnosed, never the learner's page.
    if (
      code.classList.contains("breadboard-visual-invalid") ||
      code.classList.contains("breadboard-visual-noninteractive")
    ) {
      host.remove()
      continue
    }
    try {
      const spec = JSON.parse(code.dataset.visualSpec ?? "") as Spec
      if (!spec || typeof spec.id !== "string" || typeof spec.type !== "string") {
        throw new Error("bad spec")
      }
      if (!(spec.type in RENDERERS)) {
        host.remove()
        continue
      }
      host.replaceWith(buildCard(spec))
    } catch {
      host.remove()
    }
  }
})
