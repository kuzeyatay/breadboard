(() => {
  "use strict"

  const ROOT_ID = "breadboard-generated-visual-root"
  const INIT = "breadboard-generated-visual:init"
  const EVENT = "breadboard-generated-visual:event"
  const SVG_NS = "http://www.w3.org/2000/svg"
  let diagramCounter = 0

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
    :root { color-scheme: light dark; --bg:#fbfaf5; --panel:#f1f5ee; --line:#b7cdc0; --ink:#10251c; --muted:#5d6c65; --accent:#2f7d55; --accent-soft:#cce7d7; }
    :root[data-theme="dark"] { --bg:#18181a; --panel:#20211f; --line:#353d37; --ink:#e6ebe5; --muted:#a5aea5; --accent:#91b7a1; --accent-soft:#253832; }
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
      state[control.id] = control.defaultValue
      defaults[control.id] = control.defaultValue
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
            state[control.id] = input.value
            readout.textContent = input.value
            draw()
            parent.postMessage({ type: EVENT, event: "input", controlId: control.id, value: state[control.id] }, "*")
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
        document.querySelectorAll("[data-output-finite]").forEach((node) => {
          if (node.dataset.outputFinite !== "true") passed = false
        })
        const resetButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Reset")
        if (resetButton) resetButton.click()
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
