"use client";

// Drawing one part in the wiring view.
//
// Parts that Wokwi Elements covers are drawn by the real element, loaded on the
// client only (they are custom elements and cannot be server-rendered). Parts it
// does not cover fall back to a clearly labelled SVG of the same size, so the
// pin anchors — which are source-controlled either way — still land in the right
// place and the electrical data behind them is unchanged.

import { createElement, useEffect, useState } from "react";
import type { ComponentDefinition } from "@/lib/hardware/types";

let elementsPromise: Promise<boolean> | null = null;

function loadWokwiElements(): Promise<boolean> {
  if (!elementsPromise) {
    elementsPromise = import("@wokwi/elements")
      .then(() => true)
      .catch(() => false);
  }
  return elementsPromise;
}

function useWokwiElements(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadWokwiElements().then((loaded) => {
      if (active && loaded) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return ready;
}

const BODY = "#e9e3d8";
const EDGE = "#8d8579";

function GenericBoard({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  const anchors = Object.entries(definition.visual.pinAnchors);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect
        x="1"
        y="1"
        width={width - 2}
        height={height - 2}
        rx="8"
        className="fill-[#1f6f43] dark:fill-[#17492f]"
        stroke={EDGE}
      />
      <text
        x={width / 2}
        y={16}
        textAnchor="middle"
        fontSize="10"
        fill="#f4f1ea"
        fontFamily="ui-sans-serif, system-ui"
      >
        {definition.name.slice(0, 22)}
      </text>
      {anchors.map(([pinId, anchor]) => (
        <g key={pinId}>
          <circle cx={anchor.x} cy={anchor.y} r="3" fill="#f0c419" stroke="#7a6410" />
          <text
            x={anchor.x < width / 2 ? anchor.x + 7 : anchor.x - 7}
            y={anchor.y + 3}
            textAnchor={anchor.x < width / 2 ? "start" : "end"}
            fontSize="7"
            fill="#f4f1ea"
            fontFamily="ui-monospace, monospace"
          >
            {definition.pins.find((pin) => pin.id === pinId)?.label ?? pinId}
          </text>
        </g>
      ))}
    </svg>
  );
}

function GenericModule({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect
        x="1"
        y="1"
        width={width - 2}
        height={height - 2}
        rx="5"
        className="fill-[#2c5d8f] dark:fill-[#1d3f61]"
        stroke={EDGE}
      />
      <text
        x={width / 2}
        y={height / 2 - 2}
        textAnchor="middle"
        fontSize="10"
        fill="#f4f1ea"
        fontFamily="ui-sans-serif, system-ui"
      >
        {definition.id.toUpperCase().slice(0, 16)}
      </text>
      {Object.entries(definition.visual.pinAnchors).map(([pinId, anchor]) => (
        <g key={pinId}>
          <circle cx={anchor.x} cy={anchor.y} r="2.6" fill="#f0c419" stroke="#7a6410" />
          <text
            x={anchor.x}
            y={anchor.y - 5}
            textAnchor="middle"
            fontSize="6.5"
            fill="#f4f1ea"
            fontFamily="ui-monospace, monospace"
          >
            {definition.pins.find((pin) => pin.id === pinId)?.label.split(" ")[0] ?? pinId}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Breadboard({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  const columns = Math.floor((width - 40) / 10);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect x="0" y="0" width={width} height={height} rx="6" fill={BODY} stroke={EDGE}
        className="dark:fill-[#3a3f45]" />
      <rect x="12" y={height / 2 - 8} width={width - 24} height="16" fill="#d6cfc2"
        className="dark:fill-[#2b3138]" />
      {Array.from({ length: columns }, (_, column) => (
        <g key={column}>
          {[0, 1, 2, 3].map((row) => (
            <rect
              key={`t${row}`}
              x={20 + column * 10}
              y={22 + row * 10}
              width="3.5"
              height="3.5"
              fill="#9a9384"
            />
          ))}
          {[0, 1, 2, 3].map((row) => (
            <rect
              key={`b${row}`}
              x={20 + column * 10}
              y={height - 40 + row * 10 - 5}
              width="3.5"
              height="3.5"
              fill="#9a9384"
            />
          ))}
        </g>
      ))}
      <text x="10" y="14" fontSize="9" fill="#6b6459" fontFamily="ui-sans-serif, system-ui">
        {definition.name}
      </text>
    </svg>
  );
}

function PowerRails({
  definition,
  label,
}: {
  definition: ComponentDefinition;
  label: string;
}) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${definition.name} ${label}`}>
      <rect x="0" y="0" width={width} height={height} rx="4" fill={BODY} stroke={EDGE}
        className="dark:fill-[#3a3f45]" />
      <line x1="10" y1="14" x2={width - 10} y2="14" stroke="#d1453b" strokeWidth="2.5" />
      <line x1="10" y1="40" x2={width - 10} y2="40" stroke="#2f3437" strokeWidth="2.5" />
      <text x={width - 8} y="11" textAnchor="end" fontSize="9" fill="#d1453b"
        fontFamily="ui-monospace, monospace">
        + {label}
      </text>
      <text x={width - 8} y="52" textAnchor="end" fontSize="9" fill="#5b6166"
        fontFamily="ui-monospace, monospace">
        − GND
      </text>
    </svg>
  );
}

function Capacitor({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect x="6" y="4" width={width - 12} height={height - 18} rx="4" fill="#3b6ea5"
        stroke={EDGE} />
      <line x1="10" y1={height - 14} x2="10" y2={height - 2} stroke="#9a9384" strokeWidth="2" />
      <line x1={width - 10} y1={height - 14} x2={width - 10} y2={height - 2} stroke="#9a9384"
        strokeWidth="2" />
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="9" fill="#f4f1ea"
        fontFamily="ui-monospace, monospace">
        C
      </text>
    </svg>
  );
}

function Mosfet({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect x="4" y="14" width={width - 8} height="28" rx="2" fill="#2f3437" stroke={EDGE} />
      <rect x="4" y="2" width={width - 8} height="14" rx="2" fill="#9a9384" stroke={EDGE} />
      <circle cx={width / 2} cy="9" r="3" fill="#5b6166" />
      {Object.entries(definition.visual.pinAnchors).map(([pinId, anchor]) => (
        <g key={pinId}>
          <line x1={anchor.x} y1="42" x2={anchor.x} y2={anchor.y} stroke="#9a9384" strokeWidth="2" />
          <text
            x={anchor.x}
            y={height - 1}
            textAnchor="middle"
            fontSize="7"
            className="fill-[var(--ink-muted)]"
            fontFamily="ui-monospace, monospace"
          >
            {pinId}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Diode({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#9a9384" strokeWidth="2" />
      <rect x="12" y="3" width={width - 26} height={height - 6} rx="3" fill="#2f3437" stroke={EDGE} />
      {/* The band marks the cathode; getting it backwards shorts the rail. */}
      <rect x={width - 20} y="3" width="4" height={height - 6} fill="#f4f1ea" />
      <text x="15" y={height - 6} fontSize="6" fill="#f4f1ea" fontFamily="ui-monospace, monospace">
        1N4007
      </text>
    </svg>
  );
}

function Motor({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <circle cx={width / 2} cy={38} r="32" fill="#9a9384" stroke={EDGE} strokeWidth="1.5" />
      <circle cx={width / 2} cy={38} r="22" fill="#5b6166" />
      <text
        x={width / 2}
        y={43}
        textAnchor="middle"
        fontSize="16"
        fill="#f4f1ea"
        fontFamily="ui-sans-serif, system-ui"
      >
        M
      </text>
      {Object.entries(definition.visual.pinAnchors).map(([pinId, anchor]) => (
        <g key={pinId}>
          <line
            x1={anchor.x}
            y1={66}
            x2={anchor.x}
            y2={anchor.y}
            stroke={pinId === "1" ? "#d1453b" : "#2f3437"}
            strokeWidth="2.5"
          />
          <text
            x={anchor.x}
            y={height - 1}
            textAnchor="middle"
            fontSize="7"
            className="fill-[var(--ink-muted)]"
            fontFamily="ui-monospace, monospace"
          >
            {pinId === "1" ? "+" : "−"}
          </text>
        </g>
      ))}
    </svg>
  );
}

function LevelShifter({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect x="14" y="2" width={width - 28} height={height - 4} rx="4" fill="#1f6f43"
        stroke={EDGE} className="dark:fill-[#17492f]" />
      <text x={width / 2} y={12} textAnchor="middle" fontSize="8" fill="#f4f1ea"
        fontFamily="ui-sans-serif, system-ui">
        LEVEL SHIFT
      </text>
      {Object.entries(definition.visual.pinAnchors).map(([pinId, anchor]) => {
        const left = anchor.x < width / 2;
        return (
          <g key={pinId}>
            <circle cx={anchor.x} cy={anchor.y} r="2.6" fill="#f0c419" stroke="#7a6410" />
            <text
              x={left ? anchor.x + 6 : anchor.x - 6}
              y={anchor.y + 3}
              textAnchor={left ? "start" : "end"}
              fontSize="6.5"
              fill="#f4f1ea"
              fontFamily="ui-monospace, monospace"
            >
              {pinId}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Battery({ definition, label }: { definition: ComponentDefinition; label?: string }) {
  const { width, height } = definition.visual;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={definition.name}>
      <rect x="2" y="8" width={width - 20} height={height - 16} rx="5" fill="#3b6ea5"
        stroke={EDGE} />
      <rect x={width - 18} y={height / 2 - 10} width="8" height="20" rx="2" fill="#9a9384" />
      <text x={(width - 20) / 2} y={height / 2 + 4} textAnchor="middle" fontSize="12"
        fill="#f4f1ea" fontFamily="ui-sans-serif, system-ui">
        {label ?? "BATT"}
      </text>
      {Object.entries(definition.visual.pinAnchors).map(([pinId, anchor]) => (
        <g key={pinId}>
          <circle cx={anchor.x} cy={anchor.y} r="3" fill={pinId === "POS" ? "#d1453b" : "#2f3437"}
            stroke={EDGE} />
          <text x={anchor.x - 8} y={anchor.y + 3} textAnchor="end" fontSize="8"
            className="fill-[var(--ink-muted)]" fontFamily="ui-monospace, monospace">
            {pinId === "POS" ? "+" : "−"}
          </text>
        </g>
      ))}
    </svg>
  );
}

const WOKWI_PROPERTIES: Record<string, Record<string, string>> = {
  "wokwi-led": { color: "red" },
  "wokwi-resistor": { value: "220" },
};

export interface PartGraphicProps {
  definition: ComponentDefinition;
  /** Instance label used by fallback graphics that show a value or rail. */
  label?: string;
  value?: string;
}

export default function PartGraphic({ definition, label, value }: PartGraphicProps) {
  const usesWokwi = definition.visual.renderer === "wokwi-element" && Boolean(definition.visual.elementName);
  const ready = useWokwiElements(usesWokwi);

  if (usesWokwi && ready) {
    const name = definition.visual.elementName!;
    return createElement(name, {
      ...WOKWI_PROPERTIES[name],
      ...(value && name === "wokwi-resistor" ? { value: value.replace(/[^\d.]/g, "") } : {}),
      style: { display: "block" },
    });
  }

  if (definition.id === "breadboard-830") return <Breadboard definition={definition} />;
  if (definition.id === "power-rails") {
    return <PowerRails definition={definition} label={label ?? ""} />;
  }
  if (definition.id === "capacitor") return <Capacitor definition={definition} />;
  if (definition.visual.assetId === "to220") return <Mosfet definition={definition} />;
  if (definition.visual.assetId === "battery") {
    return <Battery definition={definition} label={label} />;
  }
  if (definition.visual.assetId === "diode") return <Diode definition={definition} />;
  if (definition.visual.assetId === "motor") return <Motor definition={definition} />;
  if (definition.visual.assetId === "module-level-shifter") {
    return <LevelShifter definition={definition} />;
  }
  if (definition.visual.assetId === "board-dip") return <GenericBoard definition={definition} />;
  return <GenericModule definition={definition} />;
}
