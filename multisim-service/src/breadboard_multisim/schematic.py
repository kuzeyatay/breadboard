"""Connected schematics and portable Breadboard projects, derived from circuit IR.

Orthogonal paths route around symbols. Nets never share wire segments; crossings
have a bridge gap. Ground/power rails use ordinary global labels. No AI drawing,
external renderer or alternate electrical model is involved.
"""

from __future__ import annotations

import heapq
import html
import json
import math
from collections import Counter, defaultdict
from itertools import pairwise
from pathlib import Path

GRID = 12
SCHEMA = "breadboard.circuit-project/v1"
COLORS = ("#2563eb", "#c2410c", "#0f766e", "#9333ea", "#be185d", "#4d7c0f", "#0369a1")


def pin_offsets(component):
    if component.type == "opamp":
        return [(-60, -24), (-60, 24), (0, -60), (0, 60), (72, 0)]
    if component.type in {"bjt", "mosfet"}:
        return [(36, -60), (-60, 0), (36, 60), (60, 0)][: component.pins]
    if component.pins == 2:
        return [(-48, 0), (48, 0)]
    half = math.ceil(component.pins / 2)
    return [(-72 if i < half else 72, ((i % half) - (half - 1) / 2) * 24) for i in range(component.pins)]


def pin_names(component):
    return {
        "opamp": ["+", "−", "V+", "V−", "OUT"],
        "bjt": ["C", "B", "E"],
        "mosfet": ["D", "G", "S", "B"],
        "diode": ["A", "K"],
    }.get(component.type, [str(i + 1) for i in range(component.pins)])


def connected_layout(circuit):
    if len(circuit.components) > 200 or sum(c.pins for c in circuit.components) > 1200:
        raise ValueError("Connected schematic export supports up to 200 components / 1200 pins per project")
    resolved = circuit.resolved_nodes()
    columns = max(1, min(4, math.ceil(math.sqrt(len(circuit.components)))))
    # Keep adjacent declarations close: authors normally declare functional blocks
    # together, and this also keeps the drawing deterministic across revisions.
    placements, pins, obstacles = {}, defaultdict(list), set()
    y = 192
    for start in range(0, len(circuit.components), columns):
        row = circuit.components[start : start + columns]
        row_height = max(288, *(math.ceil(c.pins / 2) * 24 + 168 for c in row))
        for column, c in enumerate(row):
            x, cy = 180 + column * 360, y + (row_height - 288) // 2
            placements[c.id] = {"x": x, "y": cy, "rotation": 0}
            half_height = max(48, math.ceil(c.pins / 2) * 12 if c.type == "ic" else 48)
            # Body + reference/value label. Pins lie outside the body obstruction.
            for gx in range((x - 48) // GRID, (x + 48) // GRID + 1):
                for gy in range(int((cy - half_height) // GRID), int((cy + half_height) // GRID) + 1):
                    obstacles.add((gx, gy))
            for gx in range((x - 84) // GRID, (x + 84) // GRID + 1):
                for gy in range(
                    int((cy - half_height - 48) // GRID), int((cy - half_height - 24) // GRID) + 1
                ):
                    obstacles.add((gx, gy))
            for index, ((dx, dy), node) in enumerate(zip(pin_offsets(c), resolved[c.id])):
                pins[node].append({"component": c.id, "pin": index + 1, "x": x + dx, "y": cy + dy})
        y += row_height
    width, height = columns * 360 + 24, y
    global_nets = {"0"}
    for c in circuit.components:
        if c.type == "voltage_source" and c.id.upper() in {"VCC", "VEE", "VDD", "VSS"} and not c.waveform:
            global_nets.update(resolved[c.id])
    all_pin_points = {(int(p["x"] / GRID), int(p["y"] / GRID)) for group in pins.values() for p in group}
    # Every terminal is a legal endpoint; routing through unrelated terminals is not.
    obstacles -= all_pin_points
    edges, vertices, wires, issues = {}, defaultdict(set), [], []

    def route(a, b, net):
        origin, target = (int(a["x"] / GRID), int(a["y"] / GRID)), (int(b["x"] / GRID), int(b["y"] / GRID))
        allowed = {(int(p["x"] / GRID), int(p["y"] / GRID)) for p in pins[net]}
        queue = [(0, 0, origin, -1)]
        distances, parents = {(origin, -1): 0}, {}
        end = None
        while queue and len(distances) < 120_000:
            _, cost, point, direction = heapq.heappop(queue)
            state = (point, direction)
            if cost != distances.get(state):
                continue
            if point == target:
                end = state
                break
            for next_dir, (dx, dy) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
                nxt = (point[0] + dx, point[1] + dy)
                if not (1 <= nxt[0] < width // GRID and 2 <= nxt[1] < height // GRID):
                    continue
                if nxt in obstacles or (nxt in all_pin_points and nxt not in allowed):
                    continue
                edge = tuple(sorted((point, nxt)))
                if edge in edges and edges[edge] != net:
                    continue
                # A foreign crossing must be straight, never a bend/junction.
                if vertices[point] - {net} and direction != next_dir:
                    continue
                new_cost = cost + 1 + (3 if direction >= 0 and direction != next_dir else 0)
                new_cost += 6 if vertices[nxt] - {net} else 0
                next_state = (nxt, next_dir)
                if new_cost < distances.get(next_state, float("inf")):
                    distances[next_state] = new_cost
                    parents[next_state] = state
                    heuristic = abs(nxt[0] - target[0]) + abs(nxt[1] - target[1])
                    heapq.heappush(queue, (new_cost + heuristic, new_cost, nxt, next_dir))
        if end is None:
            return None
        points = [end[0]]
        while end in parents:
            end = parents[end]
            points.append(end[0])
        points.reverse()
        for p, q in pairwise(points):
            edges[tuple(sorted((p, q)))] = net
            vertices[p].add(net)
            vertices[q].add(net)
        simplified = [points[0]]
        for i in range(1, len(points) - 1):
            if (points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) != (
                points[i + 1][0] - points[i][0],
                points[i + 1][1] - points[i][1],
            ):
                simplified.append(points[i])
        simplified.append(points[-1])
        return [[p[0] * GRID, p[1] * GRID] for p in simplified]

    for net, members in sorted(pins.items(), key=lambda item: (len(item[1]), item[0])):
        if net in global_nets or len(members) < 2:
            continue
        tree, pending = [members[0]], members[1:]
        while pending:
            a, b = min(
                ((a, b) for a in tree for b in pending),
                key=lambda pair: abs(pair[0]["x"] - pair[1]["x"]) + abs(pair[0]["y"] - pair[1]["y"]),
            )
            points = route(a, b, net)
            if points is None:
                issues.append(
                    f"Could not route {net}: {a['component']}.{a['pin']} to {b['component']}.{b['pin']}"
                )
            else:
                wires.append(
                    {
                        "net": net,
                        "from": [a["component"], a["pin"]],
                        "to": [b["component"], b["pin"]],
                        "points": points,
                    }
                )
            tree.append(b)
            pending.remove(b)
    junctions = []
    degree = defaultdict(set)
    for (p, q), net in edges.items():
        degree[(net, p)].add(q)
        degree[(net, q)].add(p)
    for (net, point), adjacent in degree.items():
        if len(adjacent) >= 3:
            junctions.append({"net": net, "x": point[0] * GRID, "y": point[1] * GRID})
    return {
        "width": width,
        "height": height,
        "positions": placements,
        "wires": wires,
        "junctions": junctions,
        "global_nets": sorted(global_nets),
        "issues": issues,
        "pin_count": sum(len(p) for p in pins.values()),
        "connected": not issues,
    }


def svg_text(circuit, scene):
    esc = lambda value: html.escape(str(value), quote=True)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {scene["width"]} {scene["height"]}" width="{scene["width"]}" height="{scene["height"]}" role="img">',
        f"<title>{esc(circuit.title)} — connected schematic</title>",
        '<rect width="100%" height="100%" fill="white"/>',
        "<style>text{font-family:Arial,sans-serif;fill:#172033;font-size:12px}.body{fill:white;stroke:#172033;stroke-width:2}.lead{fill:none;stroke:#172033;stroke-width:2}</style>",
        f'<text x="24" y="28" style="font-size:18px;font-weight:bold">{esc(circuit.title)}</text>',
        '<text x="24" y="49">Solid wires connect signal pins. Dots are junctions; bridge gaps are crossings. Labeled ground/supply rails are common.</text>',
    ]
    color = {net: COLORS[i % len(COLORS)] for i, net in enumerate(sorted({w["net"] for w in scene["wires"]}))}
    for wire in scene["wires"]:
        coords = " ".join(f"{x},{y}" for x, y in wire["points"])
        parts.append(
            f'<g data-net="{esc(wire["net"])}"><polyline points="{coords}" fill="none" stroke="white" stroke-width="7"/><polyline points="{coords}" fill="none" stroke="{color[wire["net"]]}" stroke-width="2"/></g>'
        )
    for dot in scene["junctions"]:
        parts.append(f'<circle cx="{dot["x"]}" cy="{dot["y"]}" r="3.5" fill="{color[dot["net"]]}"/>')
    resolved = circuit.resolved_nodes()
    for c in circuit.components:
        p = scene["positions"][c.id]
        parts.append(
            f'<g data-component="{esc(c.id)}" transform="translate({p["x"]} {p["y"]})"><title>{esc(c.id)}: {esc(c.value)} {esc(c.model or "")}</title>'
        )
        if c.type == "opamp":
            parts.append(
                '<path class="body" d="M-36 -48 L48 0 L-36 48 Z"/><path class="lead" d="M-60 -24 H-36 M-60 24 H-36 M48 0 H72 M0 -60 V-28 M0 60 V28"/><text x="-29" y="-18">+</text><text x="-29" y="29">−</text>'
            )
        elif c.pins == 2:
            parts.append('<path class="lead" d="M-48 0 H-24 M24 0 H48"/>')
            if c.type == "resistor":
                parts.append('<path class="lead" d="M-24 0 L-20 -8 -12 8 -4 -8 4 8 12 -8 20 8 24 0"/>')
            elif c.type == "capacitor":
                parts.append('<path class="lead" d="M-24 0 H-6 M6 0 H24 M-6 -18 V18 M6 -18 V18"/>')
            elif c.type == "inductor":
                parts.append(
                    '<path class="lead" d="M-24 0 A8 10 0 0 1 -8 0 A8 10 0 0 1 8 0 A8 10 0 0 1 24 0"/>'
                )
            elif c.type == "diode":
                parts.append(
                    '<path class="lead" d="M-24 0 H-15 M15 0 H24 M-15 -17 L15 0 -15 17 Z M15 -17 V17"/>'
                )
            else:
                parts.append(
                    '<circle class="body" r="24"/>'
                    + (
                        '<path class="lead" d="M-12 0 H12 M5 -6 L12 0 5 6"/>'
                        if c.type == "current_source"
                        else '<text x="-16" y="4">+ −</text>'
                    )
                )
        else:
            half = max(36, math.ceil(c.pins / 2) * 12)
            parts.append(f'<rect class="body" x="-36" y="{-half}" width="72" height="{2 * half}" rx="4"/>')
            for (dx, dy), name in zip(pin_offsets(c), pin_names(c)):
                side = -36 if dx < 0 else 36
                parts.append(
                    f'<path class="lead" d="M{dx} {dy} H{side}"/><text x="{side + (5 if dx < 0 else -5)}" y="{dy - 5}" text-anchor="{"start" if dx < 0 else "end"}">{esc(name)}</text>'
                )
        label_y = -max(96, math.ceil(c.pins / 2) * 12 + 48 if c.type == "ic" else 96)
        label = (
            str(c.value)
            if c.type in {"resistor", "capacitor", "inductor", "voltage_source", "current_source"}
            else c.model or "BB_OPAMP"
        )
        parts.append(
            f'<text x="0" y="{label_y}" text-anchor="middle" font-weight="bold">{esc(c.id)}</text><text x="0" y="{label_y + 16}" text-anchor="middle">{esc(label[:42])}</text>'
        )
        for index, ((dx, dy), node) in enumerate(zip(pin_offsets(c), resolved[c.id])):
            parts.append(
                f'<circle data-pin="{index + 1}" cx="{dx}" cy="{dy}" r="3" fill="#172033"/><text x="{dx + (-6 if dx < 0 else 6)}" y="{dy - 8}" text-anchor="{"end" if dx < 0 else "start"}" style="font-size:10px">{esc(node)}</text>'
            )
            if node == "0":
                parts.append(f'<path class="lead" d="M{dx} {dy} v12 m-9 0 h18 m-15 5 h12 m-9 5 h6"/>')
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


def project(circuit):
    scene = connected_layout(circuit)
    counts = Counter(c.type for c in circuit.components)
    counts["components"] = len(circuit.components)
    nodes = Counter(n for group in circuit.resolved_nodes().values() for n in group)
    warnings = [
        f"Node {n} has only one external terminal; check whether it is intentionally unused."
        for n, count in nodes.items()
        if n != "0" and count == 1
    ]
    if any(c.type == "opamp" and not c.model for c in circuit.components):
        warnings.append(
            "BB_OPAMP is an educational model. Real-device noise, slew, output current and hardware behavior are unverified."
        )
    return {
        "schema": SCHEMA,
        "title": circuit.title,
        "circuit_sha256": circuit.digest(),
        "circuit": circuit.model_dump(),
        "netlist": circuit.netlist(),
        "schematic": scene,
        "review": {
            "component_counts": dict(counts),
            "warnings": warnings,
            "simulation_status": "not_run_by_export",
            "hardware_status": "unverified",
        },
    }


def export_project(circuit, directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    data = project(circuit)
    if not data["schematic"]["connected"]:
        raise ValueError("Connected schematic incomplete: " + "; ".join(data["schematic"]["issues"][:4]))
    path = directory / "circuit.bbcir"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    # A simulator run may already own circuit.cir, including its control block.
    # Never replace that evidence with the analysis-independent design deck.
    (directory / "design.cir").write_text(data["netlist"], encoding="utf-8")
    (directory / "design.json").write_text(json.dumps(data["circuit"], indent=2) + "\n", encoding="utf-8")
    svg = svg_text(circuit, data["schematic"])
    (directory / "schematic.svg").write_text(svg, encoding="utf-8")
    # HTML remains viewable in existing Breadboard builds and ordinary browsers.
    # It is self-contained: no remote scripts, models, fonts or fetch requests.
    review = "<details><summary>Design review — export does not verify performance</summary><p>"
    review += html.escape(json.dumps(data["review"]["component_counts"])) + "</p><ul>"
    review += "".join("<li>" + html.escape(warning) + "</li>" for warning in data["review"]["warnings"])
    review += "</ul><p>Simulation was not run by this export. Hardware is unverified.</p></details>"
    page = (
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'
        + html.escape(circuit.title)
        + "</title><style>body{margin:0;background:#f4f6fa;color:#172033;font:15px system-ui}header{position:sticky;top:0;background:white;padding:14px 24px;border-bottom:1px solid #ddd}main{padding:20px;overflow:auto}svg{background:white}button{padding:7px 14px;margin-right:8px}p{margin:6px 0}</style><header><strong>"
        + html.escape(circuit.title)
        + "</strong><p>Connected circuit • "
        + str(len(circuit.components))
        + ' components • Scroll to inspect the full drawing.</p><p>Ground and supply labels are common nets. Download the accompanying .bbcir artifact for editable circuit data.</p>'
        + review
        + "</header><main>"
        + svg
        + "</main>"
    )
    encoded = json.dumps(data).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    page += (
        '<script type="application/json" id="project">'
        + encoded
        + '</script>'
    )
    (directory / "schematic.html").write_text(page, encoding="utf-8")
    return data, [
        str(directory / name)
        for name in ("circuit.bbcir", "design.cir", "design.json", "schematic.svg", "schematic.html")
    ]
