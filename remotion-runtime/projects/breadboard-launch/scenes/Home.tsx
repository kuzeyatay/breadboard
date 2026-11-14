import React from "react";
import { hit, mix, ramp } from "@kit";
import { Bar, Camera, Chrome, Composer, Headline, Tick, beat, card, chip, darkButton, pop, typed } from "./ui";
import { BEAT, PHRASES, ROLL_A, bg, botanical, ink, leaf, line, lineStrong, live, mono, muted, raised, surface, type Clock } from "./shared";

// The places Breadboard keeps one click from its home screen.
const places = ["Plan", "Code", "Organization", "Timer", "Settings", "Voice", "Gestures", "Screen Time"];

const PlaceRow: React.FC<{ active: number; size: number }> = ({ active, size }) => (
  <div style={{ display: "flex", justifyContent: "center", gap: size * 0.3 }}>
    {places.map((place, index) => (
      <div key={place} style={{ padding: `${size * 0.28}px ${size * 0.7}px`, borderRadius: 999, fontSize: size, fontWeight: 600, whiteSpace: "nowrap", background: index === active ? ink : "transparent", color: index === active ? surface : ink, scale: `${index === active ? 1.08 : 1}` }}>
        {place}
      </div>
    ))}
  </div>
);

const widget: React.CSSProperties = { ...card, borderRadius: 22, padding: "14px 22px", whiteSpace: "nowrap" };
const shortcuts = ["Mail", "Notes", "Video", "Code", "Chat", "Drive", "News"];
const gardens: [string, string][] = [["Brazil market entry", "25 notes"], ["Supplier contracts", "12 notes"], ["Onboarding", "8 notes"]];

// 1. The home screen: widgets, search, the eight places, shortcuts, gardens,
// and the terminal that rises from the dock at the bottom.
export const Home: React.FC<Clock> = ({ t }) => {
  const roll = ROLL_A[0] - PHRASES[1];
  const sweep = t < roll || t > roll + 1.0 ? -1 : Math.min(7, Math.floor((t - roll) / 0.11));
  const dock = ramp(t, beat(6), beat(6) + 0.4);
  return (
    <>
      <Camera t={t} keys={[[0, 960, 540, 1], [roll - 0.12, 960, 520, 1.6], [beat(5.2), 960, 600, 1], [beat(6), 960, 720, 1.14]]}>
        <Chrome>
          <div style={{ position: "absolute", left: 30, top: 26, right: 30, display: "flex", alignItems: "stretch", gap: 22 }}>
            <div style={{ ...widget, ...pop(t, 0.04), width: 330, fontWeight: 600 }}>“Better late than never.”</div>
            <div style={{ ...widget, ...pop(t, 0.1), flex: 1, display: "flex", alignItems: "center", gap: 26 }}>
              <div><div style={{ color: muted, fontSize: 21 }}>Wed, 11 Nov</div><div style={{ fontSize: 42, fontWeight: 600, lineHeight: 1 }}>07:10</div></div>
              <div style={{ background: "#CFE0EE", borderRadius: 16, padding: "8px 20px" }}><div style={{ fontSize: 21 }}>Local weather</div><div style={{ fontSize: 38, fontWeight: 600, lineHeight: 1 }}>5°</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 16, height: 16, borderRadius: 8, background: live }} />Online</div>
              <div style={{ width: 62, height: 62, borderRadius: 31, border: `6px solid ${leaf}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>99%</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Now playing</div><Bar value={(t / 3.6) % 1} /></div>
            </div>
            <div style={{ ...widget, ...pop(t, 0.16), width: 400 }}><div style={{ color: muted, fontSize: 21 }}>Calendar, today 08:45</div><div style={{ fontWeight: 600 }}>Board review, room 2</div></div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 176, textAlign: "center", fontSize: 72, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {typed("Where to, ", t, 0.05, 40)}<span style={{ color: botanical }}>{typed("windmill wanderer?", t, 0.3, 40)}</span>
          </div>
          <div style={{ ...pop(t, 0.3), position: "absolute", left: 400, right: 400, top: 292, height: 78, borderRadius: 18, background: ink, color: "#B9C7BF", display: "flex", alignItems: "center", padding: "0 30px", fontSize: 28 }}>Search all of Breadboard...</div>
          <div style={{ ...pop(t, 0.45), position: "absolute", left: 0, right: 0, top: 392 }}><PlaceRow active={sweep} size={27} /></div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 474, display: "flex", justifyContent: "center", gap: 44 }}>
            {shortcuts.map((name, index) => (
              <div key={name} style={{ ...pop(t, beat(1) + index * 0.05), textAlign: "center", fontSize: 22, fontWeight: 600 }}>
                <div style={{ ...card, width: 84, height: 84, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, fontWeight: 700, marginBottom: 8, background: raised }}>{name[0]}</div>
                {name}
              </div>
            ))}
          </div>
          <div style={{ position: "absolute", left: 400, right: 400, top: 630 }}>
            <div style={{ ...pop(t, beat(2)), display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ ...darkButton, fontSize: 24, padding: "8px 20px" }}>My gardens</div>
              <div style={chip}>Public gardens</div>
              <div style={chip}>Organization</div>
              <div style={{ flex: 1 }} />
              <div style={chip}>+ New garden</div>
              <div style={chip}>Import</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 20 }}>
              {gardens.map(([name, notes], index) => (
                <div key={name} style={{ ...card, ...pop(t, beat(2.4) + index * 0.08), padding: "22px 26px", height: 170 }}>
                  <div style={{ fontSize: 30, fontWeight: 700 }}>{name}</div>
                  <div style={{ color: muted }}>{notes}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: mix(44, 400, dock), background: "#E8D7BD", borderTop: `2px solid ${lineStrong}`, boxShadow: "0 -20px 50px rgba(19,32,27,0.18)" }}>
            <div style={{ position: "absolute", left: 30, top: 10, display: "flex", alignItems: "baseline", gap: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 28 }}>Breadboard Assistant</div>
              <div style={{ color: "#3D5147", opacity: dock }}>Chat across every garden you own</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 64, bottom: 0, background: surface, opacity: dock }}>
              <div style={{ position: "absolute", left: 510, top: 34, fontSize: 44, fontWeight: 600, opacity: ramp(t, beat(6.6), beat(6.9)) }}>Good morning. <span style={{ color: muted }}>What are we untangling today?</span></div>
              <Composer value={typed("Plan the Brazil launch with the team", t, beat(6.8), 50)} placeholder="Ask anything." style={{ left: 510, top: 150, width: 900 }} />
            </div>
          </div>
        </Chrome>
      </Camera>
      <Headline t={t}>One home for all your work.</Headline>
    </>
  );
};

// 6. The eight places, one per beat. Each is a real screen with its own job.
const panels: { say: string; draw: (u: number) => React.ReactNode }[] = [
  {
    say: "Your projects, your board, and your calendar in one place.",
    draw: (u) => (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        {[["To do", 3], ["Doing", 2], ["Done", 3]].map(([name, count], column) => (
          <div key={name} style={{ background: bg, borderRadius: 18, padding: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>{name}</div>
            {Array.from({ length: count as number }, (_, i) => (
              <div key={i} style={{ ...card, ...pop(u, 0.03 * (column * 3 + i), 16), borderRadius: 14, height: 62, marginBottom: 12, borderLeft: `8px solid ${[botanical, "#7B97AA", live][column]}` }} />
            ))}
          </div>
        ))}
      </div>
    ),
  },
  {
    say: "Your VS Code workspace inside Breadboard.",
    draw: (u) => (
      <div style={{ background: ink, borderRadius: 18, padding: "24px 30px", height: 330, fontFamily: mono }}>
        {[38, 62, 54, 80, 30, 70, 46].map((width, i) => (
          <div key={i} style={{ display: "flex", gap: 14, marginBottom: 20, opacity: ramp(u, i * 0.04, i * 0.04 + 0.06) }}>
            <div style={{ width: 22, height: 16, borderRadius: 4, background: "#3D5147" }} />
            <div style={{ width: `${width * 0.3}%`, height: 16, borderRadius: 4, background: leaf, marginLeft: (i % 3) * 30 }} />
            <div style={{ width: `${width * 0.5}%`, height: 16, borderRadius: 4, background: "#B9C7BF" }} />
          </div>
        ))}
      </div>
    ),
  },
  {
    say: "Rooms you share with your team and their agents.",
    draw: (u) => (
      <div>
        {[["Maya", "Can someone check clause 14?", "#E7A3B5"], ["Jonas", "Uploading the supplier agreement now.", "#9CC4F0"], ["Research agent", "Three offers compared. Sheet is in the garden.", leaf]].map(([who, said, color], i) => (
          <div key={who} style={{ ...pop(u, i * 0.09, 20), display: "flex", gap: 18, alignItems: "center", marginBottom: 18 }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 30 }}>{who[0]}</div>
            <div style={{ ...card, borderRadius: 18, padding: "12px 24px", flex: 1 }}><b>{who}</b><div>{said}</div></div>
          </div>
        ))}
      </div>
    ),
  },
  {
    say: "A focus timer that slowly reveals a masterpiece as you work.",
    draw: (u) => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 60, height: 330 }}>
        <div style={{ fontSize: 170, fontWeight: 600, fontFamily: mono, letterSpacing: "-0.04em" }}>24:{59 - Math.floor(u * 30)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 34px)", gap: 4 }}>
          {Array.from({ length: 48 }, (_, i) => <div key={i} style={{ width: 34, height: 34, borderRadius: 4, background: i < u * 110 ? ["#F2D35B", botanical, "#9CC4F0", leaf, "#E7A3B5"][(i * 7) % 5] : line }} />)}
        </div>
      </div>
    ),
  },
  {
    say: "Bring your own models. Your data stays in a folder you own.",
    draw: (u) => (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {[["ChatGPT", "Signed in"], ["Claude", "Signed in"], ["Gemini", "Your key"], ["Ollama", "On this computer"]].map(([name, state], i) => (
          <div key={name} style={{ ...card, ...pop(u, i * 0.05, 16), display: "flex", alignItems: "center", gap: 16, padding: "26px 28px", fontSize: 34, fontWeight: 600 }}>
            <Tick on={ramp(u, 0.1 + i * 0.05, 0.2 + i * 0.05)} size={40} />
            <div style={{ flex: 1 }}>{name}</div>
            <div style={{ color: muted, fontSize: 25, fontWeight: 400 }}>{state}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    say: "Talk to the assistant. Dictate. Have answers read aloud.",
    draw: (u) => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 70, height: 330 }}>
        <div style={{ width: 250, height: 250, borderRadius: 125, border: `10px solid ${ink}`, boxShadow: `0 0 0 ${18 + 16 * Math.abs(Math.sin(u * 14))}px rgba(79,111,104,0.22)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 600 }}>Listening</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 200 }}>
          {Array.from({ length: 18 }, (_, i) => <div key={i} style={{ width: 14, borderRadius: 7, background: botanical, height: 30 + 150 * Math.abs(Math.sin(u * 16 + i * 0.9)) }} />)}
        </div>
      </div>
    ),
  },
  {
    say: "Control the pointer, scrolling and CAD with hand gestures.",
    draw: (u) => (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {[["Relaxed hand", "Move the pointer"], ["V sign", "Hold to talk"], ["Straight hand", "Scroll up"], ["Turn your hand", "Rotate in CAD"]].map(([name, action], i) => (
          <div key={name} style={{ ...card, ...pop(u, i * 0.05, 16), padding: "24px 28px" }}>
            <div style={{ color: muted }}>{name}</div>
            <div style={{ fontSize: 36, fontWeight: 700 }}>{action}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    say: "App and tab usage on this device.",
    draw: (u) => (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 40, height: 330 }}>
        <div style={{ width: 380 }}><div style={{ color: muted }}>Total active time</div><div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.1 }}>6h 12m</div></div>
        {[0.5, 0.8, 0.62, 1, 0.74, 0.3, 0.2].map((h, i) => <div key={i} style={{ flex: 1, height: `${h * 100 * ramp(u, i * 0.03, i * 0.03 + 0.25)}%`, borderRadius: "12px 12px 0 0", background: i === 3 ? botanical : "#A9C3B1" }} />)}
      </div>
    ),
  },
];

export const Places: React.FC<Clock> = ({ t }) => {
  const index = Math.min(7, Math.floor(t / BEAT));
  const u = t - index * BEAT;
  return (
    <>
      <Camera t={t} keys={[[0, 960, 540, 1]]}>
        <Chrome>
          <div style={{ position: "absolute", left: 0, right: 0, top: 46, scale: `${1 + 0.02 * hit(u, 0, 10)}` }}><PlaceRow active={index} size={36} /></div>
          <div key={index} style={{ ...card, position: "absolute", left: 280, top: 170, width: 1360, height: 600, padding: "36px 48px", translate: `0px ${24 * hit(u, 0, 14)}px`, scale: `${1 + 0.03 * hit(u, 0, 10)}` }}>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05 }}>{places[index]}</div>
            <div style={{ color: muted, fontSize: 30, margin: "6px 0 30px" }}>{panels[index].say}</div>
            {panels[index].draw(u)}
          </div>
        </Chrome>
      </Camera>
      <Headline t={t}>Plan, code, talk, focus. All built in.</Headline>
    </>
  );
};
