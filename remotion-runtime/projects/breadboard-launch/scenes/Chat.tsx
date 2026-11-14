import React from "react";
import { hit, mix, ramp, rand } from "@kit";
import { Bar, Camera, Chrome, Composer, Demand, Headline, Sidebar, Tick, Tile, beat, card, chip, darkButton, pop, typed } from "./ui";
import { BEAT, botanical, ink, leaf, line, lineStrong, link, live, marker, mono, muted, raised, surface, type Clock } from "./shared";

const chats = [{ label: "New chat", active: true }, { label: "Supplier renewal" }, { label: "Board prep" }, { label: "Onboarding plan" }];
const bubble: React.CSSProperties = { ...card, background: "#D3E1D5", padding: "16px 26px", fontSize: 30 };

/** The line above every answer: an orb while it works, then how long it thought. */
const Thinking: React.FC<{ t: number; done: number; note: string }> = ({ t, done, note }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, color: muted, fontSize: 25 }}>
    <div style={{ width: 22, height: 22, borderRadius: 11, background: t < done ? botanical : line, scale: `${t < done ? 0.8 + 0.3 * Math.abs(Math.sin(t * 9)) : 1}` }} />
    {t < done ? "Thinking" : `Thought (${note})`}
  </div>
);

// 3. Chat in a shared garden: a question about a contract a teammate added is typed and sent, the garden is consulted, the
// answer streams in, and the evidence opens beside it.
const question = "Can we end the supplier deal early?";
const answer = "Yes, with 90 days of written notice. Clause 14.2 also lets either side leave at once after a material breach.";
const steps = ["Consulting Garden", "Reading file", "Searching files"];

export const Ask: React.FC<Clock> = ({ t }) => {
  const sent = beat(2);
  const said = beat(3.5);
  const proof = beat(5);
  const page = ramp(t, beat(6), beat(6) + 0.45);
  return (
    <>
      <Camera t={t} keys={[[0, 860, 950, 1.6], [beat(2), 900, 520, 1.16], [beat(5), 1000, 560, 1.3], [beat(6.2), 1160, 540, 1.12]]}>
        <Chrome place="Supplier contracts / Chat">
          <Sidebar title="+  New chat" items={chats} />
          <div style={{ position: "absolute", left: 410, top: 34, width: 900 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ ...bubble, ...pop(t, sent, 500) }}>{question}</div>
            </div>
            <div style={{ ...card, ...pop(t, sent + 0.1, 30), marginTop: 24, padding: "26px 32px", minHeight: 300 }}>
              <Thinking t={t} done={said} note="4s, 8.8k tokens" />
              <div style={{ display: "flex", gap: 12, marginTop: 14, height: 46 }}>
                {steps.map((step, index) => (
                  <div key={step} style={{ ...chip, ...pop(t, sent + 0.2 + index * BEAT * 0.5, 12) }}>{step}</div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 32, lineHeight: 1.42, minHeight: 138 }}>{typed(answer, t, said, 110)}</div>
              <div style={{ ...pop(t, proof, 20), marginTop: 18, paddingTop: 18, borderTop: `2px solid ${line}`, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ ...chip, background: leaf, borderColor: leaf, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
                  <Tick on={ramp(t, proof + 0.1, proof + 0.3)} size={26} />
                  Verified
                </div>
                {["supplier-agreement.pdf, p. 7", "Added by Jonas"].map((source, index) => (
                  <div key={source} style={{ ...chip, ...pop(t, proof + (index + 1) * BEAT * 0.5, 12), background: index === 0 ? marker : raised }}>{source}</div>
                ))}
              </div>
            </div>
          </div>
          <Composer value={t < sent ? typed(question, t, 0.08, 34) : ""} placeholder="Ask about Supplier contracts" sent={hit(t, sent, 10)} style={{ left: 410, top: 846, width: 900 }} />
          <div style={{ ...card, position: "absolute", left: 1360, top: 34, width: 520, height: 900, padding: "28px 32px", borderRadius: 12, background: raised, translate: `${(1 - page) * 640}px 0px` }}>
            <div style={{ color: muted, fontSize: 24 }}>supplier-agreement.pdf, page 7</div>
            <div style={{ fontSize: 36, fontWeight: 700, margin: "12px 0 16px" }}>14. Termination</div>
            {Array.from({ length: 20 }, (_, i) => {
              const marked = i >= 3 && i <= 5 && t > beat(6.6) + (i - 3) * 0.1;
              return <div key={i} style={{ height: 16, marginTop: 17, borderRadius: 4, width: `${68 + 32 * rand(i, 31)}%`, background: marked ? "#E8CF5E" : "#D7DDD7" }} />;
            })}
          </div>
        </Chrome>
      </Camera>
      <Headline t={t}>Ask. See the evidence.</Headline>
    </>
  );
};

// 4. The capability palette runs down its agents, Parametric CAD is chosen,
// and a dimensioned part is modelled step by step while it turns.
const agents: [string, string][] = [
  ["Codex", "Build, fix, and test the project linked to this Garden"],
  ["Deep Research", "Several rounds of web research, a report with sources"],
  ["Bolt Slides", "Interactive presentations with a presenter view"],
  ["HyperFrames", "Animated videos from a description"],
  ["Music Producer", "Original music and vocal songs"],
  ["Parametric CAD", "A dimensioned 3D part, ready to print"],
];
const tabs = ["Skills", "Workflows", "Agents", "Bots", "Prompts", "Reference"];
const modelling = ["Sketching the base plate", "Extruding 8 mm", "Cutting four screw holes", "Raising the pipe collar", "Checking dimensions"];

/** A wall bracket drawn in turning perspective: plate, four holes, a collar. */
const Part: React.FC<{ turn: number; plate: number; holes: number; collar: number; sizes: number }> = ({ turn, plate, holes, collar, sizes }) => {
  const at = (x: number, y: number, z: number): [number, number] => {
    const xr = x * Math.cos(turn) - y * Math.sin(turn);
    const yr = x * Math.sin(turn) + y * Math.cos(turn);
    return [280 + 3.3 * xr, 265 + 3.3 * (yr * 0.5 - z * 0.86)];
  };
  const path = (points: [number, number][]) => `${points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}Z`;
  const ring = (cx: number, cy: number, r: number, z: number) => path(Array.from({ length: 40 }, (_, i) => at(cx + r * Math.cos((i / 40) * 2 * Math.PI), cy + r * Math.sin((i / 40) * 2 * Math.PI), z)));
  const corners: [number, number][] = [[-60, -40], [60, -40], [60, 40], [-60, 40]];
  const thick = 8 * plate;
  const tall = thick + 40 * collar;
  const stroke = { fill: "none", stroke: ink, strokeWidth: 3, strokeLinejoin: "round" as const };
  return (
    <svg width={560} height={400} style={{ display: "block" }}>
      <path d={path(corners.map(([x, y]) => at(x, y, 0)))} {...stroke} stroke={lineStrong} />
      {corners.map(([x, y], i) => {
        const [x1, y1] = at(x, y, 0);
        const [x2, y2] = at(x, y, thick);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ink} strokeWidth={3} />;
      })}
      <path d={path(corners.map(([x, y]) => at(x, y, thick)))} {...stroke} fill={leaf} fillOpacity={0.45} />
      {corners.map(([x, y], i) => (
        <path key={i} d={ring(x * 0.78, y * 0.7, 5 * holes, thick)} {...stroke} fill={raised} />
      ))}
      {collar > 0 ? (
        <>
          <path d={ring(0, 0, 24, thick)} {...stroke} />
          {[0, 1].map((side) => {
            const angle = -turn + side * Math.PI;
            const [x1, y1] = at(24 * Math.cos(angle), 24 * Math.sin(angle), thick);
            const [x2, y2] = at(24 * Math.cos(angle), 24 * Math.sin(angle), tall);
            return <line key={side} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ink} strokeWidth={3} />;
          })}
          <path d={ring(0, 0, 24, tall)} {...stroke} fill={leaf} fillOpacity={0.7} />
          <path d={ring(0, 0, 17, tall)} {...stroke} fill={raised} />
        </>
      ) : null}
      <g opacity={sizes} fontFamily={mono} fontSize={22} fill={botanical}>
        <text x={280} y={392} textAnchor="middle">120 x 80 x 48 mm</text>
        <text x={at(0, 0, tall)[0]} y={at(0, 0, tall)[1] - 40} textAnchor="middle">40 mm bore</text>
      </g>
    </svg>
  );
};

export const Agents: React.FC<Clock> = ({ t }) => {
  const chosen = beat(3.5);
  const cursor = Math.min(agents.length - 1, Math.floor(t / (BEAT * 0.6)));
  const open = 1 - ramp(t, chosen, chosen + 0.25);
  const step = (n: number) => chosen + 0.25 + n * BEAT * 0.62;
  const ready = step(4) + 0.3;
  return (
    <>
      <Camera t={t} keys={[[0, 860, 560, 1.32], [chosen, 900, 420, 1.3], [beat(5.5), 1060, 470, 1.5], [beat(7.2), 900, 480, 1.18]]}>
        <Chrome place="Terminal">
          <Sidebar title="+  New chat" items={chats} />
          <div style={{ position: "absolute", left: 410, top: 34, width: 900 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ ...bubble, ...pop(t, chosen, 400), color: link }}>/agents:parametric-cad wall bracket for a 40 mm pipe</div>
            </div>
            <div style={{ ...card, ...pop(t, chosen + 0.12, 40), marginTop: 24, borderRadius: 26, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 30px", borderBottom: `2px solid ${line}`, background: raised }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>Parametric CAD</div>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: live, opacity: t < ready ? 0.4 + 0.6 * Math.abs(Math.sin(t * 8)) : 1 }} />
                <div style={{ color: muted, flex: 1 }}>{t < ready ? "modelling" : "part ready, revision 1"}</div>
                <div style={chip}>{t < ready ? "Stop" : "Open part"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", padding: "10px 30px 0" }}>
                <div style={{ width: 330 }}>
                  {modelling.map((label, index) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, color: t >= step(index) ? ink : muted, whiteSpace: "nowrap" }}>
                      <Tick on={ramp(t, step(index), step(index) + 0.18)} />
                      {label}
                    </div>
                  ))}
                </div>
                <Part turn={0.6 + 0.9 * t} plate={ramp(t, step(1) - 0.3, step(1))} holes={ramp(t, step(2) - 0.2, step(2)) + 0.5 * hit(t, step(2), 9)} collar={ramp(t, step(3) - 0.3, step(3))} sizes={ramp(t, step(4) - 0.1, step(4) + 0.1)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 30px 24px" }}>
                <div style={{ flex: 1, marginRight: 12 }}><Bar value={ramp(t, chosen, ready, (n) => n)} color={t < ready ? botanical : live} /></div>
                {["bracket.step", "bracket.stl", "bracket.3mf"].map((name, index) => (
                  <div key={name} style={{ ...chip, ...pop(t, ready + index * 0.1, 16), fontFamily: mono, background: index === 0 ? leaf : raised }}>{name}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ ...card, position: "absolute", left: 410, top: 150, width: 900, padding: "26px 30px", opacity: open, scale: `${mix(0.9, 1, open)}`, transformOrigin: "10% 100%", boxShadow: "0 30px 70px rgba(19,32,27,0.22)" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>Use a capability</div>
            <div style={{ display: "flex", gap: 30, margin: "16px 0 14px", borderBottom: `2px solid ${line}`, color: muted }}>
              {tabs.map((tab) => (
                <div key={tab} style={{ paddingBottom: 10, color: tab === "Agents" ? ink : muted, fontWeight: tab === "Agents" ? 600 : 400, borderBottom: tab === "Agents" ? `4px solid ${botanical}` : "4px solid transparent" }}>{tab}</div>
              ))}
            </div>
            {agents.map(([name, about], index) => (
              <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 18, padding: "13px 18px", borderRadius: 14, background: index === cursor ? "#C9DACB" : "transparent", scale: `${index === cursor ? 1.02 : 1}` }}>
                <div style={{ fontWeight: 600, fontSize: 29, width: 230, whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ color: muted, fontSize: 25, whiteSpace: "nowrap" }}>{about}</div>
              </div>
            ))}
          </div>
          <Composer value={t < chosen ? "/agents:" : ""} placeholder="Ask anything." slash={t < chosen} style={{ left: 410, top: 846, width: 900 }} />
        </Chrome>
      </Camera>
      <Headline t={t}>Hand the work to agents.</Headline>
    </>
  );
};
