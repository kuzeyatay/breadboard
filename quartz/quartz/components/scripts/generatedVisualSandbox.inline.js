;(() => {
  "use strict"

  const ROOT_ID = "breadboard-generated-visual-root"
  const INIT = "breadboard-generated-visual:init"
  const THEME = "breadboard-generated-visual:theme"
  const EVENT = "breadboard-generated-visual:event"
  const SVG_NS = "http://www.w3.org/2000/svg"
  let diagramCounter = 0
  let spatialCounter = 0
  const spatialBoundsCache = new WeakMap()
  const spatialWorldBoundsCache = new WeakMap()
  const spatialCameraStateCache = new WeakMap()
  let activeSpatialDragCleanup = null
  let activeSpatialDragScene = null
  let activeDefinitionCleanup = null

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

  const transportIcon = (name) => {
    const icon = svgElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" })
    if (name === "play") {
      icon.appendChild(
        svgElement("path", { d: "M8 5.5 18 12 8 18.5Z", fill: "currentColor", stroke: "none" }),
      )
    } else if (name === "pause") {
      icon.appendChild(svgElement("path", { d: "M9 6v12M15 6v12" }))
    } else if (name === "step") {
      icon.appendChild(svgElement("path", { d: "m7 6 8 6-8 6ZM17 6v12" }))
    } else {
      icon.appendChild(svgElement("path", { d: "M4.5 8.5V4.5h4M5.2 5.3A8 8 0 1 1 4.4 14" }))
    }
    return icon
  }

  const setTransportButton = (button, name, label) => {
    button.replaceChildren(transportIcon(name), element("span", "gv-sr", label))
    button.setAttribute("aria-label", label)
    button.title = label
  }

  const createTransportButton = (action, name, label, primary = false) => {
    const button = element("button", "gv-transport")
    button.type = "button"
    button.dataset.action = action
    if (primary) button.dataset.kind = "primary"
    setTransportButton(button, name, label)
    return button
  }

  const finite = (value, fallback = 0) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  const safeLanguage = (value) => {
    const candidate = typeof value === "string" ? value.trim() : ""
    if (!candidate || candidate.length > 64) return "en"
    try {
      return Intl.getCanonicalLocales(candidate)[0] || "en"
    } catch {
      return "en"
    }
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
    :root {
      color-scheme:light dark;
      --viz-bg:#fbfaf7;
      --viz-panel:#f1f2f4;
      --viz-control:#efefed;
      --viz-control-hover:#e5e5e2;
      --viz-text:#171717;
      --viz-muted:#70706e;
      --viz-line:rgba(20,24,22,.14);
      --viz-accent:#3157c8;
      --viz-accent-text:#fff;
      --viz-accent-soft:#e3e9fb;
      --viz-spatial-green:#2f7350;
      --viz-spatial-blue:#3157c8;
      --viz-spatial-amber:#a85f18;
      --viz-spatial-violet:#7651c7;
      --viz-spatial-red:#a9443b;
      --viz-spatial-cyan:#147486;
      --viz-spatial-gray:#62666d;
      --bg:var(--viz-bg);
      --panel:var(--viz-panel);
      --line:var(--viz-line);
      --ink:var(--viz-text);
      --muted:var(--viz-muted);
      --accent:var(--viz-accent);
      --accent-soft:var(--viz-accent-soft);
      --spatial-green:var(--viz-spatial-green);
      --spatial-blue:var(--viz-spatial-blue);
      --spatial-amber:var(--viz-spatial-amber);
      --spatial-violet:var(--viz-spatial-violet);
      --spatial-red:var(--viz-spatial-red);
      --spatial-cyan:var(--viz-spatial-cyan);
      --spatial-gray:var(--viz-spatial-gray);
    }
    :root[data-theme="dark"] {
      --viz-bg:#0f0f10;
      --viz-panel:#17181d;
      --viz-control:#242426;
      --viz-control-hover:#303033;
      --viz-text:#f4f4f2;
      --viz-muted:#aaa9a6;
      --viz-line:rgba(255,255,255,.14);
      --viz-accent:#4568d8;
      --viz-accent-text:#fff;
      --viz-accent-soft:#202b4d;
      --viz-spatial-green:#67bd8a;
      --viz-spatial-blue:#87a0ff;
      --viz-spatial-amber:#e6a04a;
      --viz-spatial-violet:#a98bf0;
      --viz-spatial-red:#e67f76;
      --viz-spatial-cyan:#62c8d5;
      --viz-spatial-gray:#b0bac5;
    }
    * { box-sizing:border-box; }
    html,body { margin:0; min-height:100%; background:var(--viz-bg); color:var(--viz-text); font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button,input,select { font:inherit; color:inherit; }
    button { cursor:pointer; }
    .gv-root { width:100%; max-width:920px; margin:0 auto; padding:clamp(12px,2.7vw,30px); display:grid; gap:18px; overflow:hidden; container-type:inline-size; }
    .gv-header { display:flex; min-width:0; min-height:48px; align-items:flex-start; justify-content:space-between; gap:18px; }
    .gv-heading { min-width:0; }
    .gv-header h1 { margin:0; font-size:clamp(1.55rem,4vw,2.15rem); font-weight:450; letter-spacing:-.035em; line-height:1.08; }
    .gv-header p { max-width:68ch; margin:.55rem 0 0; color:var(--viz-muted); font-size:.92rem; line-height:1.5; }
    .gv-toolbar { display:flex; flex:none; gap:10px; }
    .gv-transport { display:grid; width:50px; height:50px; place-items:center; border:0; border-radius:999px; background:var(--viz-control); color:var(--viz-text); padding:0; transition:background .16s ease,transform .16s ease; }
    .gv-transport:hover { background:var(--viz-control-hover); }
    .gv-transport:active { transform:scale(.96); }
    .gv-transport[data-kind=primary] { background:var(--viz-accent); color:var(--viz-accent-text); }
    .gv-transport svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
    .gv-scenes { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; }
    .gv-scene { min-width:0; overflow:hidden; }
    .gv-scene + .gv-scene { border-top:1px solid var(--viz-line); padding-top:18px; }
    .gv-scene h3 { margin:0 0 10px; color:var(--viz-muted); font-size:.8rem; font-weight:600; letter-spacing:.02em; }
    .gv-svg { display:block; width:100%; height:auto; min-height:260px; background:var(--viz-panel); }
    .gv-scenes > .gv-scene:first-child .gv-svg { min-height:390px; }
    .gv-axis { stroke:var(--viz-muted); stroke-width:1; opacity:.7; }
    .gv-grid { stroke:var(--viz-line); stroke-width:1; opacity:.62; }
    .gv-line { fill:none; stroke-width:2.5; vector-effect:non-scaling-stroke; }
    .gv-node { fill:var(--viz-accent-soft); stroke:var(--viz-accent); stroke-width:1.5; }
    .gv-edge { stroke:var(--viz-muted); stroke-width:1.5; }
    .gv-label { fill:var(--viz-text); font-size:18px; font-weight:600; paint-order:stroke; stroke:var(--viz-bg); stroke-width:3px; stroke-linejoin:round; text-anchor:middle; }
    .gv-node-label { font-size:15px; }
    .gv-spatial-object,.gv-spatial-camera { outline:none; }
    .gv-spatial-object:focus-visible,.gv-spatial-camera:focus-visible { outline:3px solid var(--viz-accent); outline-offset:-4px; }
    .gv-spatial-camera[data-spatial-interaction=orbit] { cursor:grab; touch-action:none; }
    .gv-spatial-camera[data-spatial-dragging=true] { cursor:grabbing; }
    .gv-spatial-surface { stroke-width:1.8; vector-effect:non-scaling-stroke; }
    .gv-spatial-line { fill:none; stroke-width:2; vector-effect:non-scaling-stroke; }
    .gv-spatial-leader { stroke:var(--viz-muted); stroke-width:1; stroke-dasharray:3 3; vector-effect:non-scaling-stroke; }
    .gv-spatial-label { fill:var(--viz-text); font-size:15px; font-weight:650; paint-order:stroke; stroke:var(--viz-bg); stroke-width:3px; stroke-linejoin:round; text-anchor:middle; }
    .gv-spatial-legend { list-style:none; padding:9px 0 0; margin:0; display:flex; flex-wrap:wrap; gap:6px 12px; color:var(--viz-muted); font-size:12px; }
    .gv-spatial-legend li { display:flex; align-items:center; gap:5px; min-width:0; }
    .gv-spatial-symbol { width:1.5em; color:var(--spatial-color,var(--viz-accent)); font-weight:800; text-align:center; }
    .gv-tick { fill:var(--viz-text); font-size:16px; font-weight:600; paint-order:stroke; stroke:var(--viz-bg); stroke-width:3px; }
    .gv-values { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); border-top:1px solid var(--viz-line); border-bottom:1px solid var(--viz-line); }
    .gv-values:empty,.gv-controls:empty { display:none; }
    .gv-value { min-width:0; padding:18px 15px; text-align:center; }
    .gv-value + .gv-value { border-left:1px solid var(--viz-line); }
    .gv-value span { display:block; color:var(--viz-muted); font-size:.8rem; }
    .gv-value strong { display:block; margin-top:8px; font:500 1rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
    .gv-controls { display:grid; gap:0; }
    .gv-control { display:grid; grid-template-columns:minmax(145px,.8fr) minmax(150px,1.4fr) minmax(68px,auto); align-items:center; gap:18px; min-height:74px; border-bottom:1px solid var(--viz-line); padding:11px 0; }
    .gv-control:first-child { border-top:1px solid var(--viz-line); }
    .gv-control-head { display:contents; }
    .gv-control label { grid-column:1; grid-row:1; font-size:.9rem; font-weight:500; }
    .gv-readout { grid-column:3; grid-row:1; min-width:68px; border-radius:18px; background:var(--viz-control); padding:11px 12px; text-align:center; color:var(--viz-text); font:400 .9rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
    .gv-control input[type=range] { grid-column:2; grid-row:1; width:100%; height:24px; margin:0; accent-color:var(--viz-accent); cursor:pointer; }
    .gv-control input[type=number],.gv-control select { grid-column:2; grid-row:1; width:100%; border:1px solid var(--viz-line); border-radius:18px; background:var(--viz-control); padding:11px 13px; }
    .gv-control input[type=checkbox] { grid-column:2; grid-row:1; width:46px; height:26px; accent-color:var(--viz-accent); }
    .gv-control > button { grid-column:2/-1; border:0; border-radius:999px; background:var(--viz-control); padding:14px 18px; }
    .gv-control > button:hover { background:var(--viz-control-hover); }
    .gv-control :disabled { cursor:not-allowed; opacity:.48; }
    .gv-timeline { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
    .gv-timeline li { border-left:2px solid var(--viz-line); padding:5px 8px; opacity:.58; }
    .gv-timeline li[data-active=true] { border-color:var(--viz-accent); opacity:1; background:var(--viz-accent-soft); }
    .gv-table { width:100%; border-collapse:collapse; }
    .gv-table th,.gv-table td { border-bottom:1px solid var(--viz-line); padding:8px 6px; text-align:left; }
    .gv-formula { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; overflow-wrap:anywhere; }
    .gv-status { border-left:3px solid var(--viz-accent); padding-left:12px; }
    .gv-status strong { display:block; font-size:18px; margin:3px 0; }
    .gv-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--viz-accent); outline-offset:3px; }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; } }
    @media (max-width:640px) {
      .gv-root { padding:10px; gap:14px; }
      .gv-header h1 { font-size:1.45rem; }
      .gv-transport { width:44px; height:44px; }
      .gv-svg,.gv-scenes > .gv-scene:first-child .gv-svg { min-height:300px; }
      .gv-control { grid-template-columns:minmax(112px,.85fr) minmax(90px,1.15fr) minmax(62px,auto); gap:10px; }
      .gv-value { padding:15px 8px; }
      .gv-value + .gv-value:nth-child(odd) { border-left:0; }
    }
    @container (max-width:420px) {
      .gv-label { font-size:24px; }
      .gv-node-label { font-size:23px; }
      .gv-spatial-label { font-size:23px; }
      .gv-tick { font-size:22px; }
    }
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
    const svg = svgElement("svg", {
      viewBox: "0 0 640 340",
      class: "gv-svg",
      role: "img",
      "aria-label": scene.title,
    })
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
      svg.appendChild(
        svgElement("line", {
          x1: margin.left,
          y1: y,
          x2: margin.left + width,
          y2: y,
          class: "gv-grid",
        }),
      )
      const yTick = svgElement("text", {
        x: margin.left - 8,
        y: y + 5,
        class: "gv-tick",
        "text-anchor": "end",
      })
      yTick.textContent = format(yMax - ((yMax - yMin) * index) / 4, 2)
      svg.appendChild(yTick)
      const x = margin.left + (width * index) / 4
      const xTick = svgElement("text", {
        x,
        y: margin.top + height + 22,
        class: "gv-tick",
        "text-anchor": "middle",
      })
      xTick.textContent = format(scene.xMin + ((scene.xMax - scene.xMin) * index) / 4, 2)
      svg.appendChild(xTick)
    }
    svg.appendChild(
      svgElement("line", {
        x1: margin.left,
        y1: margin.top + height,
        x2: margin.left + width,
        y2: margin.top + height,
        class: "gv-axis",
      }),
    )
    svg.appendChild(
      svgElement("line", {
        x1: margin.left,
        y1: margin.top,
        x2: margin.left,
        y2: margin.top + height,
        class: "gv-axis",
      }),
    )
    const palette = [
      "var(--viz-accent)",
      "var(--viz-text)",
      "var(--viz-muted)",
      "var(--viz-spatial-violet)",
      "var(--viz-spatial-amber)",
      "var(--viz-spatial-cyan)",
    ]
    seriesValues.forEach(({ series, points }, index) => {
      const polyline = svgElement("polyline", {
        points: points
          .map((point) => `${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`)
          .join(" "),
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
      const circle = svgElement("circle", {
        cx: sx(x),
        cy: sy(y),
        r: 7,
        fill: marker.color || "var(--viz-accent)",
        stroke: "var(--viz-bg)",
        "stroke-width": 3,
      })
      const title = svgElement("title")
      title.textContent = `${marker.label}: ${format(x, 2)}, ${format(y, 2)}`
      circle.appendChild(title)
      svg.appendChild(circle)
    })
    const xLabel = svgElement("text", { x: margin.left + width / 2, y: 330, class: "gv-label" })
    xLabel.textContent = scene.xLabel
    svg.appendChild(xLabel)
    const yLabel = svgElement("text", {
      x: 13,
      y: margin.top + height / 2,
      class: "gv-label",
      transform: `rotate(-90 13 ${margin.top + height / 2})`,
    })
    yLabel.textContent = scene.yLabel
    svg.appendChild(yLabel)
    host.appendChild(svg)
    return host
  }

  const renderDiagram = (scene, state) => {
    const host = element("section", "gv-scene")
    host.appendChild(element("h3", undefined, scene.title))
    const svg = svgElement("svg", {
      viewBox: "0 0 640 360",
      class: "gv-svg",
      role: "img",
      "aria-label": scene.title,
    })
    const markerId = `gv-arrow-${(diagramCounter += 1)}`
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
      const strength = edge.strength
        ? Math.max(0.5, Math.min(6, Math.abs(evaluate(edge.strength, state))))
        : 1.5
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.max(1, Math.hypot(dx, dy))
      const startInset = from.shape === "rect" ? 48 : 32
      const endInset = to.shape === "rect" ? 52 : 38
      svg.appendChild(
        svgElement("line", {
          x1: from.x + (dx / length) * startInset,
          y1: from.y + (dy / length) * startInset,
          x2: to.x - (dx / length) * endInset,
          y2: to.y - (dy / length) * endInset,
          class: "gv-edge",
          "stroke-width": strength,
          ...(edge.directed ? { "marker-end": `url(#${markerId})` } : {}),
        }),
      )
      if (edge.label) {
        const label = svgElement("text", {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2 - 6,
          class: "gv-label",
        })
        label.textContent = edge.label
        svg.appendChild(label)
      }
    }
    for (const node of renderedNodes) {
      if (node.shape === "rect")
        svg.appendChild(
          svgElement("rect", {
            x: node.x - 48,
            y: node.y - 25,
            width: 96,
            height: 50,
            rx: 9,
            class: "gv-node",
          }),
        )
      else
        svg.appendChild(svgElement("circle", { cx: node.x, cy: node.y, r: 32, class: "gv-node" }))
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
        y: node.y - (lines.length - 1) * 8 + 4,
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
  const spatialKindSymbol = {
    plane: "▱",
    polygon: "⬠",
    sphere: "○",
    cylinder: "▭",
    cone: "△",
    point: "●",
    vector: "→",
  }
  const spatialMaximum = 1000000
  const spatialBoundsCombinationLimit = 100000
  const spatialConservativeExtent = spatialMaximum * 4

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
  const spatialDot = (left, right) =>
    left.reduce((sum, value, index) => sum + value * right[index], 0)
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
  const spatialPolylinePoints = (points) =>
    `${points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ")} ${points.length ? `${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}` : ""}`.trim()
  const spatialConvexHull = (points) => {
    const sorted = [...points]
      .filter((point) => point.every(Number.isFinite))
      .sort((left, right) => left[0] - right[0] || left[1] - right[1])
    if (sorted.length <= 2) return sorted
    const cross = (origin, left, right) =>
      (left[0] - origin[0]) * (right[1] - origin[1]) -
      (left[1] - origin[1]) * (right[0] - origin[0])
    const lower = []
    for (const point of sorted) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
      )
        lower.pop()
      lower.push(point)
    }
    const upper = []
    for (const point of [...sorted].reverse()) {
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
      )
        upper.pop()
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
        if (Math.hypot(...spatialSubtract(points[leftIndex], points[rightIndex])) <= tolerance)
          return false
      }
    }
    const origin = points[0]
    const firstEdge = points
      .slice(1)
      .map((point) => spatialSubtract(point, origin))
      .find((edge) => Math.hypot(...edge) > tolerance)
    if (!firstEdge) return false
    const firstLength = Math.hypot(...firstEdge)
    const normal = points
      .slice(1)
      .map((point) => spatialCross(firstEdge, spatialSubtract(point, origin)))
      .find((candidate) => Math.hypot(...candidate) / firstLength > tolerance)
    const unitNormal = normal ? spatialNormalize(normal) : null
    if (!unitNormal) return false
    if (
      points.some(
        (point) => Math.abs(spatialDot(spatialSubtract(point, origin), unitNormal)) > tolerance,
      )
    )
      return false
    const dominantAxis = unitNormal
      .map((component, index) => ({ index, magnitude: Math.abs(component) }))
      .sort((left, right) => right.magnitude - left.magnitude)[0].index
    const projected = points.map((point) => point.filter((_, index) => index !== dominantAxis))
    const projectedScale = Math.max(1, ...projected.flatMap((point) => point.map(Math.abs)))
    const areaTolerance = tolerance * projectedScale
    const orientation = (first, second, third) =>
      (second[0] - first[0]) * (third[1] - first[1]) -
      (second[1] - first[1]) * (third[0] - first[0])
    const onSegment = (first, second, point) =>
      point[0] >= Math.min(first[0], second[0]) - tolerance &&
      point[0] <= Math.max(first[0], second[0]) + tolerance &&
      point[1] >= Math.min(first[1], second[1]) - tolerance &&
      point[1] <= Math.max(first[1], second[1]) + tolerance
    const intersects = (firstStart, firstEnd, secondStart, secondEnd) => {
      const a = orientation(firstStart, firstEnd, secondStart)
      const b = orientation(firstStart, firstEnd, secondEnd)
      const c = orientation(secondStart, secondEnd, firstStart)
      const d = orientation(secondStart, secondEnd, firstEnd)
      if (
        (Math.abs(a) <= areaTolerance && onSegment(firstStart, firstEnd, secondStart)) ||
        (Math.abs(b) <= areaTolerance && onSegment(firstStart, firstEnd, secondEnd)) ||
        (Math.abs(c) <= areaTolerance && onSegment(secondStart, secondEnd, firstStart)) ||
        (Math.abs(d) <= areaTolerance && onSegment(secondStart, secondEnd, firstEnd))
      )
        return true
      return a > areaTolerance !== b > areaTolerance && c > areaTolerance !== d > areaTolerance
    }
    for (let firstIndex = 0; firstIndex < projected.length; firstIndex += 1) {
      const firstNext = (firstIndex + 1) % projected.length
      for (let secondIndex = firstIndex + 1; secondIndex < projected.length; secondIndex += 1) {
        const secondNext = (secondIndex + 1) % projected.length
        if (firstIndex === secondNext || firstNext === secondIndex || firstNext === secondNext)
          continue
        if (
          intersects(
            projected[firstIndex],
            projected[firstNext],
            projected[secondIndex],
            projected[secondNext],
          )
        )
          return false
      }
    }
    return true
  }

  const spatialBoxOverlapArea = (box, candidate, padding = 0) => {
    const overlapWidth = Math.max(
      0,
      Math.min(box.right, candidate.right) - Math.max(box.left, candidate.left) + padding,
    )
    const overlapHeight = Math.max(
      0,
      Math.min(box.bottom, candidate.bottom) - Math.max(box.top, candidate.top) + padding,
    )
    return overlapWidth * overlapHeight
  }

  const placeSpatialLabel = (anchor, fullLabel, occupied, geometryBoxes) => {
    const visualRoot = document.querySelector(".gv-root")
    const visualRootStyle = visualRoot ? getComputedStyle(visualRoot) : null
    const visualContentWidth = visualRoot
      ? visualRoot.clientWidth -
        finite(parseFloat(visualRootStyle?.paddingLeft || "0")) -
        finite(parseFloat(visualRootStyle?.paddingRight || "0"))
      : window.innerWidth
    const narrowVisual = visualContentWidth <= 420
    const labelLimit = narrowVisual ? 12 : 32
    const displayLabel =
      fullLabel.length > labelLimit ? `${fullLabel.slice(0, labelLimit - 1)}…` : fullLabel
    // SVG viewBox text scales with the visual on narrow screens. Mobile uses
    // larger authored units so the rendered label stays readable; keep the
    // deterministic collision boxes in step with that actual font size.
    const labelScale = narrowVisual ? 23 / 15 : 1
    const width = Math.max(
      52,
      Math.min(narrowVisual ? 210 : 320, displayLabel.length * 10.5 * labelScale),
    )
    const height = 21 * labelScale
    const offsets = [[0, -Math.max(24, height + 3)]]
    for (let radius = 32; radius <= 192; radius += 32) {
      for (let index = 0; index < 12; index += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 12
        offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
      }
    }
    const candidates = offsets.map(([dx, dy]) => [anchor[0] + dx, anchor[1] + dy])
    const laneWidth = 640 - 16
    const columnCount = Math.max(1, Math.floor(laneWidth / (width + 12)))
    const laneBaselines = [height, height * 2 + 10, 395 - height * 0.25, 390 - height * 1.35]
    laneBaselines.forEach((y) => {
      for (let column = 0; column < columnCount; column += 1) {
        candidates.push([8 + (laneWidth * (column + 0.5)) / columnCount, y])
      }
    })
    let best = null
    candidates.forEach(([candidateX, candidateY], order) => {
      const x = Math.max(width / 2 + 8, Math.min(640 - width / 2 - 8, candidateX))
      const y = Math.max(height, Math.min(395 - height * 0.25, candidateY))
      const box = {
        left: x - width / 2,
        right: x + width / 2,
        top: y - height * (16 / 21),
        bottom: y + height * (5 / 21),
      }
      const overlap = occupied.reduce(
        (total, candidate) => total + spatialBoxOverlapArea(box, candidate, 5),
        0,
      )
      const geometryOverlap = geometryBoxes.reduce(
        (total, candidate) => total + spatialBoxOverlapArea(box, candidate, 4),
        0,
      )
      const distance = Math.hypot(x - anchor[0], y - anchor[1])
      const score = overlap * 100000 + geometryOverlap * 100 + distance + order * 0.001
      if (!best || score < best.score)
        best = { x, y, box, score, displayLabel, distance, geometryOverlap }
    })
    occupied.push(best.box)
    return best
  }

  const spatialAuthoredDomainStates = (controls, currentState) => {
    const tValues = [0, 0.25, 0.5, 0.75, 1]
    const domains = (controls || []).map((control) => {
      let values = []
      if (control.type === "select") {
        values = Array.from({ length: (control.options || []).length }, (_, index) => index)
      } else if (control.type === "toggle") {
        values = [0, 1]
      } else if (control.type === "slider" || control.type === "number") {
        values = [control.min, control.defaultValue, control.max, currentState[control.id]]
      } else {
        values = [
          control.defaultValue,
          currentState[control.id],
          finite(currentState[control.id]) + 1,
        ]
      }
      return {
        id: control.id,
        values: [...new Set(values.filter((value) => Number.isFinite(Number(value))).map(Number))],
      }
    })
    const combinationCount = domains.reduce(
      (count, domain) => count * Math.max(1, domain.values.length),
      tValues.length,
    )
    if (!Number.isFinite(combinationCount) || combinationCount > spatialBoundsCombinationLimit) {
      return { states: [{ ...currentState }], exhaustive: false }
    }
    let states = [{ ...currentState }]
    domains.forEach((domain) => {
      if (!domain.values.length) return
      states = states.flatMap((sampleState) =>
        domain.values.map((value) => ({ ...sampleState, [domain.id]: value })),
      )
    })
    return {
      states: states.flatMap((sampleState) => tValues.map((t) => ({ ...sampleState, t }))),
      exhaustive: true,
    }
  }

  const resolveSpatialPrimitive = (primitive, group, state, index, ignoreVisibility = false) => {
    const primitiveVisibility = primitive.visibleWhen ? evaluate(primitive.visibleWhen, state) : 1
    if (!ignoreVisibility && (!Number.isFinite(primitiveVisibility) || primitiveVisibility <= 0))
      return null
    const opacityValue = primitive.opacity === undefined ? 0.32 : Number(primitive.opacity)
    const common = {
      id: primitive.id,
      kind: primitive.kind,
      label: primitive.label,
      groupLabel: group.label,
      color:
        spatialPalette[primitive.color] ||
        spatialPalette[spatialColorCycle[index % spatialColorCycle.length]],
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
        spatialAdd(
          center,
          spatialAdd(spatialScale(basis.first, half), spatialScale(basis.second, half)),
        ),
        spatialAdd(
          center,
          spatialAdd(spatialScale(basis.first, -half), spatialScale(basis.second, half)),
        ),
        spatialAdd(
          center,
          spatialAdd(spatialScale(basis.first, -half), spatialScale(basis.second, -half)),
        ),
        spatialAdd(
          center,
          spatialAdd(spatialScale(basis.first, half), spatialScale(basis.second, -half)),
        ),
      ]
      return {
        ...common,
        center,
        normal: basis.normal,
        corners,
        worldPoints: corners,
        anchor: center,
      }
    }
    if (primitive.kind === "polygon") {
      const points = Array.isArray(primitive.points)
        ? primitive.points.map((point) => spatialVector(point, state))
        : []
      if (points.some((point) => !point) || !spatialPolygonIsValid(points)) return null
      const anchor = points[0].map(
        (_, coordinateIndex) =>
          points.reduce((sum, point) => sum + point[coordinateIndex], 0) / points.length,
      )
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
      return {
        ...common,
        center,
        axis,
        radius,
        height,
        firstRing,
        secondRing,
        worldPoints: [...firstRing, ...secondRing],
        anchor: center,
      }
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
      return {
        ...common,
        apex,
        axis,
        radius,
        height,
        baseCenter,
        baseRing,
        worldPoints: [apex, ...baseRing],
        anchor: spatialAdd(apex, spatialScale(axis, height / 2)),
      }
    }
    if (primitive.kind === "point") {
      const position = spatialVector(primitive.position, state)
      const size =
        primitive.size === undefined ? 7 : spatialPositiveScalar(primitive.size, state, 40)
      if (!position || !Number.isFinite(size)) return null
      return {
        ...common,
        position,
        size: Math.max(3, Math.min(18, size)),
        worldPoints: [position],
        anchor: position,
      }
    }
    const from = spatialVector(primitive.from, state)
    const to = spatialVector(primitive.to, state)
    const headSize =
      primitive.headSize === undefined ? 8 : spatialPositiveScalar(primitive.headSize, state, 40)
    if (
      !from ||
      !to ||
      !Number.isFinite(headSize) ||
      Math.hypot(...spatialSubtract(to, from)) <= 1e-9
    )
      return null
    return {
      ...common,
      from,
      to,
      headSize: Math.max(4, Math.min(16, headSize)),
      worldPoints: [from, to],
      anchor: spatialScale(spatialAdd(from, to), 0.5),
    }
  }

  const includeSpatialWorldPoint = (bounds, point) => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) return
    for (let index = 0; index < 3; index += 1) {
      bounds.min[index] = Math.min(bounds.min[index], point[index])
      bounds.max[index] = Math.max(bounds.max[index], point[index])
    }
  }

  const includeSpatialObjectInWorldBounds = (bounds, object) => {
    object.worldPoints.forEach((point) => includeSpatialWorldPoint(bounds, point))
    if (object.kind === "sphere") {
      for (let axis = 0; axis < 3; axis += 1) {
        const before = [...object.center]
        const after = [...object.center]
        before[axis] -= object.radius
        after[axis] += object.radius
        includeSpatialWorldPoint(bounds, before)
        includeSpatialWorldPoint(bounds, after)
      }
    }
  }

  const spatialUnboundedInterval = () => [-Infinity, Infinity]
  const spatialOrderedInterval = (values) => {
    if (!values.length || values.some(Number.isNaN)) return spatialUnboundedInterval()
    return [Math.min(...values), Math.max(...values)]
  }
  const spatialExpressionInterval = (value, inputIntervals, depth = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) return [value, value]
    if (!value || typeof value !== "object" || depth > 32) return spatialUnboundedInterval()
    if (value.kind === "constant") {
      return Number.isFinite(Number(value.value))
        ? [Number(value.value), Number(value.value)]
        : spatialUnboundedInterval()
    }
    if (value.kind === "input") return inputIntervals.get(value.id) || spatialUnboundedInterval()
    if (value.kind === "conditional") {
      const whenTrue = spatialExpressionInterval(value.whenTrue, inputIntervals, depth + 1)
      const whenFalse = spatialExpressionInterval(value.whenFalse, inputIntervals, depth + 1)
      return [Math.min(whenTrue[0], whenFalse[0]), Math.max(whenTrue[1], whenFalse[1])]
    }
    if (value.kind === "clamp") {
      const source = spatialExpressionInterval(value.value, inputIntervals, depth + 1)
      const minimum = spatialExpressionInterval(value.min, inputIntervals, depth + 1)
      const maximum = spatialExpressionInterval(value.max, inputIntervals, depth + 1)
      return [
        Math.min(source[0], minimum[0], maximum[0]),
        Math.max(source[1], minimum[1], maximum[1]),
      ]
    }
    if (value.kind === "unary") {
      const argument = spatialExpressionInterval(value.argument, inputIntervals, depth + 1)
      if (value.op === "negate") return [-argument[1], -argument[0]]
      if (value.op === "abs") {
        return argument[0] <= 0 && argument[1] >= 0
          ? [0, Math.max(Math.abs(argument[0]), Math.abs(argument[1]))]
          : spatialOrderedInterval([Math.abs(argument[0]), Math.abs(argument[1])])
      }
      if (value.op === "sqrt") {
        if (argument[1] < 0) return spatialUnboundedInterval()
        return [Math.sqrt(Math.max(0, argument[0])), Math.sqrt(Math.max(0, argument[1]))]
      }
      if (value.op === "sin" || value.op === "cos") return [-1, 1]
      if (value.op === "tan") {
        if (!argument.every(Number.isFinite)) return spatialUnboundedInterval()
        const firstPole = Math.ceil((argument[0] - Math.PI / 2) / Math.PI)
        if (Math.PI / 2 + firstPole * Math.PI <= argument[1]) return spatialUnboundedInterval()
        return spatialOrderedInterval([Math.tan(argument[0]), Math.tan(argument[1])])
      }
      if (value.op === "exp") {
        return spatialOrderedInterval([Math.exp(argument[0]), Math.exp(argument[1])])
      }
      if (value.op === "log") {
        if (argument[1] <= 0) return spatialUnboundedInterval()
        return [argument[0] <= 0 ? -Infinity : Math.log(argument[0]), Math.log(argument[1])]
      }
      return spatialUnboundedInterval()
    }
    if (value.kind === "binary") {
      const left = spatialExpressionInterval(value.left, inputIntervals, depth + 1)
      const rightInterval = spatialExpressionInterval(value.right, inputIntervals, depth + 1)
      if (value.op === "add") return [left[0] + rightInterval[0], left[1] + rightInterval[1]]
      if (value.op === "subtract") return [left[0] - rightInterval[1], left[1] - rightInterval[0]]
      if (value.op === "min")
        return [Math.min(left[0], rightInterval[0]), Math.min(left[1], rightInterval[1])]
      if (value.op === "max")
        return [Math.max(left[0], rightInterval[0]), Math.max(left[1], rightInterval[1])]
      if (value.op === "multiply") {
        return spatialOrderedInterval([
          left[0] * rightInterval[0],
          left[0] * rightInterval[1],
          left[1] * rightInterval[0],
          left[1] * rightInterval[1],
        ])
      }
      if (value.op === "divide") {
        if (rightInterval[0] <= 0 && rightInterval[1] >= 0) return spatialUnboundedInterval()
        return spatialOrderedInterval([
          left[0] / rightInterval[0],
          left[0] / rightInterval[1],
          left[1] / rightInterval[0],
          left[1] / rightInterval[1],
        ])
      }
      if (value.op === "power") {
        const exponentIsConstant = rightInterval[0] === rightInterval[1]
        if (!exponentIsConstant) return spatialUnboundedInterval()
        const exponent = rightInterval[0]
        if (!Number.isInteger(exponent) && left[0] < 0) return spatialUnboundedInterval()
        if (exponent < 0 && left[0] <= 0 && left[1] >= 0) return spatialUnboundedInterval()
        const candidates = [Math.pow(left[0], exponent), Math.pow(left[1], exponent)]
        if (left[0] <= 0 && left[1] >= 0 && exponent > 0) candidates.push(0)
        return spatialOrderedInterval(candidates)
      }
    }
    return spatialUnboundedInterval()
  }

  const spatialInputIntervals = (controls) => {
    const intervals = new Map([
      ["x", [0, 0]],
      ["t", [0, 1]],
    ])
    ;(controls || []).forEach((control) => {
      if (control.type === "select") {
        intervals.set(control.id, [0, Math.max(0, (control.options || []).length - 1)])
      } else if (control.type === "toggle") {
        intervals.set(control.id, [0, 1])
      } else if (control.type === "button") {
        intervals.set(control.id, [0, Infinity])
      } else {
        const minimum = finite(control.min, -spatialMaximum)
        const maximum = finite(control.max, spatialMaximum)
        intervals.set(control.id, [Math.min(minimum, maximum), Math.max(minimum, maximum)])
      }
    })
    return intervals
  }

  const spatialScalarInterval = (value, inputIntervals) => {
    const interval = spatialExpressionInterval(value, inputIntervals)
    return [
      Number.isFinite(interval[0])
        ? Math.max(-spatialMaximum, Math.min(spatialMaximum, interval[0]))
        : -spatialMaximum,
      Number.isFinite(interval[1])
        ? Math.max(-spatialMaximum, Math.min(spatialMaximum, interval[1]))
        : spatialMaximum,
    ]
  }

  const spatialVectorIntervals = (value, inputIntervals) => {
    if (!Array.isArray(value) || value.length !== 3) {
      return Array.from({ length: 3 }, spatialUnboundedInterval)
    }
    return value.map((component) => spatialScalarInterval(component, inputIntervals))
  }

  const spatialGeometryHasExpression = (primitive) => {
    const fields =
      {
        plane: ["center", "normal", "size"],
        polygon: ["points"],
        sphere: ["center", "radius"],
        cylinder: ["center", "axis", "radius", "height"],
        cone: ["apex", "axis", "radius", "height"],
        point: ["position", "size"],
        vector: ["from", "to", "headSize"],
      }[primitive.kind] || []
    const containsExpression = (value) => {
      if (Array.isArray(value)) return value.some(containsExpression)
      return Boolean(value && typeof value === "object")
    }
    return fields.some((field) => containsExpression(primitive[field]))
  }

  const includeSpatialIntervalVector = (bounds, vector, padding = 0) => {
    vector.forEach((interval, axis) => {
      const lower = Number.isFinite(interval[0]) ? interval[0] : -spatialConservativeExtent
      const upper = Number.isFinite(interval[1]) ? interval[1] : spatialConservativeExtent
      bounds.min[axis] = Math.min(bounds.min[axis], lower - padding)
      bounds.max[axis] = Math.max(bounds.max[axis], upper + padding)
    })
  }

  const includeSpatialPrimitiveIntervalBounds = (bounds, primitive, inputIntervals) => {
    if (!spatialGeometryHasExpression(primitive)) return
    const positiveMaximum = (value) => Math.max(0, spatialScalarInterval(value, inputIntervals)[1])
    if (primitive.kind === "polygon") {
      ;(primitive.points || []).forEach((point) =>
        includeSpatialIntervalVector(bounds, spatialVectorIntervals(point, inputIntervals)),
      )
      return
    }
    if (primitive.kind === "point") {
      includeSpatialIntervalVector(
        bounds,
        spatialVectorIntervals(primitive.position, inputIntervals),
      )
      return
    }
    if (primitive.kind === "vector") {
      includeSpatialIntervalVector(bounds, spatialVectorIntervals(primitive.from, inputIntervals))
      includeSpatialIntervalVector(bounds, spatialVectorIntervals(primitive.to, inputIntervals))
      return
    }
    if (primitive.kind === "sphere") {
      includeSpatialIntervalVector(
        bounds,
        spatialVectorIntervals(primitive.center, inputIntervals),
        positiveMaximum(primitive.radius),
      )
      return
    }
    if (primitive.kind === "plane") {
      includeSpatialIntervalVector(
        bounds,
        spatialVectorIntervals(primitive.center, inputIntervals),
        positiveMaximum(primitive.size) / Math.SQRT2,
      )
      return
    }
    if (primitive.kind === "cylinder") {
      includeSpatialIntervalVector(
        bounds,
        spatialVectorIntervals(primitive.center, inputIntervals),
        positiveMaximum(primitive.radius) + positiveMaximum(primitive.height) / 2,
      )
      return
    }
    if (primitive.kind === "cone") {
      includeSpatialIntervalVector(
        bounds,
        spatialVectorIntervals(primitive.apex, inputIntervals),
        positiveMaximum(primitive.radius) + positiveMaximum(primitive.height),
      )
    }
  }

  const includeSpatialSceneIntervalBounds = (bounds, scene, controls) => {
    const inputIntervals = spatialInputIntervals(controls)
    ;(scene.groups || []).forEach((group) => {
      ;(group.primitives || []).forEach((primitive) =>
        includeSpatialPrimitiveIntervalBounds(bounds, primitive, inputIntervals),
      )
    })
  }

  const spatialAuthoredWorldBounds = (scene, controls, state, currentObjects) => {
    const cached = spatialWorldBoundsCache.get(scene)
    if (cached) return cached
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    const authoredDomain = spatialAuthoredDomainStates(controls, state)
    if (authoredDomain.exhaustive) {
      authoredDomain.states.forEach((sampleState) => {
        let primitiveIndex = 0
        ;(scene.groups || []).forEach((group) => {
          ;(group.primitives || []).forEach((primitive) => {
            const object = resolveSpatialPrimitive(
              primitive,
              group,
              sampleState,
              primitiveIndex,
              true,
            )
            primitiveIndex += 1
            if (object) includeSpatialObjectInWorldBounds(bounds, object)
          })
        })
      })
    } else {
      bounds.min.fill(-spatialConservativeExtent)
      bounds.max.fill(spatialConservativeExtent)
    }
    includeSpatialSceneIntervalBounds(bounds, scene, controls)
    if (![...bounds.min, ...bounds.max].every(Number.isFinite)) {
      currentObjects.forEach((object) => includeSpatialObjectInWorldBounds(bounds, object))
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (!Number.isFinite(bounds.min[axis]) || !Number.isFinite(bounds.max[axis])) {
        bounds.min[axis] = -1
        bounds.max[axis] = 1
      }
    }
    const frameMin = [...bounds.min]
    const frameMax = [...bounds.max]
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(frameMax[axis] - frameMin[axis]) < 1e-9) {
        frameMin[axis] -= 0.5
        frameMax[axis] += 0.5
      }
    }
    const center = frameMin.map((value, index) => (value + frameMax[index]) / 2)
    const corners = []
    for (const x of [frameMin[0], frameMax[0]]) {
      for (const y of [frameMin[1], frameMax[1]]) {
        for (const z of [frameMin[2], frameMax[2]]) corners.push([x, y, z])
      }
    }
    const radius = Math.max(
      1e-6,
      ...corners.map((point) => Math.hypot(...spatialSubtract(point, center))),
    )
    const result = { ...bounds, frameMin, frameMax, center, corners, radius }
    spatialWorldBoundsCache.set(scene, result)
    return result
  }

  const authoredSpatialCamera = (scene) => ({
    azimuthDegrees: Math.max(
      -180,
      Math.min(180, finite(scene.view && scene.view.azimuthDegrees, 35)),
    ),
    elevationDegrees: Math.max(
      -85,
      Math.min(85, finite(scene.view && scene.view.elevationDegrees, 24)),
    ),
    zoom: Math.max(0.25, Math.min(2, finite(scene.view && scene.view.scale, 1))),
  })

  const spatialCameraState = (scene) => {
    let camera = spatialCameraStateCache.get(scene)
    if (!camera) {
      camera = authoredSpatialCamera(scene)
      spatialCameraStateCache.set(scene, camera)
    }
    return camera
  }

  const resetSpatialCamera = (scene) => {
    spatialCameraStateCache.set(scene, authoredSpatialCamera(scene))
  }

  const renderSpatial = (scene, state, controls, requestRender, sceneIndex) => {
    const host = element("section", "gv-scene")
    host.dataset.spatialHost = "true"
    const projection =
      scene.view && scene.view.projection === "perspective" ? "perspective" : "orthographic"
    const interaction = scene.view && scene.view.interaction === "orbit" ? "orbit" : "fixed"
    const enhancedCamera = projection !== "orthographic" || interaction !== "fixed"
    const sceneNumber = (spatialCounter += 1)
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
      "data-spatial-scene-index": sceneIndex,
      "data-spatial-projection": projection,
      "data-spatial-interaction": interaction,
    })
    svg.classList.add("gv-spatial-camera")
    if (activeSpatialDragScene === scene) svg.dataset.spatialDragging = "true"
    if (interaction === "orbit") {
      svg.setAttribute("tabindex", "0")
      svg.setAttribute("aria-roledescription", "interactive three-dimensional model")
      svg.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown + - Home")
    }
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
        const primitiveVisibility = primitive.visibleWhen
          ? evaluate(primitive.visibleWhen, state)
          : 1
        if (groupIsVisible && Number.isFinite(primitiveVisibility) && primitiveVisibility > 0)
          resolved.push(object)
      })
    })

    let projectRaw
    let project
    let projectedRadius
    let fitScale
    let right
    let up
    let forward
    if (!enhancedCamera) {
      // Keep the original fixed orthographic implementation intact for every
      // artifact authored before projection/interaction became explicit.
      const azimuth =
        (Math.max(-180, Math.min(180, finite(scene.view && scene.view.azimuthDegrees, 35))) *
          Math.PI) /
        180
      const elevation =
        (Math.max(-85, Math.min(85, finite(scene.view && scene.view.elevationDegrees, 24))) *
          Math.PI) /
        180
      const viewScale = Math.max(0.25, Math.min(2, finite(scene.view && scene.view.scale, 1)))
      right = [-Math.sin(azimuth), Math.cos(azimuth), 0]
      up = [
        -Math.cos(azimuth) * Math.sin(elevation),
        -Math.sin(azimuth) * Math.sin(elevation),
        Math.cos(elevation),
      ]
      forward = [
        Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
      ]
      projectRaw = (point) => [
        spatialDot(point, right),
        spatialDot(point, up),
        spatialDot(point, forward),
      ]
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
        const authoredDomain = spatialAuthoredDomainStates(controls, state)
        if (authoredDomain.exhaustive) {
          authoredDomain.states.forEach((sampleState) => {
            let samplePrimitiveIndex = 0
            ;(scene.groups || []).forEach((group) => {
              ;(group.primitives || []).forEach((primitive) => {
                const object = resolveSpatialPrimitive(
                  primitive,
                  group,
                  sampleState,
                  samplePrimitiveIndex,
                  true,
                )
                samplePrimitiveIndex += 1
                if (object) includeObjectInBounds(authoredBounds, object)
              })
            })
          })
        } else {
          for (const x of [-spatialConservativeExtent, spatialConservativeExtent]) {
            for (const y of [-spatialConservativeExtent, spatialConservativeExtent]) {
              for (const z of [-spatialConservativeExtent, spatialConservativeExtent]) {
                const projected = projectRaw([x, y, z])
                authoredBounds.xMin = Math.min(authoredBounds.xMin, projected[0])
                authoredBounds.xMax = Math.max(authoredBounds.xMax, projected[0])
                authoredBounds.yMin = Math.min(authoredBounds.yMin, projected[1])
                authoredBounds.yMax = Math.max(authoredBounds.yMax, projected[1])
              }
            }
          }
        }
        const intervalBounds = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        }
        includeSpatialSceneIntervalBounds(intervalBounds, scene, controls)
        if ([...intervalBounds.min, ...intervalBounds.max].every(Number.isFinite)) {
          for (const x of [intervalBounds.min[0], intervalBounds.max[0]]) {
            for (const y of [intervalBounds.min[1], intervalBounds.max[1]]) {
              for (const z of [intervalBounds.min[2], intervalBounds.max[2]]) {
                const projected = projectRaw([x, y, z])
                authoredBounds.xMin = Math.min(authoredBounds.xMin, projected[0])
                authoredBounds.xMax = Math.max(authoredBounds.xMax, projected[0])
                authoredBounds.yMin = Math.min(authoredBounds.yMin, projected[1])
                authoredBounds.yMax = Math.max(authoredBounds.yMax, projected[1])
              }
            }
          }
        }
        if (
          ![
            authoredBounds.xMin,
            authoredBounds.xMax,
            authoredBounds.yMin,
            authoredBounds.yMax,
          ].every(Number.isFinite)
        ) {
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
      fitScale = Math.min(520 / spanX, 300 / spanY) * viewScale
      const rawCenter = [(xMin + xMax) / 2, (yMin + yMax) / 2]
      svg.dataset.spatialCameraBounds = [xMin, xMax, yMin, yMax]
        .map((value) => value.toFixed(6))
        .join(",")
      svg.dataset.spatialCamera = [
        finite(scene.view && scene.view.azimuthDegrees, 35),
        finite(scene.view && scene.view.elevationDegrees, 24),
        viewScale,
      ]
        .map((value) => Number(value).toFixed(3))
        .join(",")
      project = (point) => {
        const raw = projectRaw(point)
        return [
          320 + (raw[0] - rawCenter[0]) * fitScale,
          200 - (raw[1] - rawCenter[1]) * fitScale,
          raw[2],
        ]
      }
      projectedRadius = (_center, radius) => radius * fitScale
    } else {
      const camera = spatialCameraState(scene)
      const azimuth = (camera.azimuthDegrees * Math.PI) / 180
      const elevation = (camera.elevationDegrees * Math.PI) / 180
      right = [-Math.sin(azimuth), Math.cos(azimuth), 0]
      up = [
        -Math.cos(azimuth) * Math.sin(elevation),
        -Math.sin(azimuth) * Math.sin(elevation),
        Math.cos(elevation),
      ]
      forward = [
        Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
      ]
      const worldBounds = spatialAuthoredWorldBounds(scene, controls, state, resolved)
      const target = worldBounds.center
      const cameraDistance = worldBounds.radius * 3.5
      projectRaw =
        projection === "perspective"
          ? (point) => {
              const relative = spatialSubtract(point, target)
              const depth = Math.max(
                worldBounds.radius * 0.04,
                cameraDistance - spatialDot(relative, forward),
              )
              return [
                spatialDot(relative, right) / depth,
                spatialDot(relative, up) / depth,
                spatialDot(relative, forward),
              ]
            }
          : (point) => {
              const relative = spatialSubtract(point, target)
              return [
                spatialDot(relative, right),
                spatialDot(relative, up),
                spatialDot(relative, forward),
              ]
            }
      const projectedCorners = worldBounds.corners.map(projectRaw)
      const xMin = Math.min(...projectedCorners.map((point) => point[0]))
      const xMax = Math.max(...projectedCorners.map((point) => point[0]))
      const yMin = Math.min(...projectedCorners.map((point) => point[1]))
      const yMax = Math.max(...projectedCorners.map((point) => point[1]))
      const spanX = Math.max(1e-6, xMax - xMin)
      const spanY = Math.max(1e-6, yMax - yMin)
      fitScale = Math.min(520 / spanX, 300 / spanY) * camera.zoom
      const rawCenter = [(xMin + xMax) / 2, (yMin + yMax) / 2]
      svg.dataset.spatialCameraBounds = [xMin, xMax, yMin, yMax]
        .map((value) => value.toFixed(6))
        .join(",")
      svg.dataset.spatialWorldBounds = [...worldBounds.min, ...worldBounds.max]
        .map((value) => value.toFixed(6))
        .join(",")
      svg.dataset.spatialCamera = [camera.azimuthDegrees, camera.elevationDegrees, camera.zoom]
        .map((value) => value.toFixed(3))
        .join(",")
      project = (point) => {
        const raw = projectRaw(point)
        return [
          320 + (raw[0] - rawCenter[0]) * fitScale,
          200 - (raw[1] - rawCenter[1]) * fitScale,
          raw[2],
        ]
      }
      projectedRadius = (center, radius) => {
        if (projection === "orthographic") return radius * fitScale
        const projectedCenter = project(center)
        const projectedEdge = project(spatialAdd(center, spatialScale(right, radius)))
        return Math.max(
          0.1,
          Math.hypot(projectedEdge[0] - projectedCenter[0], projectedEdge[1] - projectedCenter[1]),
        )
      }
    }
    const projectedGeometryBox = (object) => {
      if (object.kind === "sphere") {
        const center = project(object.center)
        const radius = projectedRadius(object.center, object.radius)
        return {
          left: center[0] - radius,
          right: center[0] + radius,
          top: center[1] - radius,
          bottom: center[1] + radius,
        }
      }
      const points = object.worldPoints.map(project)
      if (!points.length) return { left: 0, right: 0, top: 0, bottom: 0 }
      const padding =
        object.kind === "point"
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
    const geometryBoxById = new Map(
      resolved.map((object) => [object.id, projectedGeometryBox(object)]),
    )
    const geometryBoxes = [...geometryBoxById.values()]
    const dashFor = (pattern) =>
      pattern === "striped"
        ? "10 4"
        : pattern === "dotted"
          ? "2 5"
          : pattern === "crosshatch"
            ? "8 3 2 3"
            : undefined
    const surfaceFill = (object) => {
      if (object.pattern === "solid") return object.color
      const patternId = `gv-spatial-pattern-${sceneNumber}-${object.id}`
      const pattern = svgElement("pattern", {
        id: patternId,
        patternUnits: "userSpaceOnUse",
        width: 12,
        height: 12,
      })
      pattern.appendChild(
        svgElement("rect", {
          width: 12,
          height: 12,
          fill: object.color,
          "fill-opacity": object.opacity * 0.35,
        }),
      )
      if (object.pattern === "dotted") {
        pattern.appendChild(
          svgElement("circle", {
            cx: 3,
            cy: 3,
            r: 1.6,
            fill: object.color,
            "fill-opacity": Math.min(1, object.opacity + 0.35),
          }),
        )
        pattern.appendChild(
          svgElement("circle", {
            cx: 9,
            cy: 9,
            r: 1.6,
            fill: object.color,
            "fill-opacity": Math.min(1, object.opacity + 0.35),
          }),
        )
      } else {
        pattern.appendChild(
          svgElement("path", {
            d: "M -3 3 L 3 -3 M 0 12 L 12 0 M 9 15 L 15 9",
            stroke: object.color,
            "stroke-width": 1.5,
            "stroke-opacity": Math.min(1, object.opacity + 0.35),
          }),
        )
        if (object.pattern === "crosshatch") {
          pattern.appendChild(
            svgElement("path", {
              d: "M -3 9 L 3 15 M 0 0 L 12 12 M 9 -3 L 15 3",
              stroke: object.color,
              "stroke-width": 1.5,
              "stroke-opacity": Math.min(1, object.opacity + 0.35),
            }),
          )
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
        objectGroup.dataset.spatialDepth = projectedAnchor[2].toFixed(6)
        if (geometryBox) {
          objectGroup.dataset.spatialGeometryLeft = geometryBox.left.toFixed(2)
          objectGroup.dataset.spatialGeometryRight = geometryBox.right.toFixed(2)
          objectGroup.dataset.spatialGeometryTop = geometryBox.top.toFixed(2)
          objectGroup.dataset.spatialGeometryBottom = geometryBox.bottom.toFixed(2)
        }
        addObjectTitle(objectGroup, object)
        if (object.kind === "plane") {
          const corners = object.corners.map(project)
          addSurface(
            objectGroup,
            "polygon",
            { points: corners.map((point) => `${point[0]},${point[1]}`).join(" ") },
            object,
          )
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(corners) }, object)
        } else if (object.kind === "polygon") {
          const points = object.points.map(project)
          addSurface(
            objectGroup,
            "polygon",
            { points: points.map((point) => `${point[0]},${point[1]}`).join(" ") },
            object,
          )
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(points) }, object)
        } else if (object.kind === "sphere") {
          const center = project(object.center)
          const radius = projectedRadius(object.center, object.radius)
          addSurface(objectGroup, "circle", { cx: center[0], cy: center[1], r: radius }, object)
          const circles = [
            spatialRing(object.center, [0, 0, 1], object.radius),
            spatialRing(object.center, [0, 1, 0], object.radius),
            spatialRing(object.center, [1, 0, 0], object.radius),
          ]
          circles.forEach((circle) =>
            addLine(
              objectGroup,
              "polyline",
              { points: spatialPolylinePoints(circle.map(project)) },
              object,
            ),
          )
        } else if (object.kind === "cylinder") {
          const firstRing = object.firstRing.map(project)
          const secondRing = object.secondRing.map(project)
          const hull = spatialConvexHull([...firstRing, ...secondRing])
          addSurface(
            objectGroup,
            "polygon",
            { points: hull.map((point) => `${point[0]},${point[1]}`).join(" ") },
            object,
          )
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(firstRing) }, object)
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(secondRing) }, object)
          ;[0, 7, 14, 21].forEach((index) =>
            addLine(
              objectGroup,
              "line",
              {
                x1: firstRing[index][0],
                y1: firstRing[index][1],
                x2: secondRing[index][0],
                y2: secondRing[index][1],
              },
              object,
            ),
          )
        } else if (object.kind === "cone") {
          const apex = project(object.apex)
          const baseRing = object.baseRing.map(project)
          const hull = spatialConvexHull([apex, ...baseRing])
          addSurface(
            objectGroup,
            "polygon",
            { points: hull.map((point) => `${point[0]},${point[1]}`).join(" ") },
            object,
          )
          addLine(objectGroup, "polyline", { points: spatialPolylinePoints(baseRing) }, object)
          ;[0, 7, 14, 21].forEach((index) =>
            addLine(
              objectGroup,
              "line",
              {
                x1: apex[0],
                y1: apex[1],
                x2: baseRing[index][0],
                y2: baseRing[index][1],
              },
              object,
            ),
          )
        } else if (object.kind === "point") {
          const position = project(object.position)
          objectGroup.appendChild(
            svgElement("circle", {
              cx: position[0],
              cy: position[1],
              r: object.size,
              fill: object.color,
              stroke: "var(--bg)",
              "stroke-width": 3,
            }),
          )
          addLine(
            objectGroup,
            "line",
            {
              x1: position[0] - object.size - 4,
              y1: position[1],
              x2: position[0] + object.size + 4,
              y2: position[1],
            },
            object,
          )
          addLine(
            objectGroup,
            "line",
            {
              x1: position[0],
              y1: position[1] - object.size - 4,
              x2: position[0],
              y2: position[1] + object.size + 4,
            },
            object,
          )
        } else {
          const from = project(object.from)
          const to = project(object.to)
          const markerId = `gv-spatial-arrow-${sceneNumber}-${object.id}`
          const marker = svgElement("marker", {
            id: markerId,
            viewBox: "0 0 10 10",
            refX: 9,
            refY: 5,
            markerWidth: object.headSize,
            markerHeight: object.headSize,
            orient: "auto",
          })
          marker.appendChild(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: object.color }))
          defs.appendChild(marker)
          addLine(
            objectGroup,
            "line",
            { x1: from[0], y1: from[1], x2: to[0], y2: to[1], "marker-end": `url(#${markerId})` },
            object,
          )
          objectGroup.appendChild(
            svgElement("circle", { cx: from[0], cy: from[1], r: 3, fill: object.color }),
          )
        }
        labelRequests.push({ object, anchor: projectedAnchor })
        svg.appendChild(objectGroup)
      })

    const occupiedLabelBoxes = []
    const labelsLayer = svgElement("g", { "aria-hidden": "true" })
    labelRequests.forEach(({ object, anchor }) => {
      const placement = placeSpatialLabel(anchor, object.label, occupiedLabelBoxes, geometryBoxes)
      if (placement.distance > 26) {
        labelsLayer.appendChild(
          svgElement("line", {
            x1: anchor[0],
            y1: anchor[1],
            x2: placement.x,
            y2: placement.y - 7,
            class: "gv-spatial-leader",
          }),
        )
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

    const projectionDescription =
      projection === "perspective"
        ? "Perspective spatial projection"
        : "Orthographic spatial projection"
    const interactionDescription =
      interaction === "orbit"
        ? " Drag or use the arrow keys to orbit, use the mouse wheel or plus and minus keys to zoom, and use Home or Reset to restore the authored view."
        : " The authored camera is fixed."
    description.textContent = resolved.length
      ? `${projectionDescription}.${interactionDescription} ${resolved.map((object) => `${object.groupLabel}: ${object.label}, ${object.kind}, ${object.pattern} pattern`).join("; ")}.`
      : `${projectionDescription} with no valid visible primitives in the current state.${interactionDescription}`
    if (interaction === "orbit") {
      const rerender = () => {
        if (typeof requestRender === "function") requestRender()
      }
      svg.addEventListener("pointerdown", (event) => {
        if (event.isPrimary === false || (typeof event.button === "number" && event.button !== 0))
          return
        if (activeSpatialDragCleanup) activeSpatialDragCleanup()
        const camera = spatialCameraState(scene)
        const pointerId = event.pointerId
        let previousX = event.clientX
        let previousY = event.clientY
        activeSpatialDragScene = scene
        svg.dataset.spatialDragging = "true"
        svg.focus({ preventScroll: true })
        event.preventDefault()
        const move = (moveEvent) => {
          if (moveEvent.pointerId !== pointerId) return
          const deltaX = moveEvent.clientX - previousX
          const deltaY = moveEvent.clientY - previousY
          previousX = moveEvent.clientX
          previousY = moveEvent.clientY
          camera.azimuthDegrees =
            ((((camera.azimuthDegrees + deltaX * 0.35 + 180) % 360) + 360) % 360) - 180
          camera.elevationDegrees = Math.max(
            -85,
            Math.min(85, camera.elevationDegrees - deltaY * 0.3),
          )
          moveEvent.preventDefault()
          rerender()
        }
        const cleanup = (endEvent) => {
          if (endEvent && endEvent.pointerId !== undefined && endEvent.pointerId !== pointerId)
            return
          window.removeEventListener("pointermove", move)
          window.removeEventListener("pointerup", cleanup)
          window.removeEventListener("pointercancel", cleanup)
          window.removeEventListener("blur", cleanup)
          if (activeSpatialDragCleanup === cleanup) activeSpatialDragCleanup = null
          if (activeSpatialDragScene === scene) activeSpatialDragScene = null
          const current = document.querySelector(`[data-spatial-scene-index="${sceneIndex}"]`)
          if (current) current.dataset.spatialDragging = "false"
        }
        activeSpatialDragCleanup = cleanup
        window.addEventListener("pointermove", move, { passive: false })
        window.addEventListener("pointerup", cleanup)
        window.addEventListener("pointercancel", cleanup)
        window.addEventListener("blur", cleanup)
      })
      svg.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault()
          const camera = spatialCameraState(scene)
          camera.zoom = Math.max(0.2, Math.min(5, camera.zoom * Math.exp(-event.deltaY * 0.0015)))
          rerender()
        },
        { passive: false },
      )
      svg.addEventListener("keydown", (event) => {
        const camera = spatialCameraState(scene)
        const rotationStep = event.shiftKey ? 12 : 5
        let handled = true
        if (event.key === "ArrowLeft")
          camera.azimuthDegrees =
            ((((camera.azimuthDegrees - rotationStep + 180) % 360) + 360) % 360) - 180
        else if (event.key === "ArrowRight")
          camera.azimuthDegrees =
            ((((camera.azimuthDegrees + rotationStep + 180) % 360) + 360) % 360) - 180
        else if (event.key === "ArrowUp")
          camera.elevationDegrees = Math.min(85, camera.elevationDegrees + rotationStep)
        else if (event.key === "ArrowDown")
          camera.elevationDegrees = Math.max(-85, camera.elevationDegrees - rotationStep)
        else if (event.key === "+" || event.key === "=" || event.key === "Add")
          camera.zoom = Math.min(5, camera.zoom * 1.12)
        else if (event.key === "-" || event.key === "_" || event.key === "Subtract")
          camera.zoom = Math.max(0.2, camera.zoom / 1.12)
        else if (event.key === "Home") resetSpatialCamera(scene)
        else handled = false
        if (!handled) return
        event.preventDefault()
        rerender()
      })
    }
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
      item.appendChild(
        element(
          "span",
          undefined,
          `${object.groupLabel}: ${object.label} — ${object.kind}, ${object.pattern}`,
        ),
      )
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
        const output =
          value && typeof value === "object" ? format(evaluate(value, state)) : String(value)
        tr.appendChild(element("td", undefined, output))
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    host.appendChild(table)
    return host
  }

  const renderDefinition = (definition, theme, language) => {
    if (activeDefinitionCleanup) activeDefinitionCleanup()
    if (activeSpatialDragCleanup) activeSpatialDragCleanup()
    document.title = definition.title
    document.documentElement.lang = safeLanguage(language)
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"
    installStyles()
    const root = document.getElementById(ROOT_ID) || document.body.appendChild(element("div"))
    root.id = ROOT_ID
    root.replaceChildren()
    const app = element("main", "gv-root")
    app.setAttribute("aria-label", definition.accessibilityDescription)
    const header = element("header", "gv-header")
    const heading = element("div", "gv-heading")
    heading.appendChild(element("h1", undefined, definition.title))
    heading.appendChild(element("p", undefined, definition.description))
    heading.appendChild(element("p", "gv-sr", definition.accessibilityDescription))
    const toolbar = element("div", "gv-toolbar")
    toolbar.setAttribute("role", "toolbar")
    toolbar.setAttribute("aria-label", "Visualization playback and view controls")
    header.append(heading, toolbar)
    app.appendChild(header)

    const state = {}
    const defaults = {}
    definition.controls.forEach((control) => {
      const initialValue =
        control.type === "select"
          ? Math.max(0, (control.options || []).indexOf(String(control.defaultValue)))
          : control.type === "toggle"
            ? Boolean(control.defaultValue)
              ? 1
              : 0
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
    let animationStarted = null
    let resumeWhenVisible = false
    let playPauseButton = null
    const outputNodes = new Map()
    const scenesHost = element("div", "gv-scenes")
    const valuesHost = element("div", "gv-values")
    const controlsHost = element("div", "gv-controls")
    const controlElements = new Map()
    valuesHost.setAttribute("aria-live", "polite")
    valuesHost.setAttribute("aria-atomic", "true")

    const outputValue = (output) => (output.expression ? evaluate(output.expression, state) : 0)
    const valueSceneOutputIds = new Set(
      definition.scenes.filter((scene) => scene.kind === "value").map((scene) => scene.outputId),
    )
    const draw = (focusSpatialSceneIndex) => {
      scenesHost.replaceChildren()
      valuesHost.replaceChildren()
      outputNodes.clear()
      definition.outputs.forEach((output) => {
        if (!output.expression || valueSceneOutputIds.has(output.id)) return
        const card = element("div", "gv-value")
        card.appendChild(element("span", undefined, output.label))
        const value = outputValue(output)
        const strong = element(
          "strong",
          undefined,
          `${format(value, output.precision)}${output.unit ? ` ${output.unit}` : ""}`,
        )
        strong.dataset.outputId = output.id
        strong.dataset.outputFinite = String(Number.isFinite(value))
        outputNodes.set(output.id, strong)
        card.appendChild(strong)
        valuesHost.appendChild(card)
      })
      definition.scenes.forEach((scene, sceneIndex) => {
        if (scene.kind === "plot") scenesHost.appendChild(renderPlot(scene, state))
        else if (scene.kind === "diagram") scenesHost.appendChild(renderDiagram(scene, state))
        else if (scene.kind === "spatial")
          scenesHost.appendChild(
            renderSpatial(scene, state, definition.controls, () => draw(sceneIndex), sceneIndex),
          )
        else if (scene.kind === "timeline") scenesHost.appendChild(renderTimeline(scene, state))
        else if (scene.kind === "table") scenesHost.appendChild(renderTable(scene, state))
        else if (scene.kind === "value") {
          const output = definition.outputs.find((candidate) => candidate.id === scene.outputId)
          if (output && output.expression) {
            const host = element("section", "gv-scene")
            host.appendChild(element("h3", undefined, output.label))
            host.appendChild(
              element(
                "strong",
                undefined,
                `${format(outputValue(output), output.precision)}${output.unit ? ` ${output.unit}` : ""}`,
              ),
            )
            scenesHost.appendChild(host)
          }
        } else if (scene.kind === "annotation" || scene.kind === "formula") {
          if (!scene.visibleWhen || evaluate(scene.visibleWhen, state) > 0) {
            const host = element(
              "section",
              `gv-scene ${scene.kind === "formula" ? "gv-formula" : ""}`,
            )
            host.appendChild(element("h3", undefined, scene.title))
            host.appendChild(element("p", undefined, scene.text))
            scenesHost.appendChild(host)
          }
        } else if (scene.kind === "animated_marker") {
          const host = element("section", "gv-scene")
          host.appendChild(element("h3", undefined, scene.title))
          const svg = svgElement("svg", {
            viewBox: "0 0 640 180",
            class: "gv-svg",
            role: "img",
            "aria-label": scene.title,
          })
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
          const label =
            value < scene.threshold - epsilon
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
      if (Number.isInteger(focusSpatialSceneIndex)) {
        const spatialView = scenesHost.querySelector(
          `[data-spatial-scene-index="${focusSpatialSceneIndex}"]`,
        )
        if (spatialView) spatialView.focus({ preventScroll: true })
      }
      document.body.dataset.breadboardOverflow = String(
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
    }

    const protocolCommitted = () =>
      definition.controls.some(
        (control) => control.protocolRole === "commit_prediction" && finite(state[control.id]) > 0,
      )

    const syncControlElement = (entry) => {
      if (!entry) return
      const { control, input, readout } = entry
      const value = state[control.id]
      if (control.type === "toggle") {
        input.checked = Boolean(value)
        if (readout) readout.textContent = input.checked ? "On" : "Off"
      } else if (control.type === "select") {
        const lastIndex = Math.max(0, (control.options || []).length - 1)
        input.selectedIndex = Math.max(0, Math.min(lastIndex, Math.round(finite(value))))
        if (readout) readout.textContent = input.value
      } else {
        input.value = String(value)
        if (readout) readout.textContent = `${value}${control.unit ? ` ${control.unit}` : ""}`
      }
    }

    const syncProtocolControls = () => {
      const committed = protocolCommitted()
      controlElements.forEach((entry) => {
        const role = entry.control.protocolRole
        const disabled =
          role === "prediction_input"
            ? committed
            : role === "commit_prediction"
              ? committed
              : role === "reveal_outcome" || role === "evaluate_prediction"
                ? !committed
                : false
        entry.input.disabled = disabled
        entry.input.setAttribute("aria-disabled", String(disabled))
        entry.row.dataset.protocolLocked = String(disabled)
      })
    }

    const protocolMutationAllowed = (control) => {
      const role = control.protocolRole
      if (role === "prediction_input" || role === "commit_prediction") return !protocolCommitted()
      if (role === "reveal_outcome" || role === "evaluate_prediction") return protocolCommitted()
      return true
    }

    const clearProtocolOutcomeState = () => {
      definition.controls.forEach((control) => {
        if (
          control.protocolRole !== "reveal_outcome" &&
          control.protocolRole !== "evaluate_prediction"
        )
          return
        state[control.id] = defaults[control.id]
        syncControlElement(controlElements.get(control.id))
      })
    }

    definition.controls.forEach((control) => {
      const row = element("div", "gv-control")
      const head = element("div", "gv-control-head")
      const label = element("label", undefined, control.label)
      const inputId = `gv-control-${control.id}`
      label.htmlFor = inputId
      head.appendChild(label)
      const defaultReadout =
        control.type === "toggle"
          ? control.defaultValue
            ? "On"
            : "Off"
          : `${control.defaultValue}${control.unit ? ` ${control.unit}` : ""}`
      const readout =
        control.type === "button" ? null : element("span", "gv-readout", defaultReadout)
      if (readout) {
        readout.dataset.controlReadout = control.id
        head.appendChild(readout)
      }
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
          if (!protocolMutationAllowed(control)) {
            syncControlElement(controlElements.get(control.id))
            syncProtocolControls()
            return
          }
          const minimum = finite(control.min, -spatialMaximum)
          const maximum = finite(control.max, spatialMaximum)
          const boundedValue = Math.max(minimum, Math.min(maximum, finite(input.value, minimum)))
          state[control.id] = boundedValue
          input.value = String(boundedValue)
          readout.textContent = `${boundedValue}${control.unit ? ` ${control.unit}` : ""}`
          draw()
          parent.postMessage(
            { type: EVENT, event: "input", controlId: control.id, value: state[control.id] },
            "*",
          )
          syncProtocolControls()
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
          if (!protocolMutationAllowed(control)) {
            syncControlElement(controlElements.get(control.id))
            syncProtocolControls()
            return
          }
          // Expressions are numeric-only. A select exposes the stable
          // zero-based index while retaining its model-authored visible label.
          state[control.id] = input.selectedIndex
          readout.textContent = input.value
          draw()
          parent.postMessage(
            {
              type: EVENT,
              event: "input",
              controlId: control.id,
              value: input.value,
              optionIndex: state[control.id],
            },
            "*",
          )
          syncProtocolControls()
        })
      } else if (control.type === "toggle") {
        input = element("input")
        input.type = "checkbox"
        input.checked = Boolean(control.defaultValue)
        input.addEventListener("change", () => {
          if (control.protocolRole === "reset") {
            resetDefinition()
            return
          }
          if (!protocolMutationAllowed(control)) {
            syncControlElement(controlElements.get(control.id))
            syncProtocolControls()
            return
          }
          if (control.protocolRole === "commit_prediction") clearProtocolOutcomeState()
          state[control.id] = input.checked
          readout.textContent = input.checked ? "On" : "Off"
          draw()
          parent.postMessage(
            { type: EVENT, event: "input", controlId: control.id, value: state[control.id] },
            "*",
          )
          syncProtocolControls()
        })
      } else {
        input = element("button", undefined, control.label)
        input.type = "button"
        input.addEventListener("click", () => {
          if (control.protocolRole === "reset") {
            resetDefinition()
            return
          }
          if (!protocolMutationAllowed(control)) {
            syncControlElement(controlElements.get(control.id))
            syncProtocolControls()
            return
          }
          if (control.protocolRole === "commit_prediction") clearProtocolOutcomeState()
          state[control.id] = finite(state[control.id]) + 1
          draw()
          parent.postMessage(
            { type: EVENT, event: "button", controlId: control.id, value: state[control.id] },
            "*",
          )
          syncProtocolControls()
        })
      }
      input.id = inputId
      input.dataset.controlId = control.id
      if (control.protocolRole) {
        input.dataset.protocolRole = control.protocolRole
        row.dataset.protocolRole = control.protocolRole
      }
      if (control.description) input.setAttribute("aria-description", control.description)
      row.appendChild(input)
      controlsHost.appendChild(row)
      controlElements.set(control.id, { control, input, readout, row })
    })
    syncProtocolControls()

    // Gemini-style hierarchy: authored visual first, then the compact result
    // strip, then the least number of controls needed to explore it.
    app.appendChild(scenesHost)
    app.appendChild(valuesHost)
    app.appendChild(controlsHost)

    const updatePlayPauseButton = () => {
      if (!playPauseButton) return
      setTransportButton(playPauseButton, playing ? "pause" : "play", playing ? "Pause" : "Play")
      playPauseButton.setAttribute("aria-pressed", String(playing))
    }
    const stopAnimation = () => {
      playing = false
      if (animationFrame) cancelAnimationFrame(animationFrame)
      animationFrame = 0
      animationStarted = null
      updatePlayPauseButton()
    }
    const tick = (timestamp) => {
      if (!playing) return
      if (document.hidden) {
        resumeWhenVisible = true
        stopAnimation()
        return
      }
      if (animationStarted === null)
        animationStarted = timestamp - finite(state.t) * definition.animation.durationMs
      const elapsed = timestamp - animationStarted
      state.t = Math.min(1, elapsed / definition.animation.durationMs)
      draw()
      if (state.t >= 1) {
        if (definition.animation.loop) {
          state.t = 0
          animationStarted = timestamp
        } else {
          stopAnimation()
          return
        }
      }
      animationFrame = requestAnimationFrame(tick)
    }
    const startAnimation = () => {
      if (!definition.animation || playing) return
      if (document.hidden) {
        resumeWhenVisible = true
        return
      }
      if (state.t >= 1 && !definition.animation.loop) state.t = 0
      playing = true
      animationStarted = null
      updatePlayPauseButton()
      animationFrame = requestAnimationFrame(tick)
    }
    const syncControlElements = () => {
      controlElements.forEach(syncControlElement)
    }
    const resetDefinition = () => {
      resumeWhenVisible = false
      stopAnimation()
      if (activeSpatialDragCleanup) activeSpatialDragCleanup()
      Object.assign(state, defaults, { x: 0, t: 0 })
      definition.scenes.filter((scene) => scene.kind === "spatial").forEach(resetSpatialCamera)
      syncControlElements()
      syncProtocolControls()
      draw()
    }

    if (definition.animation) {
      playPauseButton = createTransportButton("play-pause", "play", "Play", true)
      playPauseButton.setAttribute("aria-pressed", "false")
      playPauseButton.addEventListener("click", () => {
        resumeWhenVisible = false
        if (playing) stopAnimation()
        else startAnimation()
      })
      const step = createTransportButton("step", "step", "Step")
      step.addEventListener("click", () => {
        resumeWhenVisible = false
        stopAnimation()
        state.t = Math.min(1, finite(state.t) + 0.05)
        draw()
      })
      toolbar.append(playPauseButton, step)
    }
    const reset = createTransportButton("reset", "reset", "Reset")
    reset.addEventListener("click", resetDefinition)
    toolbar.appendChild(reset)

    const onVisibilityChange = () => {
      if (document.hidden && playing) {
        resumeWhenVisible = true
        stopAnimation()
      } else if (!document.hidden && resumeWhenVisible) {
        resumeWhenVisible = false
        startAnimation()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    activeDefinitionCleanup = () => {
      resumeWhenVisible = false
      stopAnimation()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (activeSpatialDragCleanup) activeSpatialDragCleanup()
      activeDefinitionCleanup = null
    }

    root.appendChild(app)
    draw()
    if (
      definition.animation?.autoplay &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !document.hidden
    )
      startAnimation()
    parent.postMessage(
      { type: EVENT, event: "ready", height: document.documentElement.scrollHeight },
      "*",
    )

    if (window.__BREADBOARD_VISUAL_TEST_MODE__) {
      let selfTestsRan = false
      const runSelfTests = () => {
        if (selfTestsRan) return
        selfTestsRan = true
        try {
          let passed = true
          const spatialDomIsValid = () =>
            Array.from(document.querySelectorAll("[data-spatial-host=true]")).every((host) => {
              const svg = host.querySelector("[data-spatial-projection]")
              const primitives = host.querySelectorAll("[data-spatial-kind]")
              const legendItems = host.querySelectorAll("[data-spatial-legend-id]")
              const labels = Array.from(host.querySelectorAll("[data-spatial-label-for]"))
              const labelBoxes = labels.map((label) => label.getBBox())
              const labelsDoNotOverlap = labelBoxes.every((box, index) =>
                labelBoxes.slice(index + 1).every((candidate) => {
                  const overlapWidth = Math.max(
                    0,
                    Math.min(box.x + box.width, candidate.x + candidate.width) -
                      Math.max(box.x, candidate.x),
                  )
                  const overlapHeight = Math.max(
                    0,
                    Math.min(box.y + box.height, candidate.y + candidate.height) -
                      Math.max(box.y, candidate.y),
                  )
                  return overlapWidth * overlapHeight <= 16
                }),
              )
              return (
                Boolean(svg) &&
                ["orthographic", "perspective"].includes(svg.dataset.spatialProjection) &&
                ["fixed", "orbit"].includes(svg.dataset.spatialInteraction) &&
                Boolean(svg.querySelector("desc")) &&
                primitives.length > 0 &&
                legendItems.length === primitives.length &&
                labels.length === primitives.length &&
                labelsDoNotOverlap &&
                Array.from(primitives).every(
                  (node) =>
                    Boolean(node.getAttribute("aria-label")) &&
                    node.getAttribute("tabindex") === "0",
                )
              )
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
          const resetButton = document.querySelector("[data-action=reset]")
          if (resetButton) resetButton.click()
          if (!spatialDomIsValid()) passed = false
          document.querySelectorAll("[data-control-id]").forEach((node) => {
            const control = definition.controls.find(
              (candidate) => candidate.id === node.dataset.controlId,
            )
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
    if (!message) return
    if (message.type === THEME) {
      const theme = message.theme === "dark" ? "dark" : "light"
      document.documentElement.dataset.theme = theme
      document.dispatchEvent(new CustomEvent("breadboard:themechange", { detail: { theme } }))
      return
    }
    if (message.type !== INIT || !message.definition) return
    try {
      renderDefinition(message.definition, message.theme, message.language)
    } catch (error) {
      document.body.dataset.breadboardRuntimeTests = "failed"
      parent.postMessage(
        {
          type: EVENT,
          event: "runtime-error",
          message: error instanceof Error ? error.message : "render failed",
        },
        "*",
      )
    }
  })
})()
