import React from "react";
import { easeInOut, hit, mix, ramp } from "@kit";
import { Camera, Chrome, Headline, Tick, Tile, beat, card, chip, darkButton, pop, typed } from "./ui";
import { BEAT, PHRASES, ROLL_B, botanical, ink, leaf, line, link, live, mono, muted, raised, surface, type Clock } from "./shared";

// 5. The built-in browser, driven by an agent: it opens the supplier portal,
// fills the four fields on the four hits of the drum roll, submits, compares
// the offers and saves the result to a garden.
const fields: [string, string][] = [
  ["Product", "Steel bracket, 40 mm"],
  ["Quantity", "500 units"],
  ["Delivery", "Rotterdam, 3 weeks"],
  ["Contact", "purchasing@acme.example"],
];
const offers: [string, string, string][] = [
  ["Northwind", "4.10 per unit", "3 weeks"],
  ["Halden Steel", "3.65 per unit", "2 weeks"],
  ["Orion Metals", "4.40 per unit", "4 weeks"],
];
const steps = ["Opening the supplier portal", "Filling the quote form", "Submitting the request", "Comparing 3 offers", "Saved to Supplier contracts"];
const fills = ROLL_B.map((at) => at - PHRASES[5]);
const address = "supplier-portal.example/quote";

export const Browser: React.FC<Clock> = ({ t }) => {
  const loaded = beat(1.5);
  const submit = beat(5);
  const results = ramp(t, submit + 0.15, submit + 0.4);
  const saved = beat(7);
  const done = [0.1, fills[0], submit, submit + 0.3, saved];
  // The agent's pointer: address bar, the four fields, the button, the best offer.
  const stops: [number, number, number][] = [
    [0, 700, 110],
    [fills[0], 330, 365],
    [fills[1], 880, 365],
    [fills[2], 330, 505],
    [fills[3], 880, 505],
    [submit, 250, 640],
    [beat(6.6), 700, 470],
  ];
  let [, px, py] = stops[0];
  for (const [at, x, y] of stops.slice(1)) {
    const p = ramp(t, at - 0.2, at, easeInOut);
    px = mix(px, x, p);
    py = mix(py, y, p);
  }
  const click = stops.reduce((sum, [at]) => sum + hit(t, at, 14), 0);
  return (
    <>
      <Camera t={t} keys={[[0, 960, 540, 1], [fills[0] - 0.25, 650, 500, 1.42], [beat(5.6), 800, 520, 1.22], [saved, 1080, 540, 1.1]]}>
        <Chrome place="Browser">
          <div style={{ position: "absolute", left: 30, top: 24, width: 1230, height: 920, ...card, overflow: "hidden", background: raised }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px 0", background: surface }}>
              {["Supplier portal", "Price list", "Mail"].map((tab, index) => (
                <div key={tab} style={{ padding: "10px 24px", borderRadius: "14px 14px 0 0", background: index === 0 ? raised : "transparent", border: index === 0 ? `2px solid ${line}` : "2px solid transparent", borderBottom: "none", color: index === 0 ? ink : muted, fontSize: 24 }}>{tab}</div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: `2px solid ${line}`, borderTop: `2px solid ${line}` }}>
              <div style={{ color: muted, fontSize: 30 }}>←  →</div>
              <div style={{ flex: 1, ...chip, fontFamily: mono, fontSize: 24, padding: "10px 22px", background: surface }}>{typed(address, t, 0.1, 60)}</div>
              <div style={{ ...chip, background: leaf, borderColor: leaf, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: live, opacity: 0.4 + 0.6 * Math.abs(Math.sin(t * 8)) }} />
                Agent is browsing
              </div>
            </div>
            <div style={{ padding: "40px 60px", opacity: ramp(t, loaded - 0.3, loaded) * (1 - results) }}>
              <div style={{ fontSize: 50, fontWeight: 700 }}>Request a quote</div>
              <div style={{ color: muted, marginBottom: 26 }}>Northwind supplier portal</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px 30px" }}>
                {fields.map(([label, value], index) => (
                  <div key={label}>
                    <div style={{ color: muted, fontSize: 23, marginBottom: 6 }}>{label}</div>
                    <div style={{ height: 76, borderRadius: 14, border: `3px solid ${hit(t, fills[index], 3) > 0.15 ? botanical : line}`, background: surface, padding: "0 22px", display: "flex", alignItems: "center", fontSize: 29, whiteSpace: "nowrap", overflow: "hidden" }}>{typed(value, t, fills[index], 130)}</div>
                  </div>
                ))}
              </div>
              <div style={{ ...darkButton, display: "inline-block", marginTop: 36, fontSize: 29, scale: `${1 - 0.12 * hit(t, submit, 9)}` }}>Send request</div>
            </div>
            <div style={{ position: "absolute", left: 60, right: 60, top: 190, opacity: results }}>
              <div style={{ fontSize: 50, fontWeight: 700, marginBottom: 20 }}>3 offers received</div>
              {offers.map(([name, price, time], index) => {
                const best = index === 1 && t > beat(6.6);
                return (
                  <div key={name} style={{ ...card, ...pop(t, submit + 0.3 + index * BEAT * 0.5, 30), display: "flex", alignItems: "center", padding: "22px 28px", marginBottom: 16, fontSize: 31, background: best ? "#D5F3E0" : surface, borderColor: best ? live : line }}>
                    <div style={{ flex: 1, fontWeight: 600 }}>{name}</div>
                    <div style={{ width: 280 }}>{price}</div>
                    <div style={{ width: 150, color: muted }}>{time}</div>
                  </div>
                );
              })}
            </div>
            <svg width="54" height="62" viewBox="0 0 54 62" style={{ position: "absolute", left: px, top: py, scale: `${1 - 0.25 * Math.min(1, click)}`, transformOrigin: "0 0" }}>
              <path d="M4 4l16 44 8-17 18-6z" fill={ink} stroke={raised} strokeWidth="4" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ position: "absolute", left: 1290, top: 24, width: 600 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ ...card, background: "#D3E1D5", padding: "14px 24px", color: link, fontSize: 27 }}>/agents:agent-browser get quotes for 500 brackets</div>
            </div>
            <div style={{ ...card, marginTop: 20, padding: "24px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <div style={{ fontSize: 32, fontWeight: 700, flex: 1 }}>Agent Browser</div>
                <div style={chip}>{t < saved ? "Stop" : "Done"}</div>
              </div>
              {steps.map((label, index) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, color: t >= done[index] ? ink : muted, whiteSpace: "nowrap" }}>
                  <Tick on={ramp(t, done[index], done[index] + 0.18)} />
                  {label}
                </div>
              ))}
              <div style={{ ...pop(t, saved, 40), marginTop: 22, rotate: "-2deg" }}>
                <Tile name="Supplier comparison" kind="Spreadsheet" />
              </div>
            </div>
          </div>
        </Chrome>
      </Camera>
      <Headline t={t}>A browser your agents can drive.</Headline>
    </>
  );
};
