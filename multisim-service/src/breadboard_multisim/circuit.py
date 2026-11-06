"""Editable, versioned circuit IR and deterministic SPICE compilation."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Literal

from multisim_mcp.safety import validate_spice_netlist
from pydantic import BaseModel, ConfigDict, Field, model_validator

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
NODE = re.compile(r"^(?:0|[A-Za-z_][A-Za-z0-9_]*)$")
NUMBER = re.compile(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|[tgkmunpf])?$", re.IGNORECASE)
SCALES = {
    "": 1,
    "t": 1e12,
    "g": 1e9,
    "meg": 1e6,
    "k": 1e3,
    "m": 1e-3,
    "u": 1e-6,
    "n": 1e-9,
    "p": 1e-12,
    "f": 1e-15,
}
PINS = {
    "resistor": 2,
    "capacitor": 2,
    "inductor": 2,
    "diode": 2,
    "bjt": 3,
    "mosfet": 4,
    "opamp": 5,
    "voltage_source": 2,
    "current_source": 2,
}
PREFIX = {
    "resistor": "R",
    "capacitor": "C",
    "inductor": "L",
    "diode": "D",
    "bjt": "Q",
    "mosfet": "M",
    "opamp": "X",
    "ic": "X",
    "voltage_source": "V",
    "current_source": "I",
}


def number(value: str | float) -> float:
    if isinstance(value, bool):
        raise ValueError("Boolean is not a SPICE number")  # noqa: TRY004 - pydantic validator contract
    match = NUMBER.fullmatch(str(value).strip())
    if not match:
        raise ValueError(
            f"Invalid SPICE value {value!r}; use 10k, 1u, 1meg or SI numeric values (M is milli)"
        )
    result = float(match[1]) * SCALES[(match[2] or "").lower()]
    if not math.isfinite(result):
        raise ValueError("SPICE value must be finite")
    return result


def node_name(value: str) -> str:
    if value.lower() in {"gnd", "ground", "0"}:
        return "0"
    if not NODE.fullmatch(value):
        raise ValueError(f"Invalid node {value!r}; use letters, numbers, underscores")
    return value.lower()


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Component(Record):
    id: str = Field(description="SPICE identifier with the correct prefix: resistor R, capacitor C, inductor L, diode D, BJT Q, MOSFET M, opamp/IC X, voltage source V, current source I.")
    type: Literal[
        "resistor",
        "capacitor",
        "inductor",
        "diode",
        "bjt",
        "mosfet",
        "opamp",
        "voltage_source",
        "current_source",
        "ic",
    ]
    value: str | float = Field(default="0", description="Numeric SI value or SPICE suffix (10k, 1n, 1meg; M means milli). For sources this is the DC value; place PULSE/SIN/PWL in waveform instead.")
    nodes: list[str] = Field(default_factory=list, description="Ordered SPICE pins: opamp [plus, minus, positive_supply, negative_supply, output]; BJT [collector, base, emitter]; MOSFET [drain, gate, source, bulk]; diode [anode, cathode]; sources [positive, negative]. IC follows its declared subcircuit. Ground is 0. Use either nodes or explicit connections.")
    model: str | None = Field(default=None, description="Name of an inline model. Required for diode/BJT/MOSFET/IC. Omit for the built-in educational BB_OPAMP (A0=100000, GBW=10MHz, rail limiting; no noise, slew or current limits).")
    pin_count: int | None = Field(default=None, ge=2, le=64)
    parameters: dict[str, str | float] = Field(default_factory=dict)
    ac: float | None = None
    ac_phase: float = 0
    waveform: str | None = Field(default=None, description="Independent-source waveform: numeric PULSE(initial peak delay rise fall width period), SIN(offset amplitude frequency), or PWL(time value ...). For oscillator startup prefer a single finite PWL impulse, not a sustained periodic drive.")
    tolerance: float = Field(default=0, ge=0, lt=1)

    @model_validator(mode="after")
    def validate_component(self):
        if not IDENTIFIER.fullmatch(self.id) or not self.id.upper().startswith(PREFIX[self.type]):
            raise ValueError(f"{self.type} id must start with {PREFIX[self.type]} and be a SPICE identifier")
        if self.model and not IDENTIFIER.fullmatch(self.model):
            raise ValueError("Invalid model identifier")
        if self.type in {"diode", "bjt", "mosfet", "ic"} and not self.model:
            raise ValueError(f"{self.id} requires an explicit model")
        if self.type == "ic" and self.pin_count is None:
            raise ValueError("IC models require explicit pin_count and ordered model pins")
        if self.nodes and len(self.nodes) != self.pins:
            raise ValueError(f"{self.id} requires {self.pins} nodes")
        self.nodes = [node_name(node) for node in self.nodes]
        if self.type in {"resistor", "capacitor", "inductor", "voltage_source", "current_source"}:
            numeric = number(self.value)
            if self.type in {"resistor", "capacitor", "inductor"} and numeric <= 0:
                raise ValueError("Passive component values must be positive")
        elif self.tolerance:
            raise ValueError(
                "Scalar tolerances apply to R/C/L and sources; sweep model-instance parameters for other devices"
            )
        if self.ac is not None and (self.type not in {"voltage_source", "current_source"} or self.ac < 0):
            raise ValueError("AC amplitude applies to sources and must be nonnegative")
        if self.waveform:
            if self.type not in {"voltage_source", "current_source"}:
                raise ValueError("Waveform applies only to independent sources")
            match = re.fullmatch(r"(PULSE|SIN|PWL)\(([^()]*)\)", self.waveform, re.IGNORECASE)
            if not match:
                raise ValueError("Use numeric PULSE(...), SIN(...) or PWL(...) waveform")
            values = [number(v) for v in match[2].replace(",", " ").split()]
            kind = match[1].upper()
            if (kind == "PULSE" and len(values) != 7) or (kind == "SIN" and not 3 <= len(values) <= 6):
                raise ValueError("PULSE requires 7 values; SIN requires 3 to 6")
            if kind == "PWL" and (
                len(values) < 4 or len(values) % 2 or any(b <= a for a, b in zip(values[::2], values[2::2]))
            ):
                raise ValueError("PWL requires ordered time/value pairs")
        for key, value in self.parameters.items():
            if not IDENTIFIER.fullmatch(key):
                raise ValueError("Invalid parameter identifier")
            number(value)
        return self

    @property
    def pins(self) -> int:
        return self.pin_count if self.type == "ic" else PINS[self.type]


class Model(Record):
    name: str
    definition: str
    provenance: str

    @model_validator(mode="after")
    def validate_definition(self):
        if not IDENTIFIER.fullmatch(self.name) or not self.provenance.strip():
            raise ValueError("Models require a valid name and provenance")
        text = self.definition.strip()
        if not re.match(r"\.(model|subckt)\s+" + re.escape(self.name) + r"\s", text, re.IGNORECASE):
            raise ValueError("Model definition must start with its named .model or .subckt")
        validate_spice_netlist("* Model validation\n" + text + "\n.end\n")
        directives = [
            line.strip().split()[0].lower() for line in text.splitlines() if line.strip().startswith(".")
        ]
        if any(d not in {".model", ".subckt", ".ends", ".param", ".func"} for d in directives):
            raise ValueError("Model may contain only model/subcircuit/parameter/function declarations")
        if text.lower().startswith(".model") and any(
            not line.lstrip().startswith(("+", "*")) for line in text.splitlines()[1:] if line.strip()
        ):
            raise ValueError("A .model record may only have continuation/comment lines")
        if text.lower().startswith(".subckt") and directives.count(".subckt") != directives.count(".ends"):
            raise ValueError("Unbalanced subcircuit definition")
        return self


OPAMP = Model(
    name="BB_OPAMP",
    provenance="Breadboard educational single-pole model; no intrinsic noise, slew or current limit",
    definition=""".subckt BB_OPAMP plus minus vp vn out params: A0=100000 GBW=10000000
Eopen pole_in 0 plus minus {A0}
Rdominant pole_in pole 1k
Cdominant pole 0 {A0/(6.283185307179586*GBW*1000)}
Blimit out 0 V=min(max(V(pole),V(vn)+0.1),V(vp)-0.1)
.ends BB_OPAMP""",
)


class Circuit(Record):
    schema_version: Literal[1] = 1
    title: str = Field(default="Circuit", max_length=200)
    components: list[Component] = Field(default_factory=list, max_length=500)
    connections: list[tuple[str, str]] = Field(default_factory=list, max_length=5000)
    models: list[Model] = Field(default_factory=list, max_length=100)
    temperature: float = Field(default=27, ge=-200, le=300)
    assumptions: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_ids(self):
        for values, kind in (
            ([c.id.lower() for c in self.components], "component"),
            ([m.name.lower() for m in self.models], "model"),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate {kind} identifier (SPICE is case-insensitive)")
        if "\n" in self.title or "\r" in self.title:
            raise ValueError("Title must be one line")
        self.resolved_nodes(require_complete=False)
        return self

    def component(self, ref: str) -> Component:
        for component in self.components:
            if component.id.lower() == ref.lower():
                return component
        raise ValueError(f"Unknown component {ref}")

    def resolved_nodes(self, require_complete=True) -> dict[str, list[str]]:
        parent: dict[str, str] = {}

        def find(x):
            parent.setdefault(x, x)
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]

        def endpoint(text):
            if "." not in text:
                return node_name(text)
            ref, pin = text.rsplit(".", 1)
            c = self.component(ref)
            if not pin.isdigit() or not 1 <= int(pin) <= c.pins:
                raise ValueError(f"Unknown pin {text}")
            return f"{c.id.lower()}.{int(pin)}"

        edges = list(self.connections)
        for c in self.components:
            edges.extend((f"{c.id}.{i}", node) for i, node in enumerate(c.nodes, 1))
        for a, b in edges:
            a, b = endpoint(a), endpoint(b)
            parent[find(a)] = find(b)
        groups: dict[str, list[str]] = {}
        for key in list(parent):
            groups.setdefault(find(key), []).append(key)
        names = {}
        allocated = {key for key in parent if "." not in key}
        for index, group in enumerate(sorted(groups.values()), 1):
            labels = sorted(key for key in group if "." not in key)
            # Never silently short two differently labelled nets.
            if len(labels) > 1:
                raise ValueError(f"Connection shorts distinct nets: {labels}")
            generated = f"bb_net_{index}"
            while generated in allocated:
                generated += "_auto"
            allocated.add(generated)
            for key in group:
                names[key] = labels[0] if labels else generated
        result = {}
        for c in self.components:
            keys = [f"{c.id.lower()}.{i}" for i in range(1, c.pins + 1)]
            missing = [key for key in keys if key not in names]
            if missing and require_complete:
                raise ValueError(f"Unconnected pins: {missing}")
            result[c.id] = [names.get(key, f"unconnected_{key.replace('.', '_')}") for key in keys]
        return result

    def netlist(self) -> str:
        if not self.components:
            raise ValueError("Circuit is empty")
        nodes = self.resolved_nodes()
        if not any("0" in ns for ns in nodes.values()):
            raise ValueError("Circuit needs a ground reference")
        model_names = {m.name.lower() for m in self.models}
        models = list(self.models)
        if any(c.type == "opamp" and not c.model for c in self.components):
            if OPAMP.name.lower() in model_names:
                raise ValueError("BB_OPAMP is reserved for the built-in model")
            models.append(OPAMP)
        lines = [f"* {self.title}", f".temp {self.temperature:g}"]
        for c in self.components:
            tail = ""
            if c.type in {"resistor", "capacitor", "inductor"}:
                tail = str(c.value)
            elif c.type in {"voltage_source", "current_source"}:
                tail = f"DC {c.value}"
                if c.ac is not None:
                    tail += f" AC {c.ac:g} {c.ac_phase:g}"
                if c.waveform:
                    tail += " " + c.waveform
            else:
                tail = c.model or "BB_OPAMP"
                if c.model and c.model.lower() not in model_names:
                    raise ValueError(f"Missing inline model {c.model} for {c.id}")
            params = " ".join(f"{key}={value}" for key, value in sorted(c.parameters.items()))
            lines.append(" ".join([c.id, *nodes[c.id], tail, params]).strip())
        lines.extend(m.definition.strip() for m in models)
        lines.append(".end")
        text = "\n".join(lines) + "\n"
        validate_spice_netlist(text)
        return text

    def digest(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
