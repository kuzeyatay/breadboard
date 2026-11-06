"""Isolate upstream template selection from concurrent circuit service requests."""
import ast
import json
import math
import operator
import re
import sys
from pathlib import Path

from multisim_mcp import schematic_builder as builder
from multisim_mcp.native_xml import parse_native_xml


def constant_arithmetic(text):
    """Resolve only bounded numeric arithmetic; SPICE functions remain untouched."""
    def substitute(match):
        expression = match[1]
        if len(expression) > 256:
            return match[0]
        try:
            tree = ast.parse(expression, mode="eval")
            if sum(1 for _ in ast.walk(tree)) > 64:
                return match[0]
            def evaluate(node):
                if isinstance(node, ast.Constant) and type(node.value) in {int, float}:
                    return float(node.value)
                if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                    return evaluate(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
                operations = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
                if isinstance(node, ast.BinOp) and type(node.op) in operations:
                    return operations[type(node.op)](evaluate(node.left), evaluate(node.right))
                raise ValueError("Not constant arithmetic")
            value = evaluate(tree.body)
            return format(value, ".17g") if math.isfinite(value) else match[0]
        except (ValueError, SyntaxError, ArithmeticError, RecursionError):
            return match[0]
    return re.sub(r"\{([^{}]+)\}", substitute, text)


def validate_xml_connections(path, specs):
    """Read stored object references back independently of the routing report."""
    root = parse_native_xml(path).getroot()
    nodes, ports, components = {}, {}, {}
    for item in root.iter("Item"):
        node, port, component = item.find("CiNode"), item.find("CiPort"), item.find("CiComponent")
        if node is not None:
            nodes[item.get("CiID")] = node
        if port is not None:
            ports[item.get("CiID")] = port
        if component is not None:
            ref = component.get("LocalName", "").removeprefix("&ASC")
            if ref in components:
                raise ValueError(f"Multisim XML contains duplicate component {ref}")
            components[ref] = (item.get("CiID"), component)
    expected = {s.refdes: s.nodes for s in specs}
    if any("0" in s.nodes for s in specs):
        expected["0"] = ["0"]
    if set(components) != set(expected):
        raise ValueError("Multisim XML component inventory differs from the circuit")
    count = 0
    for ref, expected_nodes in expected.items():
        component_id, component = components[ref]
        actual_nodes = []
        for link in component.findall("./Ports/Item"):
            port_id = link.get("CiID")
            port = ports.get(port_id)
            if port is None or port.get("Component") != component_id:
                raise ValueError(f"Multisim XML has a broken pin reference on {ref}")
            targets = port.findall("./Nodes/Item")
            if len(targets) != 1 or targets[0].get("CiID") not in nodes:
                raise ValueError(f"Multisim XML has a disconnected pin on {ref}")
            node = nodes[targets[0].get("CiID")]
            if port_id not in {p.get("CiID") for p in node.findall("./Ports/Item")}:
                raise ValueError(f"Multisim XML has a nonreciprocal pin connection on {ref}")
            actual_nodes.append(node.get("LocalName", "").removeprefix("&ASC"))
        if actual_nodes != expected_nodes:
            raise ValueError(f"Multisim XML pin order differs on {ref}")
        count += len(actual_nodes)
    return {"status": "verified", "components": len(components), "pins": count}


def main():
    directory = Path(sys.argv[1])
    netlist = json.load(sys.stdin)["netlist"]
    # Preserve parameterized models as editable primitives, never ideal carriers.
    original = builder._substitute_parameters
    builder._substitute_parameters = lambda text, parameters: constant_arithmetic(original(text, parameters))
    parsed = builder.parse_netlist(netlist)
    if parsed.unsupported:
        raise ValueError("Multisim cannot export these statements: " + "; ".join(parsed.unsupported[:8]))
    if parsed.subcircuit_expansion_failures:
        raise ValueError("Multisim cannot preserve these inline subcircuits: " +
                         str(parsed.subcircuit_expansion_failures)[:2000])
    result = builder.build_schematic(netlist, directory / "circuit.ms14.xml", probe_nets=[])
    if result.get("unsupported") or result.get("subcircuit_expansion_failures"):
        raise ValueError("Multisim generator could not preserve all components/models")
    if result["layout_validation"]["status"] != "pass":
        raise ValueError("Multisim layout validation failed: " + str(result["layout_validation"]["findings"])[:2000])
    result["xml_connectivity"] = validate_xml_connections(directory / "circuit.ms14.xml", parsed.components)
    result.pop("xml", None)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
