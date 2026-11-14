import React from "react";
import { hit, mix, ramp, rand } from "@kit";
import { Bar, Camera, Chrome, Demand, Headline, Sidebar, Tick, beat, card, chip, darkButton, pop, typed } from "./ui";
import { BEAT, botanical, ink, leaf, line, lineStrong, live, marker, muted, raised, surface, type Clock } from "./shared";

// 2. Sources drop into a garden and come back as lessons anyone on the team can follow: a page is written with its formula,
// its figure and the page it came from, while the Learning Map grows.
const dropped = ["market-report.pdf", "customer-call.mp3", "site-visit.mp4", "meeting-notes.md"];
const lessons = ["Topic Overview", "1. Market size", "2. Competitors", "3. Price elasticity", "4. Tax and tariffs", "5. Distribution", "6. Risks"];
const nodes = Array.from({ length: 50 }, (_, i) => {
  const hub = i < 3;
  const r = hub ? 16 + i * 14 : 54 + 150 * Math.sqrt(rand(i, 21));
  const a = rand(i, 22) * Math.PI * 2;
  return { x: 270 + r * Math.cos(a) * 1.25, y: 190 + r * Math.sin(a), r, hub, to: i % 3, kind: rand(i, 23) };
});
const stats: [string, number][] = [["Sources", 6], ["Pages", 21], ["Concepts", 34], ["Links", 42]];
const overview = "How far demand falls when the price rises decides what a price change earns.";

export const Learn: React.FC<Clock> = ({ t }) => {
  const written = ramp(t, 0.2, beat(7), (n) => n);
  const cite = beat(4);
  return (
    <>
      <Camera t={t} keys={[[0, 960, 540, 1], [beat(1.6), 840, 590, 1.3], [beat(4.6), 1560, 400, 1.55], [beat(7), 1020, 600, 1.06]]}>
        <Chrome place="Brazil market entry">
          <Sidebar title="Explorer" items={[...dropped.map((label, index) => ({ label, on: ramp(t, 0.04 + index * 0.11, 0.14 + index * 0.11) })), ...lessons.map((label, index) => ({ label, on: ramp(t, 0.55 + index * BEAT * 0.4, 0.7 + index * BEAT * 0.4), active: index === 3 }))]} />
          <div style={{ position: "absolute", left: 420, top: 36, width: 840 }}>
            <div style={{ fontSize: 64, fontWeight: 700 }}>3. Price elasticity</div>
            <div style={{ ...pop(t, 0.15), marginTop: 18, padding: "18px 24px", borderLeft: `6px solid ${botanical}`, background: surface, borderRadius: "0 14px 14px 0", fontSize: 30, minHeight: 118 }}>
              <b>Overview.</b> {typed(overview, t, 0.2, 80)}
            </div>
            <div style={{ ...card, ...pop(t, beat(2), 40), marginTop: 18, padding: "14px 0", textAlign: "center", fontSize: 38, fontWeight: 500, borderColor: hit(t, beat(2), 4) > 0.2 ? live : line }}>
              E = % change in quantity ÷ % change in price
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, color: muted }}>
              <div style={pop(t, beat(3.4), 10)}>Revenue is the area under the chosen price</div>
              <div style={{ ...chip, ...pop(t, cite, 10), background: marker, color: ink, fontWeight: 600 }}>market-report.pdf, p. 12</div>
            </div>
            <div style={{ ...card, ...pop(t, beat(3), 40), marginTop: 18, padding: "14px 30px", background: raised }}>
              <Demand w={776} h={170} price={mix(80, 50, ramp(t, beat(5), beat(7)))} draw={ramp(t, beat(3), beat(5), (n) => n)} />
            </div>
          </div>
          <div style={{ position: "absolute", left: 1310, top: 36, width: 560 }}>
            <svg width={560} height={390} style={{ ...card, background: "radial-gradient(circle at 45% 45%, #CFDFD0, #E6F0E6 75%)", display: "block" }}>
              {nodes.map((node, i) => {
                const at = 0.15 + (node.r / 210) * 2.6;
                const grown = ramp(t, at - 0.3, at);
                const hub = nodes[node.to];
                return node.hub ? null : <line key={i} x1={hub.x} y1={hub.y} x2={mix(hub.x, node.x, grown)} y2={mix(hub.y, node.y, grown)} stroke="#9DB3A3" strokeWidth="2" opacity={grown * 0.85} />;
              })}
              {nodes.map((node, i) => {
                const at = node.hub ? 0.1 : 0.15 + (node.r / 210) * 2.6;
                const size = (node.hub ? 13 : node.kind > 0.75 ? 5 : 9) * (ramp(t, at, at + 0.2) + 0.9 * hit(t, at, 9));
                return node.kind > 0.75 && !node.hub ? (
                  <circle key={i} cx={node.x} cy={node.y} r={size} fill="none" stroke="#E2C64A" strokeWidth="3" />
                ) : (
                  <circle key={i} cx={node.x} cy={node.y} r={size} fill={node.hub || node.kind < 0.18 ? "#4A5A52" : leaf} />
                );
              })}
            </svg>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 18 }}>
              {stats.map(([label, total]) => (
                <div key={label} style={{ ...card, borderRadius: 14, padding: "10px 0", textAlign: "center" }}>
                  <div style={{ fontSize: 40, fontWeight: 700 }}>{Math.round(total * written)}</div>
                  <div style={{ color: muted, fontSize: 22 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ ...card, marginTop: 18, padding: "20px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>{written < 0.75 ? "Writing lesson pages" : written < 1 ? "Generating lesson visuals" : "Complete"}</div>
                <div style={{ color: muted }}>Page {Math.max(1, Math.round(21 * written))} of 21</div>
              </div>
              <Bar value={written} color={written < 1 ? botanical : live} />
            </div>
          </div>
        </Chrome>
      </Camera>
      <Headline t={t}>Drop in what you know. Get it explained.</Headline>
    </>
  );
};
