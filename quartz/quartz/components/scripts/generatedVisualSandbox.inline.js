(() => {
  "use strict"

  const ROOT_ID = "breadboard-generated-visual-root"
  const INIT = "breadboard-generated-visual:init"
  const EVENT = "breadboard-generated-visual:event"
  const SVG_NS = "http://www.w3.org/2000/svg"
  let diagramCounter = 0
  let spatialCounter = 0
  const spatialBoundsCache = new WeakMap()

  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = String(text)
    return node
  }

  const svgElement = (tag, attributes = {}) => {
    const node = document.createElementNS(SVG_NS, tag)
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)))
    return node
  }

  const finite = (value, fallback = 0) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  const evaluate = (expression, state) => {
    if (!expression || typeof expression !== "object") return 0
    if (expression.kind === "constant") return finite(expression.value)
    if (expression.kind === "input") return finite(state[expression.id])
    if (expression.kind === "binary") {
      const left = evaluate(expression.left, state)
      const right = evaluate(expression.right, state)
      if (expression.op === "add") return left + right
      if (expression.op === "subtract") return left - right
      if (expression.op === "multiply") return left * right
      if (expression.op === "divide") return right === 0 ? Number.NaN : left / right
      if (expression.op === "power") return Math.pow(left, right)
      if (expression.op === "min") return Math.min(left, right)
      return Math.max(left, right)
    }
    if (expression.kind === "unary") {
      const value = evaluate(expression.argument, state)
      if (expression.op === "negate") return -value
      if (expression.op === "abs") return Math.abs(value)
      if (expression.op === "sqrt") return Math.sqrt(value)
      if (expression.op === "sin") return Math.sin(value)
      if (expression.op === "cos") return Math.cos(value)
      if (expression.op === "tan") return Math.tan(value)
      if (expression.op === "exp") return Math.exp(value)
      return Math.log(value)
    }
    if (expression.kind === "clamp") {
      return Math.max(
        evaluate(expression.min, state),
        Math.min(evaluate(expression.max, state), evaluate(expression.value, state)),
      )
    }
    if (expression.kind === "conditional") {
      const left = evaluate(expression.left, state)
      const right = evaluate(expression.right, state)
      const matches =
        expression.comparison === "lt"
          ? left < right
          : expression.comparison === "lte"
            ? left <= right
            : expression.comparison === "gt"
              ? left > right
              : expression.comparison === "gte"
                ? left >= right
                : left === right
      return evaluate(matches ? expression.whenTrue : expression.whenFalse, state)
    }
    return 0
  }

  const format = (value, precision = 3) => {
    if (!Number.isFinite(value)) return "Unavailable"
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: precision })
  }

  const styles = `
    :root { color-scheme: light dark; --bg:#fbfaf5; --panel:#f1f5ee; --line:#b7cdc0; --ink:#10251c; --muted:#5d6c65; --accent:#2f7d55; --accent-soft:#cce7d7; --spatial-green:#2f7d55; --spatial-blue:#2563eb; --spatial-amber:#b45309; --spatial-violet:#7c3aed; --spatial-red:#b91c1c; --spatial-cyan:#0e7490; --spatial-gray:#59636e; }
    :root[data-theme="dark"] { --bg:#18181a; --panel:#20211f; --line:#353d37; --ink:#e6ebe5; --muted:#a5aea5; --accent:#91b7a1; --accent-soft:#253832; --spatial-green:#6fca96; --spatial-blue:#78a9ff; --spatial-amber:#f0b35a; --spatial-violet:#b79af4; --spatial-red:#f28b82; --spatial-cyan:#62c8d5; --spatial-gray:#b0bac5; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#18181a; --panel:#20211f; --line:#353d37; --ink:#e6ebe5; --muted:#a5aea5; --accent:#91b7a1; --accent-soft:#253832; } }
    * { box-sizing:border-box; }
    html,body { margin:0; min-height:100%; background:var(--bg); color:var(--ink); font:14px/1.45 ui-sans-serif,system-ui,sans-serif; }
    button,input,select { font:inherit; }
    .gv-root { padding:14px; display:grid; gap:14px; max-width:100%; overflow:hidden; }
    .gv-header h2 { font-size:18px; margin:0 0 4px; }
    .gv-header p { color:var(--muted); margin:0; }
    .gv-scenes { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; }
    .gv-scene { min-width:0; border:1px solid var(--line); background:var(--panel); border-radius:12px; padding:12px; overflow:hidden; }
    .gv-scene h3 { font-size:14px; margin:0 0 8px; }
    .gv-svg { display:block; width:100%; height:auto; min-height:210px; }
    .gv-axis { stroke:var(--muted); stroke-width:1; opacity:.7; }
    .gv-grid { stroke:var(--line); stroke-width:1; opacity:.45; }
    .gv-line { fill:none; stroke-width:2.5; vector-effect:non-scaling-stroke; }
    .gv-node { fill:var(--accent-soft); stroke:var(--accent); stroke-width:1.5; }
    .gv-edge { stroke:var(--muted); stroke-width:1.5; }
    .gv-label { fill:var(--ink); font-size:18px; font-weight:600; paint-order:stroke; stroke:var(--bg); stroke-width:3px; stroke-linejoin:round; text-anchor:middle; }
    .gv-node-label { font-size:15px; }
    .gv-spatial-object { outline:none; }
    .gv-spatial-object:focus { filter:drop-shadow(0 0 4px var(--ink)); }
    .gv-spatial-surface { stroke-width:1.8; vector-effect:non-scaling-stroke; }
    .gv-spatial-line { fill:none; stroke-width:2; vector-effect:non-scaling-stroke; }
    .gv-spatial-leader { stroke:var(--muted); stroke-width:1; stroke-dasharray:3 3; vector-effect:non-scaling-stroke; }
    .gv-spatial-label { fill:var(--ink); font-size:15px; font-weight:650; paint-order:stroke; stroke:var(--bg); stroke-width:3px; stroke-linejoin:round; text-anchor:middle; }
    .gv-spatial-legend { list-style:none; padding:8px 0 0; margin:0; display:flex; flex-wrap:wrap; gap:6px 12px; color:var(--muted); font-size:12px; }
    .gv-spatial-legend li { display:flex; align-items:center; gap:5px; min-width:0; }
    .gv-spatial-symbol { width:1.5em; color:var(--spatial-color,var(--accent)); font-weight:800; text-align:center; }
    .gv-tick { fill:var(--ink); font-size:16px; font-weight:600; paint-order:stroke; stroke:var(--bg); stroke-width:3px; }
    .gv-controls { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; padding-top:2px; }
    .gv-control { display:grid; gap:5px; border:1px solid var(--line); border-radius:10px; padding:9px; background:var(--panel); }
    .gv-control-head { display:flex; justify-content:space-between; gap:8px; }
    .gv-control label { font-weight:600; }
    .gv-readout { color:var(--muted); font-variant-numeric:tabular-nums; }
    .gv-control input[type=range] { width:100%; accent-color:var(--accent); }
    .gv-control input[type=number], .gv-control select { width:100%; border:1px solid var(--line); border-radius:7px; padding:6px 8px; background:var(--bg); color:var(--ink); }
    .gv-values { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; }
    .gv-value { border:1px solid var(--line); border-radius:10px; padding:10px; background:var(--bg); }
    .gv-value span { display:block; color:var(--muted); font-size:12px; }
    .gv-value strong { display:block; font-size:19px; margin-top:2px; font-variant-numeric:tabular-nums; }
    .gv-timeline { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
    .gv-timeline li { border-left:3px solid var(--line); padding:5px 8px; opacity:.55; }
    .gv-timeline li[data-active=true] { border-color:var(--accent); opacity:1; background:var(--accent-soft); border-radius:0 8px 8px 0; }
    .gv-table { width:100%; border-collapse:collapse; }
    .gv-table th,.gv-table td { border-bottom:1px solid var(--line); padding:6px; text-align:left; }
    .gv-formula { font-family:ui-monospace,SFMono-Regular,monospace; overflow-wrap:anywhere; }
    .gv-status { border-left:5px solid var(--accent); }
    .gv-status strong { display:block; font-size:18px; margin:3px 0; }
    .gv-animation { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .gv-animation button,.gv-control button { border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); padding:6px 10px; cursor:pointer; }
    .gv-animation button:focus-visible,.gv-control :focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 55%,transparent); outline-offset:2px; }
    .gv-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto!important; transition:none!important; animation:none!important; } }
    @media (max-width:520px) { .gv-label { font-size:24px; } .gv-tick { font-size:20px; } }
  `

  const installStyles = () => {
    if (document.getElementById("breadboard-generated-visual-styles")) return
    const style = document.createElement("style")
    style.id = "breadboard-generated-visual-styles"
    style.textContent = styles
    document.head.appendChild(style)
  }

  const renderPlot = (scene, state) => {
    const host = element("section", "gv-scene")
    host.appendChild(element("h3", undefined, scene.title))
    const svg = svgElement("svg", { viewBox: "0 0 640 340", class: "gv-svg", role: "img", "aria-label": scene.title })
    const margin = { left: 64, right: 18, top: 18, bottom: 68 }
    const width = 640 - margin.left - margin.right
    const height = 340 - margin.top - margin.bottom
    const seriesValues = []
    const yValues = []
    for (const series of scene.series) {
      const points = []
      for (let index = 0; index < scene.samples; index += 1) {
        const x = scene.xMin + ((scene.xMax - scene.xMin) * index) / Math.max(1, scene.samples - 1)
        const y = evaluate(series.expression, { ...state, x })
        if (Number.isFinite(y)) {
          points.push({ x, y })
          yValues.push(y)
        }
      }
      seriesValues.push({ series, points })
    }
    const rawMin = yValues.length ? Math.min(...yValues) : -1
    const rawMax = yValues.length ? Math.max(...yValues) : 1
    const padding = Math.max(1e-6, (rawMax - rawMin) * 0.12)
    const yMin = rawMin === rawMax ? rawMin - 1 : rawMin - padding
    const yMax = rawMin === rawMax ? rawMax + 1 : rawMax + padding
    const sx = (x) => margin.left + ((x - scene.xMin) / (scene.xMax - scene.xMin)) * width
    const sy = (y) => margin.top + height - ((y - yMin) / (yMax - yMin)) * height
    for (let index = 0; index <= 4; index += 1) {
      const y = margin.top + (height * index) / 4
      svg.appendChild(svgElement("line", { x1: margin.left, y1: y, x2: margin.left + width, y2: y, class: "gv-grid" }))
      const yTick = svgElement("text", { x: margin.left - 8, y: y + 5, class: "gv-tick", "text-anchor": "end" })
      yTick.textContent = format(yMax - ((yMax - yMin) * index) / 4, 2)
      svg.appendChild(yTick)
      const x = margin.left + (width * index) / 4
      const xTick = svgElement("text", { x, y: margin.top + height + 22, class: "gv-tick", "text-anchor": "middle" })
      xTick.textContent = format(scene.xMin + ((scene.xMax - scene.xMin) * index) / 4, 2)
      svg.appendChild(xTick)
    }
    svg.appendChild(svgElement("line", { x1: margin.left, y1: margin.top + height, x2: margin.left + width, y2: margin.top + height, class: "gv-axis" }))
    svg.appendChild(svgElement("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + height, class: "gv-axis" }))
    const palette = ["#2f7d55", "#3b82f6", "#d97706", "#8b5cf6", "#dc2626", "#0891b2"]
    seriesValues.forEach(({ series, points }, index) => {
      const polyline = svgElement("polyline", {
        points: points.map((point) => `${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`).join(" "),
        class: "gv-line",
        stroke: series.color || palette[index % palette.length],
      })
      const title = svgElement("title")
      title.textContent = series.label
      polyline.appendChild(title)
      svg.appendChild(polyline)
    })
    ;(scene.markers || []).forEach((marker) => {
      const x = evaluate(marker.x, state)
      const y = evaluate(marker.y, state)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < scene.xMin || x > scene.xMax) return
      const circle = svgElement("circle", { cx: sx(x), cy: sy(y), r: 7, fill: marker.color || "#dc2626", stroke: "var(--bg)", "stroke-width": 3 })
      const title = svgElement("title")
      title.textContent = `${marker.label}: ${format(x, 2)}, ${format(y, 2)}`
      circle.appendChild(title)
      svg.appendChild(circle)
    })
    const xLabel = svgElement("text", { x: margin.left + width / 2, y: 330, class: "gv-label" })
    xLabel.textContent = scene.xLabel
    svg.appendChild(xLabel)
    const yLabel = svgElement("text", { x: 13, y: margin.top + height / 2, class: "gv-label", transform: `rotate(-90 13 ${margin.top + height / 2})` })
    yLabel.textContent = scene.yLabel
    svg.appendChild(yLabel)
    host.appendChild(svg)
    return host
  }

  const renderDiagram = (scene, state) => {
    const host = element("section", "gv-scene")
    host.appendChild(element("h3", undefined, scene.title))
    const svg = svgElement("svg", { viewBox: "0 0 640 360", class: "gv-svg", role: "img", "aria-label": scene.title })
    const markerId = `gv-arrow-${diagramCounter += 1}`
    const defs = svgElement("defs")
    const marker = svgElement("marker", {
      id: markerId,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    })
    marker.appendChild(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--muted)" }))
    defs.appendChild(marker)
    svg.appendChild(defs)
    const renderedNodes = scene.nodes.map((node) => ({
      ...node,
      x: Math.max(72, Math.min(568, finite(node.x, 320))),
      y: Math.max(48, Math.min(312, finite(node.y, 180))),
    }))
    const nodes = new Map(renderedNodes.map((node) => [node.id, node]))
    for (const edge of scene.edges) {
      const from = nodes.get(edge.from)
      const to = nodes.get(edge.to)
      if (!from || !to) continue
      const strength = edge.strength ? Math.max(0.5, Math.min(6, Math.abs(evaluate(edge.strength, state)))) : 1.5
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.max(1, Math.hypot(dx, dy))
      const startInset = from.shape === "rect" ? 48 : 32
      const endInset = to.shape === "rect" ? 52 : 38
      svg.appendChild(svgElement("line", {
        x1: from.x + (dx / length) * startInset,
        y1: from.y + (dy / length) * startInset,
        x2: to.x - (dx / length) * endInset,
        y2: to.y - (dy / length) * endInset,
        class: "gv-edge",
        "stroke-width": strength,
        ...(edge.directed ? { "marker-end": `url(#${markerId})` } : {}),
      }))
      if (edge.label) {
        const label = svgElement("text", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 6, class: "gv-label" })
        label.textContent = edge.label
        svg.appendChild(label)
      }
    }
    for (const node of renderedNodes) {
      if (node.shape === "rect") svg.appendChild(svgElement("rect", { x: node.x - 48, y: node.y - 25, width: 96, height: 50, rx: 9, class: "gv-node" }))
      else svg.appendChild(svgElement("circle", { cx: node.x, cy: node.y, r: 32, class: "gv-node" }))
      const value = node.value ? ` ${format(evaluate(node.value, state), 2)}` : ""
      const words = `${node.label}${value}`.trim().split(/\s+/)
      const lines = []
      for (const word of words) {
        const current = lines[lines.length - 1]
        if (!current || `${current} ${word}`.length > 14) lines.push(word)
        else lines[lines.length - 1] = `${current} ${word}`
      }
      const label = svgElement("text", {
        x: node.x,
        y: node.y - ((lines.length - 1) * 8) + 4,
        class: "gv-label gv-node-label",
      })
      lines.slice(0, 3).forEach((line, index) => {
        const span = svgElement("tspan", { x: node.x, dy: index === 0 ? 0 : 16 })
        span.textContent = line
        label.appendChild(span)
      })
      svg.appendChild(label)
    }
    host.appendChild(svg)
    return host
  }

  const spatialPalette = {
    green: "var(--spatial-green)",
    blue: "var(--spatial-blue)",
    amber: "var(--spatial-amber)",
    violet: "var(--spatial-violet)",
    red: "var(--spatial-red)",
    cyan: "var(--spatial-cyan)",
    gray: "var(--spatial-gray)",
  }
  const spatialColorCycle = ["green", "blue", "amber", "violet", "red", "cyan", "gray"]
  const spatialPatternCycle = ["striped", "dotted", "crosshatch", "solid"]
  const spatialKindSymbol = { plane: "▱", polygon: "⬠", sphere: "○", cylinder: "▭", cone: "△", point: "●", vector: "→" }
  const spatialMaximum = 1000000

  const spatialScalar = (value, state, minimum = -spatialMaximum, maximum = spatialMaximum) => {
    const evaluated = value && typeof value === "object" ? evaluate(value, state) : Number(value)
    if (!Number.isFinite(evaluated)) return Number.NaN
    return Math.max(minimum, Math.min(maximum, evaluated))
  }

  const spatialPositiveScalar = (value, state, maximum = spatialMaximum) => {
    const evaluated = spatialScalar(value, state, -maximum, maximum)
    if (!Number.isFinite(evaluated) || evaluated <= 0) return Number.NaN
    return Math.min(maximum, evaluated)
  }

  const spatialVector = (value, state) => {
    if (!Array.isArray(value) || value.length !== 3) return null
    const vector = value.map((component) => spatialScalar(component, state))
    return vector.every(Number.isFinite) ? vector : null
  }

  const spatialAdd = (left, right) => left.map((value, index) => value + right[index])
  const spatialSubtract = (left, right) => left.map((value, index) => value - right[index])
  const spatialScale = (vector, scale) => vector.map((value) => value * scale)
  const spatialDot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0)
  const spatialCross = (left, right) => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
  const spatialNormalize = (vector) => {
    const length = Math.hypot(...vector)
    return Number.isFinite(length) && length > 1e-9 ? spatialScale(vector, 1 / length) : null
  }
  const spatialBasis = (axis) => {
    const normal = spatialNormalize(axis)
    if (!normal) return null
    const reference = Math.abs(normal[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0]
    const first = spatialNormalize(spatialCross(normal, reference))
    const second = first ? spatialNormalize(spatialCross(normal, first)) : null
    return first && second ? { normal, first, second } : null
  }
  const spatialRing = (center, axis, radius, samples = 28) => {
    const basis = spatialBasis(axis)
    if (!basis) return []
    return Array.from({ length: samples }, (_, index) => {
      const angle = (Math.PI * 2 * index) / samples
      return spatialAdd(
        center,
        spatialAdd(
          spatialScale(basis.first, radius * Math.cos(angle)),
          spatialScale(basis.second, radius * Math.sin(angle)),
        ),
      )
    })
  }
  const spatialPolylinePoints = (points) => `${points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ")} ${points.length ? `${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}` : ""}`.trim()
  const spatialConvexHull = (points) => {
    const sorted = [...points]
      .filter((point) => point.every(Number.isFinite))
      .sort((left, right) => left[0] - right[0] || left[1] - right[1])
    if (sorted.length <= 2) return sorted
    const cross = (origin, left, right) =>
      (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0])
    const lower = []
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
      lower.push(point)
    }
    const upper = []
    for (const point of [...sorted].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
      upper.push(point)
    }
    lower.pop()
    upper.pop()
    return [...lower, ...upper]
  }

  const spatialPolygonIsValid = (points) => {
    if (!Array.isArray(points) || points.length < 3 || points.length > 12) return false
    const scale = Math.max(1, ...points.flatMap((point) => point.map(Math.abs)))
    const tolerance = Math.max(1e-7, scale * 1e-9)
    for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
        if (Math.hypot(...spatialSubtract(points[leftIndex], points[rightIndex])) <= tolerance) return false
      }
    }
    const origin = points[0]
    const firstEdge = points.slice(1).map((point) => spatialSubtract(point, origin)).find((edge) => Math.hypot(...edge) > tolerance)
    if (!firstEdge) return false
    const firstLength = Math.hypot(...firstEdge)
    const normal = points
      .slice(1)
      .map((point) => spatialCross(firstEdge, spatialSubtract(point, origin)))
      .find((candidate) => Math.hypot(...candidate) / firstLength > tolerance)
    const unitNormal = normal ? spatialNormalize(normal) : null
    if (!unitNormal) return false
    if (points.some((point) => Math.abs(spatialDot(spatialSubtract(point, origin), unitNormal)) > tolerance)) return false
    const dominantAxis = unitNormal
      .map((component, index) => ({ index, magnitude: Math.abs(component) }))
      .sort((left, right) => right.magnitude - left.magnitude)[0].index
    const projected = points.map((point) => point.filter((_, index) => index !== dominantAxis))
    const projectedScale = Math.max(1, ...projected.flatMap((point) => point.map(Math.abs)))
    const areaTolerance = tolerance * projectedScale
    const orientation = (first, second, third) =>
      (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
    const onSegment = (first, second, point) =>
      point[0] >= Math.min(first[0], second[0]) - tolerance
      && point[0] <= Math.max(first[0], second[0]) + tolerance
      && point[1] >= Math.min(first[1], second[1]) - tolerance
      && point[1] <= Math.max(first[1], second[1]) + tolerance
    const intersects = (firstStart, firstEnd, secondStart, secondEnd) => {
      const a = orientation(firstStart, firstEnd, secondStart)
      const b = orientation(firstStart, firstEnd, secondEnd)
      const c = orientation(secondStart, secondEnd, firstStart)
      const d = orientation(secondStart, secondEnd, firstEnd)
      if (
        (Math.abs(a) <= areaTolerance && onSegment(firstStart, firstEnd, secondStart))
        || (Math.abs(b) <= areaTolerance && onSegment(firstStart, firstEnd, secondEnd))
        || (Math.abs(c) <= areaTolerance && onSegment(secondStart, secondEnd, firstStart))
        || (Math.abs(d) <= areaTolerance && onSegment(secondStart, secondEnd, firstEnd))
      ) return true
      return (a > areaTolerance) !== (b > areaTolerance) && (c > areaTolerance) !== (d > areaTolerance)
    }
    for (let firstIndex = 0; firstIndex < projected.length; firstIndex += 1) {
      const firstNext = (firstIndex + 1) % projected.length
      for (let secondIndex = firstIndex + 1; secondIndex < projected.length; secondIndex += 1) {
        const secondNext = (secondIndex + 1) % projected.length
        if (firstIndex === secondNext || firstNext === secondIndex || firstNext === secondNext) continue
        if (intersects(projected[firstIndex], projected[firstNext], projected[secondIndex], projected[secondNext])) return false
      }
    }
    return true
  }

  const spatialBoxOverlapArea = (box, candidate, padding = 0) => {
    const overlapWidth = Math.max(0, Math.min(box.right, candidate.right) - Math.max(box.left, candidate.left) + padding)
    const overlapHeight = Math.max(0, Math.min(box.bottom, candidate.bottom) - Math.max(box.top, candidate.top) + padding)
    return overlapWidth * overlapHeight
  }

  const placeSpatialLabel = (anchor, fullLabel, occupied, geometryBoxes) => {
    const displayLabel = fullLabel.length > 32 ? `${fullLabel.slice(0, 29)}...` : fullLabel
    const width = Math.max(52, Math.min(250, displayLabel.length * 8.5))
    const height = 21
    const offsets = [[0, -24]]
    for (let radius = 32; radius <= 192; radius += 32) {
      for (let index = 0; index < 12; index += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 12
        offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
      }
    }
    let best = null
    offsets.forEach(([dx, dy], order) => {
      const x = Math.max(width / 2 + 8, Math.min(640 - width / 2 - 8, anchor[0] + dx))
      const y = Math.max(20, Math.min(390, anchor[1] + dy))
      const box = { left: x - width / 2, right: x + width / 2, top: y - 16, bottom: y + 5 }
      const overlap = occupied.reduce((total, candidate) => total + spatialBoxOverlapArea(box, candidate, 5), 0)
      const geometryOverlap = geometryBoxes.reduce(
        (total, candidate) => total + spatialBoxOverlapArea(box, candidate, 4),
        0,
      )
      const distance = Math.hypot(x - anchor[0], y - anchor[1])
      const score = overlap * 100000 + geometryOverlap * 100 + distance + order * 0.001
      if (!best || score < best.score) best = { x, y, box, score, displayLabel, distance, geometryOverlap }
    })
    occupied.push(best.box)
    return best
  }

  const spatialAuthoredDomainStates = (controls, currentState) => {
    const tValues = [0, 0.25, 0.5, 0.75, 1]
    const states = tValues.map((t) => ({ ...currentState, t }))
    ;(controls || []).forEach((control) => {
      let values = []
      if (control.type === "select") {
        values = Array.from({ length: (control.options || []).length }, (_, index) => index)
      } else if (control.type === "toggle") {
        values = [0, 1]
      } else if (control.type === "slider" || control.type === "number") {
        values = [control.min, control.defaultValue, control.max, currentState[control.id]]
      } else {
        values = [control.defaultValue, currentState[control.id], finite(currentState[control.id]) + 1]
      }
      ;[...new Set(values.filter((value) => Number.isFinite(Number(value))).map(Number))].forEach((value) => {
        tValues.forEach((t) => states.push({ ...currentState, [control.id]: value, t }))
      })
    })
    return states
  }

  const resolveSpatialPrimitive = (primitive, group, state, index, ignoreVisibility = false) => {
    const primitiveVisibility = primitive.visibleWhen ? evaluate(primitive.visibleWhen, state) : 1
    if (!ignoreVisibility && (!Number.isFinite(primitiveVisibility) || primitiveVisibility <= 0)) return null
    const opacityValue = primitive.opacity === undefined ? 0.32 : Number(primitive.opacity)
    const common = {
      id: primitive.id,
      kind: primitive.kind,
      label: primitive.label,
      groupLabel: group.label,
      color: spatialPalette[primitive.color] || spatialPalette[spatialColorCycle[index % spatialColorCycle.length]],
      pattern: primitive.pattern || spatialPatternCycle[index % spatialPatternCycle.length],
      opacity: Number.isFinite(opacityValue) ? Math.max(0.1, Math.min(1, opacityValue)) : 0.32,
    }
    if (primitive.kind === "plane") {
      const center = spatialVector(primitive.center, state)
      const normal = spatialVector(primitive.normal, state)
      const size = spatialPositiveScalar(primitive.size, state)
      const basis = normal ? spatialBasis(normal) : null
      if (!center || !basis || !Number.isFinite(size)) return null
      const half = size / 2
      const corners = [
        spatialAdd(center, spatialAdd(spatialScale(basis.first, half), spatialScale(basis.second, half))),
        spatialAdd(center, spatialAdd(spatialScale(basis.first, -half), spatialScale(basis.second, half))),
        spatialAdd(center, spatialAdd(spatialScale(basis.first, -half), spatialScale(basis.second, -half))),
        spatialAdd(center, spatialAdd(spatialScale(basis.first, half), spatialScale(basis.second, -half))),
      ]
      return { ...common, center, normal: basis.normal, corners, worldPoints: corners, anchor: center }
    }
    if (primitive.kind === "polygon") {
      const points = Array.isArray(primitive.points) ? primitive.points.map((point) => spatialVector(point, state)) : []
      if (points.some((point) => !point) || !spatialPolygonIsValid(points)) return null
      const anchor = points[0].map((_, coordinateIndex) =>
        points.reduce((sum, point) => sum + point[coordinateIndex], 0) / points.length)
      return { ...common, points, worldPoints: points, anchor }
    }
    if (primitive.kind === "sphere") {
      const center = spatialVector(primitive.center, state)
      const radius = spatialPositiveScalar(primitive.radius, state)
      if (!center || !Number.isFinite(radius)) return null
      return { ...common, center, radius, worldPoints: [center], anchor: center }
    }
    if (primitive.kind === "cylinder") {
      const center = spatialVector(primitive.center, state)
      const axisValue = spatialVector(primitive.axis, state)
      const axis = axisValue ? spatialNormalize(axisValue) : null
      const radius = spatialPositiveScalar(primitive.radius, state)
      const height = spatialPositiveScalar(primitive.height, state)
      if (!center || !axis || !Number.isFinite(radius) || !Number.isFinite(height)) return null
      const firstCenter = spatialAdd(center, spatialScale(axis, -height / 2))
      const secondCenter = spatialAdd(center, spatialScale(axis, height / 2))
      const firstRing = spatialRing(firstCenter, axis, radius)
      const secondRing = spatialRing(secondCenter, axis, radius)
      if (!firstRing.length || !secondRing.length) return null
      return { ...common, center, axis, radius, height, firstRing, secondRing, worldPoints: [...firstRing, ...secondRing], anchor: center }
    }
    if (primitive.kind === "cone") {
      const apex = spatialVector(primitive.apex, state)
      const axisValue = spatialVector(primitive.axis, state)
      const axis = axisValue ? spatialNormalize(axisValue) : null
      const radius = spatialPositiveScalar(primitive.radius, state)
      const height = spatialPositiveScalar(primitive.height, state)
      if (!apex || !axis || !Number.isFinite(radius) || !Number.isFinite(height)) return null
      const baseCenter = spatialAdd(apex, spatialScale(axis, height))
      const baseRing = spatialRing(baseCenter, axis, radius)
      if (!baseRing.length) return null
      return { ...common, apex, axis, radius, height, baseCenter, baseRing, worldPoints: [apex, ...baseRing], anchor: spatialAdd(apex, spatialScale(axis, height / 2)) }
    }
    if (primitive.kind === "point") {
      const position = spatialVector(primitive.position, state)
      const size = primitive.size === undefined ? 7 : spatialPositiveScalar(primitive.size, state, 40)
      if (!position || !Number.isFinite(size)) return null
      return { ...common, position, size: Math.max(3, Math.min(18, size)), worldPoints: [position], anchor: position }
    }
    const from = spatialVector(primitive.from, state)
    const to = spatialVector(primitive.to, state)
    const headSize = primitive.headSize === undefined ? 8 : spatialPositiveScalar(primitive.headSize, state, 40)
    if (!from || !to || !Number.isFinite(headSize) || Math.hypot(...spatialSubtract(to, from)) <= 1e-9) return null
    return { ...common, from, to, headSize: Math.max(4, Math.min(16, headSize)), worldPoints: [from, to], anchor: spatialScale(spatialAdd(from, to), 0.5) }
  }

  const renderSpatial = (scene, state, controls) => {
    const host = element("section", "gv-scene")
    host.dataset.spatialHost = "true"
    const sceneNumber = spatialCounter += 1
    const headingId = `gv-spatial-heading-${sceneNumber}`
    const descriptionId = `gv-spatial-description-${sceneNumber}`
    const heading = element("h3", undefined, scene.title)
    heading.id = headingId
    host.appendChild(heading)
    const svg = svgElement("svg", {
      viewBox: "0 0 640 400",
      class: "gv-svg",
      role: "img",
      "aria-labelledby": `${headingId} ${descriptionId}`,
      "data-spatial-scene": scene.title,
      "data-spatial-projection": "orthographic",
    })
    const title = svgElement("title")
    title.textContent = scene.title
    svg.appendChild(title)
    const description = svgElement("desc", { id: descriptionId })
    svg.appendChild(description)
    const defs = svgElement("defs")
    svg.appendChild(defs)

    const resolved = []
    let primitiveIndex = 0
    ;(scene.groups || []).forEach((group) => {
      const groupVisibility = group.visibleWhen ? evaluate(group.visibleWhen, state) : 1
      const groupIsVisible = Number.isFinite(groupVisibility) && groupVisibility > 0
      ;(group.primitives || []).forEach((primitive) => {
        const object = resolveSpatialPrimitive(primitive, group, state, primitiveIndex, true)
        primitiveIndex += 1
        if (!object) return
        const primitiveVisibility = primitive.visibleWhen ? evaluate(primitive.visibleWhen, state) : 1
        if (groupIsVisible && Number.isFinite(primitiveVisibility) && primitiveVisibility > 0) resolved.push(object)
      })
    })

    const azimuth = Math.max(-180, Math.min(180, finite(scene.view && scene.view.azimuthDegrees, 35))) * Math.PI / 180
    const elevation = Math.max(-85, Math.min(85, finite(scene.view && scene.view.elevationDegrees, 24))) * Math.PI / 180
    const viewScale = Math.max(0.25, Math.min(2, finite(scene.view && scene.view.scale, 1)))
    const right = [-Math.sin(azimuth), Math.cos(azimuth), 0]
    const up = [-Math.cos(azimuth) * Math.sin(elevation), -Math.sin(azimuth) * Math.sin(elevation), Math.cos(elevation)]
    const forward = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation)]
    const projectRaw = (point) => [spatialDot(point, right), spatialDot(point, up), spatialDot(point, forward)]
    const includeObjectInBounds = (bounds, object) => {
      object.worldPoints.forEach((point) => {
        const projected = projectRaw(point)
        bounds.xMin = Math.min(bounds.xMin, projected[0])
        bounds.xMax = Math.max(bounds.xMax, projected[0])
        bounds.yMin = Math.min(bounds.yMin, projected[1])
        bounds.yMax = Math.max(bounds.yMax, projected[1])
      })
      if (object.kind === "sphere") {
        const center = projectRaw(object.center)
        bounds.xMin = Math.min(bounds.xMin, center[0] - object.radius)
        bounds.xMax = Math.max(bounds.xMax, center[0] + object.radius)
        bounds.yMin = Math.min(bounds.yMin, center[1] - object.radius)
        bounds.yMax = Math.max(bounds.yMax, center[1] + object.radius)
      }
    }
    let authoredBounds = spatialBoundsCache.get(scene)
    if (!authoredBounds) {
      authoredBounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity }
      spatialAuthoredDomainStates(controls, state).forEach((sampleState) => {
        let samplePrimitiveIndex = 0
        ;(scene.groups || []).forEach((group) => {
          ;(group.primitives || []).forEach((primitive) => {
            const object = resolveSpatialPrimitive(primitive, group, sampleState, samplePrimitiveIndex, true)
            samplePrimitiveIndex += 1
            if (object) includeObjectInBounds(authoredBounds, object)
          })
        })
      })
      if (![authoredBounds.xMin, authoredBounds.xMax, authoredBounds.yMin, authoredBounds.yMax].every(Number.isFinite)) {
        resolved.forEach((object) => includeObjectInBounds(authoredBounds, object))
      }
      spatialBoundsCache.set(scene, authoredBounds)
    }
    const xMin = Number.isFinite(authoredBounds.xMin) ? authoredBounds.xMin : -1
    const xMax = Number.isFinite(authoredBounds.xMax) ? authoredBounds.xMax : 1
    const yMin = Number.isFinite(authoredBounds.yMin) ? authoredBounds.yMin : -1
    const yMax = Number.isFinite(authoredBounds.yMax) ? authoredBounds.yMax : 1
    const spanX = Math.max(1e-6, xMax - xMin)
    const spanY = Math.max(1e-6, yMax - yMin)
    const fitScale = Math.min(520 / spanX, 300 / spanY) * viewScale
    const rawCenter = [(xMin + xMax) / 2, (yMin + yMax) / 2]
    svg.dataset.spatialCameraBounds = [xMin, xMax, yMin, yMax].map((value) => value.toFixed(6)).join(",")
    const project = (point) => {
      const raw = projectRaw(point)
      return [320 + (raw[0] - rawCenter[0]) * fitScale, 200 - (raw[1] - rawCenter[1]) * fitScale, raw[2]]
    }
    const projectedGeometryBox = (object) => {
      if (object.kind === "sphere") {
        const center = project(object.center)
        const radius = object.radius * fitScale
        return { left: center[0] - radius, right: center[0] + radius, top: center[1] - radius, bottom: center[1] + radius }
      }
      const points = object.worldPoints.map(project)
      if (!points.length) return { left: 0, right: 0, top: 0, bottom: 0 }
      const padding = object.kind === "point"
        ? object.size + 5
        : object.kind === "vector"
          ? object.headSize + 4
          : 3
      return {
        left: Math.min(...points.map((point) => point[0])) - padding,
        right: Math.max(...points.map((point) => point[0])) + padding,
        top: Math.min(...points.map((point) => point[1])) - padding,
        bottom: Math.max(...points.map((point) => point[1])) + padding,
      }
    }
    const geometryBoxById = new Map(resolved.map((object) => [object.id, projectedGeometryBox(object)]))
    const geometryBoxes = [...geometryBoxById.values()]
    const dashFor = (pattern) => pattern === "striped" ? "10 4" : pattern === "dotted" ? "2 5" : pattern === "crosshatch" ? "8 3 2 3" : undefined
    const surfaceFill = (object) => {
      if (object.pattern === "solid") return object.color
      const patternId = `gv-spatial-pattern-${sceneNumber}-${object.id}`
      const pattern = svgElement("pattern", { id: patternId, patternUnits: "userSpaceOnUse", width: 12, height: 12 })
      pattern.appendChild(svgElement("rect", { width: 12, height: 12, fill: object.color, "fill-opacity": object.opacity * 0.35 }))
      if (object.pattern === "dotted") {
        pattern.appendChild(svgElement("circle", { cx: 3, cy: 3, r: 1.6, fill: object.color, "fill-opacity": Math.min(1, object.opacity + 0.35) }))
        pattern.appendChild(svgElement("circle", { cx: 9, cy: 9, r: 1.6, fill: object.color, "fill-opacity": Math.min(1, object.opacity + 0.35) }))
      } else {
        pattern.appendChild(svgElement("path", { d: "M -3 3 L 3 -3 M 0 12 L 12 0 M 9 15 L 15 9", stroke: object.color, "stroke-width": 1.5, "stroke-opacity": Math.min(1, object.opacity + 0.35) }))
        if (object.pattern === "crosshatch") {
          pattern.appendChild(svgElement("path", { d: "M -3 9 L 3 15 M 0 0 L 12 12 M 9 -3 L 15 3", stroke: object.color, "stroke-width": 1.5, "stroke-opacity": Math.min(1, object.opacity + 0.35) }))
        }
      }
      defs.appendChild(pattern)
      return `url(#${patternId})`
    }
    const addObjectTitle = (container, object) => {
      const objectTitle = svgElement("title")
      objectTitle.textContent = `${object.groupLabel}: ${object.label} (${object.kind}, ${object.pattern})`
      container.appendChild(objectTitle)
    }
    const addSurface = (container, tag, attributes, object) => {
      const surface = svgElement(tag, {
        ...attributes,
        class: "gv-spatial-surface",
        fill: surfaceFill(object),
        "fill-opacity": object.pattern === "solid" ? object.opacity : 1,
        stroke: object.color,
        opacity: object.opacity === 1 ? 1 : Math.max(0.55, object.opacity),
      })
      container.appendChild(surface)
      return surface
    }
    const addLine = (container, tag, attributes, object) => {
      const dash = dashFor(object.pattern)
      const line = svgElement(tag, {
        ...attributes,
        class: "gv-spatial-line",
        stroke: object.color,
        opacity: Math.max(0.7, object.opacity),
        ...(dash ? { "stroke-dasharray": dash } : {}),
      })
      container.appendChild(line)
      return line
    }

    const labelRequests = []
    resolved
      .sort((left, rightObject) => projectRaw(left.anchor)[2] - projectRaw(rightObject.anchor)[2])
      .forEach((object) => {
        const objectGroup = svgElement("g", {
          class: "gv-spatial-object",
          role: "img",
          tabindex: "0",
          "aria-label": `${object.groupLabel}: ${object.label}, ${object.kind}, ${object.pattern} pattern`,
          "data-spatial-id": object.id,
          "data-spatial-kind": object.kind,
          "data-spatial-pattern": object.pattern,
        })
        const projectedAnchor = project(object.anchor)
        const geometryBox = geometryBoxById.get(object.id)
        objectGroup.dataset.spatialAnchorX = projectedAnchor[0].toFixed(3)
        objectGroup.dataset.spatialAnchorY = projectedAnchor[1].toFixed(3)
        if (geometryBox) {
          objectGroup.dataset.spatialGeometryLeft = geometryBox.left.toFixed(2)
          objectGroup.dataset.spatialGeometryRight = geometryBox.right.toFixed(2)
          objectGroup.dataset.spatialGeometryTop = geometryBox.top.toFixed(2)
          objectGroup.dataset.spatialGeometryBottom = geometryBox.bottom.toFixed(2)
        }
        addObjectTitle(objectGroup, object)
        if (object.kind === "plane") {
          const corners = object.corners.map(project)
          addSurface(objectGroup, "polygon", { points: corners.map((point) => `${point[0]},${point[1]}`).join(" ") }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(corners) }, object)
        } else if (object.kind === "polygon") {
          const points = object.points.map(project)
          addSurface(objectGroup, "polygon", { points: points.map((point) => `${point[0]},${point[1]}`).join(" ") }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(points) }, object)
        } else if (object.kind === "sphere") {
          const center = project(object.center)
          const radius = object.radius * fitScale
          addSurface(objectGroup, "circle", { cx: center[0], cy: center[1], r: radius }, object)
          const circles = [
            spatialRing(object.center, [0, 0, 1], object.radius),
            spatialRing(object.center, [0, 1, 0], object.radius),
            spatialRing(object.center, [1, 0, 0], object.radius),
          ]
          circles.forEach((circle) => addLine(objectGroup, "polyline", { points: spatialPolylinePoints(circle.map(project)) }, object))
        } else if (object.kind === "cylinder") {
          const firstRing = object.firstRing.map(project)
          const secondRing = object.secondRing.map(project)
          const hull = spatialConvexHull([...firstRing, ...secondRing])
          addSurface(objectGroup, "polygon", { points: hull.map((point) => `${point[0]},${point[1]}`).join(" ") }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(firstRing) }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(secondRing) }, object)
          ;[0, 7, 14, 21].forEach((index) => addLine(objectGroup, "line", {
            x1: firstRing[index][0], y1: firstRing[index][1], x2: secondRing[index][0], y2: secondRing[index][1],
          }, object))
        } else if (object.kind === "cone") {
          const apex = project(object.apex)
          const baseRing = object.baseRing.map(project)
          const hull = spatialConvexHull([apex, ...baseRing])
          addSurface(objectGroup, "polygon", { points: hull.map((point) => `${point[0]},${point[1]}`).join(" ") }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(baseRing) }, object)
          ;[0, 7, 14, 21].forEach((index) => addLine(objectGroup, "line", {
            x1: apex[0], y1: apex[1], x2: baseRing[index][0], y2: baseRing[index][1],
          }, object))
        } else if (object.kind === "point") {
          const position = project(object.position)
          objectGroup.appendChild(svgElement("circle", { cx: position[0], cy: position[1], r: object.size, fill: object.color, stroke: "var(--bg)", "stroke-width": 3 }))
          addLine(objectGroup, "line", { x1: position[0] - object.size - 4, y1: position[1], x2: position[0] + object.size + 4, y2: position[1] }, object)
          addLine(objectGroup, "line", { x1: position[0], y1: position[1] - object.size - 4, x2: position[0], y2: position[1] + object.size + 4 }, object)
        } else {
          const from = project(object.from)
          const to = project(object.to)
          const markerId = `gv-spatial-arrow-${sceneNumber}-${object.id}`
          const marker = svgElement("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: object.headSize, markerHeight: object.headSize, orient: "auto" })
          marker.appendChild(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: object.color }))
          defs.appendChild(marker)
          addLine(objectGroup, "line", { x1: from[0], y1: from[1], x2: to[0], y2: to[1], "marker-end": `url(#${markerId})` }, object)
          objectGroup.appendChild(svgElement("circle", { cx: from[0], cy: from[1], r: 3, fill: object.color }))
        }
        labelRequests.push({ object, anchor: projectedAnchor })
        svg.appendChild(objectGroup)
      })

    const occupiedLabelBoxes = []
    const labelsLayer = svgElement("g", { "aria-hidden": "true" })
    labelRequests.forEach(({ object, anchor }) => {
      const placement = placeSpatialLabel(anchor, object.label, occupiedLabelBoxes, geometryBoxes)
      if (placement.distance > 26) {
        labelsLayer.appendChild(svgElement("line", {
          x1: anchor[0],
          y1: anchor[1],
          x2: placement.x,
          y2: placement.y - 7,
          class: "gv-spatial-leader",
        }))
      }
      const label = svgElement("text", {
        x: placement.x,
        y: placement.y,
        class: "gv-spatial-label",
        "data-spatial-label-for": object.id,
        "data-spatial-label-left": placement.box.left.toFixed(2),
        "data-spatial-label-right": placement.box.right.toFixed(2),
        "data-spatial-label-top": placement.box.top.toFixed(2),
        "data-spatial-label-bottom": placement.box.bottom.toFixed(2),
        "data-spatial-label-geometry-overlap": placement.geometryOverlap.toFixed(2),
      })
      label.textContent = placement.displayLabel
      const fullLabel = svgElement("title")
      fullLabel.textContent = object.label
      label.appendChild(fullLabel)
      labelsLayer.appendChild(label)
    })
    svg.appendChild(labelsLayer)

    description.textContent = resolved.length
      ? `Orthographic spatial projection. ${resolved.map((object) => `${object.groupLabel}: ${object.label}, ${object.kind}, ${object.pattern} pattern`).join("; ")}.`
      : "Orthographic spatial projection with no valid visible primitives in the current state."
    host.appendChild(svg)
    const legend = element("ul", "gv-spatial-legend")
    legend.setAttribute("aria-label", `${scene.title} legend`)
    resolved.forEach((object) => {
      const item = element("li")
      item.dataset.spatialLegendId = object.id
      const symbol = element("span", "gv-spatial-symbol", spatialKindSymbol[object.kind] || "◆")
      symbol.style.setProperty("--spatial-color", object.color)
      symbol.setAttribute("aria-hidden", "true")
      item.appendChild(symbol)
      item.appendChild(element("span", undefined, `${object.groupLabel}: ${object.label} — ${object.kind}, ${object.pattern}`))
      legend.appendChild(item)
    })
    host.appendChild(legend)
    return host
  }

  const renderTimeline = (scene, state) => {
    const host = element("section", "gv-scene")
    host.appendChild(element("h3", undefined, scene.title))
    const list = element("ol", "gv-timeline")
    const progress = finite(state[scene.progressInput])
    scene.steps.forEach((step) => {
      const item = element("li")
      item.dataset.active = String(progress >= step.at)
      item.appendChild(element("strong", undefined, step.label))
      item.appendChild(element("p", undefined, step.description))
      list.appendChild(item)
    })
    host.appendChild(list)
    return host
  }

  const renderTable = (scene, state) => {
    const host = element("section", "gv-scene")
    host.appendChild(element("h3", undefined, scene.title))
    const table = element("table", "gv-table")
    const head = element("tr")
    head.appendChild(element("th", undefined, "Case"))
    scene.columns.forEach((column) => head.appendChild(element("th", undefined, column)))
    const thead = element("thead")
    thead.appendChild(head)
    table.appendChild(thead)
    const tbody = element("tbody")
    scene.rows.forEach((row) => {
      const tr = element("tr")
      tr.appendChild(element("th", undefined, row.label))
      row.values.forEach((value) => {
        const output = value && typeof value === "object" ? format(evaluate(value, state)) : String(value)
        tr.appendChild(element("td", undefined, output))
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    host.appendChild(table)
    return host
  }

  const renderDefinition = (definition, theme) => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"
    installStyles()
    const root = document.getElementById(ROOT_ID) || document.body.appendChild(element("div"))
    root.id = ROOT_ID
    root.replaceChildren()
    const app = element("main", "gv-root")
    app.setAttribute("aria-label", definition.accessibilityDescription)
    const header = element("header", "gv-header")
    header.appendChild(element("h2", undefined, definition.title))
    header.appendChild(element("p", undefined, definition.description))
    header.appendChild(element("p", "gv-sr", definition.accessibilityDescription))
    app.appendChild(header)

    const state = {}
    const defaults = {}
    definition.controls.forEach((control) => {
      const initialValue = control.type === "select"
        ? Math.max(0, (control.options || []).indexOf(String(control.defaultValue)))
        : control.type === "toggle"
          ? (Boolean(control.defaultValue) ? 1 : 0)
          : control.type === "button"
            ? finite(control.defaultValue)
            : control.defaultValue
      state[control.id] = initialValue
      defaults[control.id] = initialValue
    })
    state.x = 0
    state.t = 0
    let playing = false
    let animationFrame = 0
    let animationStarted = 0
    const outputNodes = new Map()
    const scenesHost = element("div", "gv-scenes")
    const valuesHost = element("div", "gv-values")
    valuesHost.setAttribute("aria-live", "polite")
    valuesHost.setAttribute("aria-atomic", "true")

    const outputValue = (output) => (output.expression ? evaluate(output.expression, state) : 0)
    const valueSceneOutputIds = new Set(definition.scenes.filter((scene) => scene.kind === "value").map((scene) => scene.outputId))
    const draw = () => {
      scenesHost.replaceChildren()
      valuesHost.replaceChildren()
      definition.outputs.forEach((output) => {
        if (!output.expression) return
        if (valueSceneOutputIds.has(output.id)) return
        const card = element("div", "gv-value")
        card.appendChild(element("span", undefined, output.label))
        const value = outputValue(output)
        const strong = element("strong", undefined, `${format(value, output.precision)}${output.unit ? ` ${output.unit}` : ""}`)
        strong.dataset.outputId = output.id
        strong.dataset.outputFinite = String(Number.isFinite(value))
        outputNodes.set(output.id, strong)
        card.appendChild(strong)
        valuesHost.appendChild(card)
      })
      definition.scenes.forEach((scene) => {
        if (scene.kind === "plot") scenesHost.appendChild(renderPlot(scene, state))
        else if (scene.kind === "diagram") scenesHost.appendChild(renderDiagram(scene, state))
        else if (scene.kind === "spatial") scenesHost.appendChild(renderSpatial(scene, state, definition.controls))
        else if (scene.kind === "timeline") scenesHost.appendChild(renderTimeline(scene, state))
        else if (scene.kind === "table") scenesHost.appendChild(renderTable(scene, state))
        else if (scene.kind === "value") {
          const output = definition.outputs.find((candidate) => candidate.id === scene.outputId)
          if (output && output.expression) {
            const host = element("section", "gv-scene")
            host.appendChild(element("h3", undefined, output.label))
            host.appendChild(element("strong", undefined, `${format(outputValue(output), output.precision)}${output.unit ? ` ${output.unit}` : ""}`))
            scenesHost.appendChild(host)
          }
        } else if (scene.kind === "annotation" || scene.kind === "formula") {
          if (!scene.visibleWhen || evaluate(scene.visibleWhen, state) > 0) {
            const host = element("section", `gv-scene ${scene.kind === "formula" ? "gv-formula" : ""}`)
            host.appendChild(element("h3", undefined, scene.title))
            host.appendChild(element("p", undefined, scene.text))
            scenesHost.appendChild(host)
          }
        } else if (scene.kind === "animated_marker") {
          const host = element("section", "gv-scene")
          host.appendChild(element("h3", undefined, scene.title))
          const svg = svgElement("svg", { viewBox: "0 0 640 180", class: "gv-svg", role: "img", "aria-label": scene.title })
          const x = Math.max(20, Math.min(620, evaluate(scene.x, state)))
          const y = Math.max(20, Math.min(160, evaluate(scene.y, state)))
          svg.appendChild(svgElement("circle", { cx: x, cy: y, r: 13, class: "gv-node" }))
          const label = svgElement("text", { x, y: y - 20, class: "gv-label" })
          label.textContent = scene.label
          svg.appendChild(label)
          host.appendChild(svg)
          scenesHost.appendChild(host)
        } else if (scene.kind === "status") {
          const value = evaluate(scene.value, state)
          const epsilon = 1e-9
          const label = value < scene.threshold - epsilon
            ? scene.belowLabel
            : value > scene.threshold + epsilon
              ? scene.aboveLabel
              : scene.equalLabel
          const host = element("section", "gv-scene gv-status")
          host.setAttribute("role", "status")
          host.setAttribute("aria-live", "polite")
          host.appendChild(element("h3", undefined, scene.title))
          host.appendChild(element("strong", undefined, label))
          if (scene.description) host.appendChild(element("p", undefined, scene.description))
          scenesHost.appendChild(host)
        }
      })
      document.body.dataset.breadboardOverflow = String(document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    }

    if (definition.controls.length) {
      const controlsHost = element("div", "gv-controls")
      definition.controls.forEach((control) => {
        const row = element("div", "gv-control")
        const head = element("div", "gv-control-head")
        const label = element("label", undefined, control.label)
        const inputId = `gv-control-${control.id}`
        label.htmlFor = inputId
        head.appendChild(label)
        const readout = element("span", "gv-readout", `${control.defaultValue}${control.unit ? ` ${control.unit}` : ""}`)
        readout.dataset.controlReadout = control.id
        head.appendChild(readout)
        row.appendChild(head)
        let input
        if (control.type === "slider" || control.type === "number") {
          input = element("input")
          input.type = control.type === "slider" ? "range" : "number"
          input.min = String(control.min)
          input.max = String(control.max)
          input.step = String(control.step)
          input.value = String(control.defaultValue)
          input.addEventListener("input", () => {
            state[control.id] = finite(input.value)
            readout.textContent = `${input.value}${control.unit ? ` ${control.unit}` : ""}`
            draw()
            parent.postMessage({ type: EVENT, event: "input", controlId: control.id, value: state[control.id] }, "*")
          })
        } else if (control.type === "select") {
          input = element("select")
          ;(control.options || []).forEach((option) => {
            const optionNode = element("option", undefined, option)
            optionNode.value = option
            input.appendChild(optionNode)
          })
          input.value = String(control.defaultValue)
          input.addEventListener("change", () => {
            // Expressions are numeric-only. A select therefore exposes the
            // stable zero-based index of its declared option while the learner
            // continues to see (and accessibility APIs continue to announce)
            // the human-readable option label.
            state[control.id] = input.selectedIndex
            readout.textContent = input.value
            draw()
            parent.postMessage({
              type: EVENT,
              event: "input",
              controlId: control.id,
              value: input.value,
              optionIndex: state[control.id],
            }, "*")
          })
        } else if (control.type === "toggle") {
          input = element("input")
          input.type = "checkbox"
          input.checked = Boolean(control.defaultValue)
          input.addEventListener("change", () => {
            state[control.id] = input.checked
            readout.textContent = input.checked ? "On" : "Off"
            draw()
            parent.postMessage({ type: EVENT, event: "input", controlId: control.id, value: state[control.id] }, "*")
          })
        } else {
          input = element("button", undefined, control.label)
          input.type = "button"
          input.addEventListener("click", () => {
            state[control.id] = finite(state[control.id]) + 1
            draw()
            parent.postMessage({ type: EVENT, event: "button", controlId: control.id, value: state[control.id] }, "*")
          })
        }
        input.id = inputId
        input.dataset.controlId = control.id
        if (control.description) input.setAttribute("aria-description", control.description)
        row.appendChild(input)
        controlsHost.appendChild(row)
      })
      app.appendChild(controlsHost)
    }

    app.appendChild(valuesHost)
    app.appendChild(scenesHost)

    const stopAnimation = () => {
      playing = false
      if (animationFrame) cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }
    if (definition.animation) {
      const animation = element("div", "gv-animation")
      const play = element("button", undefined, "Play")
      const pause = element("button", undefined, "Pause")
      const step = element("button", undefined, "Step")
      const reset = element("button", undefined, "Reset")
      ;[play, pause, step, reset].forEach((button) => { button.type = "button" })
      const tick = (timestamp) => {
        if (!playing) return
        if (!animationStarted) animationStarted = timestamp
        const elapsed = timestamp - animationStarted
        state.t = Math.min(1, elapsed / definition.animation.durationMs)
        draw()
        if (state.t >= 1) {
          if (definition.animation.loop) animationStarted = timestamp
          else { stopAnimation(); return }
        }
        animationFrame = requestAnimationFrame(tick)
      }
      play.addEventListener("click", () => {
        if (playing) return
        playing = true
        animationStarted = 0
        animationFrame = requestAnimationFrame(tick)
      })
      pause.addEventListener("click", stopAnimation)
      step.addEventListener("click", () => { state.t = Math.min(1, finite(state.t) + 0.05); draw() })
      reset.addEventListener("click", () => {
        stopAnimation()
        Object.assign(state, defaults, { x: 0, t: 0 })
        document.querySelectorAll("[data-control-id]").forEach((node) => {
          const control = definition.controls.find((candidate) => candidate.id === node.dataset.controlId)
          if (!control) return
          if (node.type === "checkbox") node.checked = Boolean(control.defaultValue)
          else node.value = String(control.defaultValue)
        })
        document.querySelectorAll("[data-control-readout]").forEach((node) => {
          const control = definition.controls.find((candidate) => candidate.id === node.dataset.controlReadout)
          if (control) node.textContent = `${control.defaultValue}${control.unit ? ` ${control.unit}` : ""}`
        })
        draw()
      })
      animation.append(play, pause, step, reset)
      app.appendChild(animation)
      if (definition.animation.autoplay && !matchMedia("(prefers-reduced-motion: reduce)").matches) play.click()
    } else {
      const reset = element("button", undefined, "Reset")
      reset.type = "button"
      reset.addEventListener("click", () => {
        Object.assign(state, defaults, { x: 0, t: 0 })
        document.querySelectorAll("[data-control-id]").forEach((node) => {
          const control = definition.controls.find((candidate) => candidate.id === node.dataset.controlId)
          if (!control) return
          if (node.type === "checkbox") node.checked = Boolean(control.defaultValue)
          else node.value = String(control.defaultValue)
        })
        document.querySelectorAll("[data-control-readout]").forEach((node) => {
          const control = definition.controls.find((candidate) => candidate.id === node.dataset.controlReadout)
          if (control) node.textContent = `${control.defaultValue}${control.unit ? ` ${control.unit}` : ""}`
        })
        draw()
      })
      const animation = element("div", "gv-animation")
      animation.appendChild(reset)
      app.appendChild(animation)
    }

    root.appendChild(app)
    draw()
    parent.postMessage({ type: EVENT, event: "ready", height: document.documentElement.scrollHeight }, "*")

    if (window.__BREADBOARD_VISUAL_TEST_MODE__) {
      let selfTestsRan = false
      const runSelfTests = () => {
        if (selfTestsRan) return
        selfTestsRan = true
        try {
        let passed = true
        const spatialDomIsValid = () => Array.from(document.querySelectorAll("[data-spatial-host=true]")).every((host) => {
          const svg = host.querySelector("[data-spatial-projection=orthographic]")
          const primitives = host.querySelectorAll("[data-spatial-kind]")
          const legendItems = host.querySelectorAll("[data-spatial-legend-id]")
          const labels = Array.from(host.querySelectorAll("[data-spatial-label-for]"))
          const labelBoxes = labels.map((label) => label.getBBox())
          const labelsDoNotOverlap = labelBoxes.every((box, index) => labelBoxes.slice(index + 1).every((candidate) => {
            const overlapWidth = Math.max(0, Math.min(box.x + box.width, candidate.x + candidate.width) - Math.max(box.x, candidate.x))
            const overlapHeight = Math.max(0, Math.min(box.y + box.height, candidate.y + candidate.height) - Math.max(box.y, candidate.y))
            return overlapWidth * overlapHeight <= 16
          }))
          return Boolean(svg)
            && Boolean(svg.querySelector("desc"))
            && primitives.length > 0
            && legendItems.length === primitives.length
            && labels.length === primitives.length
            && labelsDoNotOverlap
            && Array.from(primitives).every((node) => Boolean(node.getAttribute("aria-label")) && node.getAttribute("tabindex") === "0")
        })
        const first = document.querySelector("[data-control-id]")
        if (first) {
          first.focus()
          if (first.type === "range" || first.type === "number") {
            first.value = first.max || first.value
            first.dispatchEvent(new Event("input", { bubbles: true }))
          } else if (first.type === "checkbox") {
            first.checked = !first.checked
            first.dispatchEvent(new Event("change", { bubbles: true }))
          } else if (first.tagName === "SELECT") {
            first.selectedIndex = Math.min(1, first.options.length - 1)
            first.dispatchEvent(new Event("change", { bubbles: true }))
          } else first.click()
        }
        if (!spatialDomIsValid()) passed = false
        document.querySelectorAll("[data-output-finite]").forEach((node) => {
          if (node.dataset.outputFinite !== "true") passed = false
        })
        const resetButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Reset")
        if (resetButton) resetButton.click()
        if (!spatialDomIsValid()) passed = false
        document.querySelectorAll("[data-control-id]").forEach((node) => {
          const control = definition.controls.find((candidate) => candidate.id === node.dataset.controlId)
          if (!control) return
          const actual = node.type === "checkbox" ? node.checked : node.value
          if (String(actual) !== String(control.defaultValue)) passed = false
        })
        const scrollWidth = document.documentElement.scrollWidth
        const clientWidth = document.documentElement.clientWidth
        document.body.dataset.breadboardScrollWidth = String(scrollWidth)
        document.body.dataset.breadboardClientWidth = String(clientWidth)
        if (scrollWidth > clientWidth + 1) {
          document.body.dataset.breadboardOverflow = "true"
          passed = false
        }
        document.body.dataset.breadboardRuntimeTests = passed ? "passed" : "failed"
        window.scrollTo(0, 0)
        } catch (error) {
          // Without this the attribute is simply never written, which reads as
          // "the self-tests never ran" and hides the actual reason.
          document.body.dataset.breadboardRuntimeTests = "failed"
          document.body.dataset.breadboardRuntimeError =
            error instanceof Error ? `${error.message}` : "self-test failed"
        }
      }
      // A headless --dump-dom run renders on demand, so a frame after this
      // message-driven render is not guaranteed and the rAF callback can be
      // dropped entirely. Timers always advance under --virtual-time-budget,
      // so they are what actually gets the self-tests to run; whichever fires
      // first wins and the other is a no-op.
      requestAnimationFrame(runSelfTests)
      setTimeout(runSelfTests, 0)
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window && event.source !== parent) return
    const message = event.data
    if (!message || message.type !== INIT || !message.definition) return
    try {
      renderDefinition(message.definition, message.theme)
    } catch (error) {
      document.body.dataset.breadboardRuntimeTests = "failed"
      parent.postMessage({ type: EVENT, event: "runtime-error", message: error instanceof Error ? error.message : "render failed" }, "*")
    }
  })
})()
