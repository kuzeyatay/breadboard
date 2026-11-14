import React from "react";
import { AbsoluteFill } from "remotion";
import { Rise, easeIn, easeInOut, hit, mix, ramp } from "@kit";
import { Lockup, Tile, chip, darkButton, pop } from "./ui";
import { BEAT, BUILD, DROP, END, FINAL, PHRASES, ROLL_C, STOP, bg, ink, line, mono, muted, sans, surface, type Clock } from "./shared";

// The title is the app's own navbar lockup, scaled up on the app's own green.
const BIG = 3.6;
const HOME: [number, number] = [584, 372];

const scattered: [string, string, number, number, number][] = [
  ["supplier-contract.pdf", "Document", -560, -210, -7],
  ["board-deck.pptx", "Slides", 300, -260, 5],
  ["customer-call.mp3", "Audio", -470, 130, 4],
  ["site-visit.mp4", "Video", 360, 110, -5],
  ["meeting-notes.md", "Notes", -110, -40, -2],
];
const promises = ["Research deeply.", "Learn from any source.", "Plan with your team.", "Browse with agents.", "Code, design, publish.", "All in one place."];

// Five loose files land on the five build hits, the drop pulls them into the
// mark, a promise changes on every beat, then the lockup shrinks into the
// navbar of the first screen.
export const Opening: React.FC<Clock> = ({ time }) => {
  const gather = ramp(time, DROP - 0.16, DROP, easeIn);
  const dock = ramp(time, PHRASES[1] - 2 * BEAT, PHRASES[1] - 0.06, easeInOut);
  const size = mix(BIG, 1, dock) * (1 + 0.22 * hit(time, DROP, 7));
  return (
    <AbsoluteFill style={{ background: bg, fontFamily: sans, color: ink }}>
      <div style={{ position: "absolute", inset: "0 0 auto 0", height: 96, background: surface, borderBottom: `2px solid ${line}`, opacity: dock }} />
      {scattered.map(([name, kind, x, y, turn], index) => {
        const at = BUILD[index];
        const fall = ramp(time, at - 0.16, at, (n) => n * n);
        const away = 1 - gather;
        return (
          <div key={name} style={{ position: "absolute", left: 960 - 190, top: 540 - 50, opacity: ramp(time, at - 0.16, at - 0.06) * away, translate: `${x * away * (3 - 2 * fall)}px ${y * away * (3 - 2 * fall) + 18 * hit(time, at, 12)}px`, rotate: `${turn + (1 - fall) * 30 + gather * 90}deg`, scale: `${(1.25 + 0.2 * hit(time, at, 8)) * away}` }}>
            <Tile name={name} kind={kind} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: mix(HOME[0], 28, dock), top: mix(HOME[1], 14, dock), transformOrigin: "0 0", scale: `${size}`, opacity: time >= DROP ? 1 : 0 }}>
        <Lockup />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 650, textAlign: "center", fontSize: 64, fontWeight: 500, color: muted }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 150, opacity: 1 - gather }}>{"Your knowledge is everywhere.".slice(0, Math.max(0, Math.floor((time - 0.08) * 34)))}</div>
        {promises.map((promise, index) => {
          const at = DROP + index * BEAT;
          return (
            <div key={promise} style={{ position: "absolute", left: 0, right: 0, display: "flex", justifyContent: "center" }}>
              <Rise t={time} at={at + 0.02} leave={at + BEAT - 0.14}>{promise}</Rise>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const verbs = ["Research.", "Learn.", "Build."];
const recap = ["Gardens", "Chat", "Agents", "Browser", "Plan", "Code", "Voice", "Your models"];

// The lockup again, a recap, three verbs on the last roll, where to get it,
// then a slow fade.
export const Closing: React.FC<Clock> = ({ t, time }) => (
  <AbsoluteFill style={{ background: bg, fontFamily: sans, color: ink }}>
    <AbsoluteFill style={{ scale: `${1 + 0.005 * t}`, opacity: 1 - ramp(time, STOP + 1.0, STOP + 1.6, easeInOut) }}>
      <div style={{ position: "absolute", left: HOME[0], top: 230, transformOrigin: "0 0", scale: `${BIG * (1 + 0.2 * hit(t, 0, 7))}` }}>
        <Lockup />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 500, display: "flex", justifyContent: "center", gap: 30, fontSize: 66, fontWeight: 600, height: 84 }}>
        {verbs.map((verb, index) => (
          <div key={verb} style={{ opacity: time >= ROLL_C[index] ? 1 : 0, translate: `0px ${22 * hit(time, ROLL_C[index], 12)}px` }}>{verb}</div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, display: "flex", justifyContent: "center", gap: 16 }}>
        {recap.map((name, index) => (
          <div key={name} style={{ ...chip, ...pop(t, 0.2 + index * BEAT * 0.4, 30), fontSize: 30, padding: "8px 26px" }}>{name}</div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 770, display: "flex", justifyContent: "center", alignItems: "center", gap: 24 }}>
        <div style={{ ...darkButton, ...pop(time, FINAL, 40), fontSize: 34, fontFamily: mono, fontWeight: 500 }}>github.com/kuzeyatay/breadboard</div>
        <div style={{ ...pop(time, FINAL + BEAT * 0.5, 40), fontSize: 34, color: muted }}>Free and open source, for Windows</div>
      </div>
    </AbsoluteFill>
    {/* The sign-off: small and grey, in the wordmark's face. */}
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontSize: 38, fontWeight: 500, letterSpacing: "-0.025em", color: "#8A968F", opacity: ramp(time, STOP + 1.5, STOP + 2.0, easeInOut) - ramp(time, END - 0.5, END - 0.1, easeInOut) }}>
      *Made with breadboard
    </AbsoluteFill>
  </AbsoluteFill>
);
