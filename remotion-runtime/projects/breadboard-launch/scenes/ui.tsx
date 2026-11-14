import React from "react";
import { AbsoluteFill } from "remotion";
import { easeInOut, hit, mix, ramp } from "@kit";
import { BEAT, bg, botanical, ink, leaf, line, lineStrong, mono, muted, paper, raised, sans, surface } from "./shared";

// Pieces of the Breadboard interface, redrawn at 1920 by 1080.

export const card: React.CSSProperties = {
  background: surface,
  border: `2px solid ${line}`,
  borderRadius: 20,
  boxShadow: "0 3px 0 rgba(19,32,27,0.05), 0 14px 30px rgba(19,32,27,0.07)",
};
export const darkButton: React.CSSProperties = { background: ink, color: surface, borderRadius: 14, padding: "12px 28px", fontWeight: 600 };
export const chip: React.CSSProperties = { borderRadius: 999, padding: "5px 18px", fontSize: 23, border: `2px solid ${line}`, background: raised, whiteSpace: "nowrap" };

export const beat = (n: number) => n * BEAT;
export const typed = (words: string, t: number, from: number, perSecond: number) => words.slice(0, Math.max(0, Math.floor((t - from) * perSecond)));
export const pop = (t: number, at: number, dy = 30): React.CSSProperties => {
  const p = ramp(t, at, at + 0.3);
  return { opacity: ramp(t, at, at + 0.08), translate: `0px ${(1 - p) * dy}px`, scale: `${mix(0.9, 1, p) + 0.05 * hit(t, at + 0.08, 12)}` };
};

const holes = [30.7, 35.7, 40.7, 45.7, 58.7, 63.7, 68.7, 73.7];
/** The Breadboard mark as the navbar shows it: ink line art. */
export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={ink} style={{ flexShrink: 0 }}>
    <rect x="8" y="14" width="84" height="72" rx="6" strokeWidth="4.4" />
    {[23, 37, 57, 71].map((y) => [3.6, 91.4].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="6.4" fill={ink} stroke="none" />))}
    {[20, 79].map((y) => <rect key={y} x="15" y={y} width="70" height="7" rx="3" strokeWidth="2.6" />)}
    {[51.5, 56.5].map((y) => <line key={y} x1="12" x2="88" y1={y} y2={y} strokeWidth="2.6" />)}
    {holes.map((y) => Array.from({ length: 13 }, (_, c) => <rect key={`${y}-${c}`} x={15.5 + c * 5.5} y={y} width="3" height="3" fill={ink} stroke="none" />))}
  </svg>
);

/** Logo and wordmark exactly as in the navbar; scale it up for a title. */
export const Lockup: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: sans, fontWeight: 500, fontSize: 31, letterSpacing: "-0.025em", color: ink, whiteSpace: "nowrap" }}>
    <Logo size={60} />
    breadboard
  </div>
);

/** The app window: navbar, then the page. */
export const Chrome: React.FC<{ place?: string; children?: React.ReactNode }> = ({ place, children }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, background: bg, color: ink, fontFamily: sans, fontSize: 27, lineHeight: 1.3 }}>
    <div style={{ position: "absolute", inset: "0 0 auto 0", height: 96, background: surface, borderBottom: `2px solid ${line}` }}>
      <div style={{ position: "absolute", left: 28, top: 14, display: "flex", alignItems: "center", gap: 26 }}>
        <Lockup />
        {place ? <div style={{ color: muted, fontSize: 25 }}>/ {place}</div> : null}
      </div>
    </div>
    <div style={{ position: "absolute", inset: "96px 0 0 0" }}>{children}</div>
  </div>
);

export type CameraKey = [at: number, x: number, y: number, zoom: number];
/** A 2D camera over the page: it moves to each key on its beat and never quite rests. */
export const Camera: React.FC<{ t: number; keys: CameraKey[]; children: React.ReactNode }> = ({ t, keys, children }) => {
  let [, x, y, zoom] = keys[0];
  for (const [at, kx, ky, kz] of keys.slice(1)) {
    const p = ramp(t, at - 0.06, at + 0.5, easeInOut);
    x = mix(x, kx, p);
    y = mix(y, ky, p);
    zoom = mix(zoom, kz, p);
  }
  zoom *= 1 + 0.006 * t + 0.05 * (1 - ramp(t, 0, 0.35));
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${960 - x * zoom}px, ${540 - y * zoom}px) scale(${zoom})` }}>{children}</div>
    </AbsoluteFill>
  );
};

/** What the shot is about, in a few words, in the app's dark button style. */
export const Headline: React.FC<{ t: number; children: React.ReactNode }> = ({ t, children }) => (
  <div style={{ position: "absolute", left: 60, bottom: 52, ...pop(t, 0.12, 60), transformOrigin: "0 100%", background: ink, color: surface, fontFamily: sans, fontWeight: 600, fontSize: 58, letterSpacing: "-0.015em", padding: "14px 36px 18px", borderRadius: 24, boxShadow: "0 18px 50px rgba(19,32,27,0.35)" }}>
    {children}
  </div>
);

export const Tick: React.FC<{ on: number; size?: number }> = ({ on, size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
    <circle cx="15" cy="15" r="13" fill={on > 0 ? leaf : "none"} stroke={on > 0 ? leaf : line} strokeWidth="2.5" />
    <path d="M9 15.5l4.2 4.2L21.5 11" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="20" strokeDashoffset={20 * (1 - on)} />
  </svg>
);
export const Bar: React.FC<{ value: number; color?: string }> = ({ value, color = botanical }) => (
  <div style={{ height: 10, borderRadius: 5, background: line, overflow: "hidden" }}>
    <div style={{ width: `${value * 100}%`, height: "100%", background: color }} />
  </div>
);

/** A file as the app shows it in chat: a slightly tilted paper tile. */
export const Tile: React.FC<{ name: string; kind: string; style?: React.CSSProperties }> = ({ name, kind, style }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18, background: paper, borderRadius: 18, padding: "20px 24px", border: `2px solid ${lineStrong}`, boxShadow: "0 12px 26px rgba(19,32,27,0.14)", fontFamily: sans, color: ink, ...style }}>
    <svg width="46" height="56" viewBox="0 0 46 56" style={{ flexShrink: 0 }}>
      <path d="M4 2h26l12 12v40H4z" fill={raised} stroke={botanical} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M30 2v12h12" fill="none" stroke={botanical} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M12 28h22M12 37h22M12 46h14" stroke={botanical} strokeWidth="3" strokeLinecap="round" />
    </svg>
    <div>
      <div style={{ fontSize: 28, fontWeight: 600, whiteSpace: "nowrap" }}>{name}</div>
      <div style={{ fontSize: 23, color: muted }}>{kind}</div>
    </div>
  </div>
);

/** The sidebar every workspace page has. */
export const Sidebar: React.FC<{ title: string; items: { label: string; on?: number; active?: boolean }[] }> = ({ title, items }) => (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 360, padding: "34px 30px", borderRight: `2px solid ${line}` }}>
    <div style={{ ...card, borderRadius: 14, padding: "10px 20px", display: "inline-block", boxShadow: "none" }}>{title}</div>
    {items.map((item) => (
      <div key={item.label} style={{ marginTop: 14, padding: "8px 16px", borderRadius: 12, background: item.active ? "#C9DACB" : "transparent", color: item.active ? ink : muted, opacity: item.on ?? 1, translate: `${(1 - (item.on ?? 1)) * -20}px 0px`, whiteSpace: "nowrap" }}>
        {item.label}
      </div>
    ))}
  </div>
);

/** The chat composer: slash button, plus, text, effort pill, send. */
export const Composer: React.FC<{ value: string; placeholder: string; sent?: number; slash?: boolean; style?: React.CSSProperties }> = ({ value, placeholder, sent = 0, slash, style }) => (
  <div style={{ ...card, position: "absolute", height: 92, borderRadius: 46, display: "flex", alignItems: "center", gap: 14, padding: "0 18px", ...style }}>
    <div style={{ width: 60, height: 60, borderRadius: 30, background: slash ? ink : raised, color: slash ? surface : ink, border: `2px solid ${line}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 30 }}>/</div>
    <div style={{ width: 60, height: 60, borderRadius: 30, background: raised, border: `2px solid ${line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 400 }}>+</div>
    <div style={{ flex: 1, fontSize: 30, color: value ? ink : muted, whiteSpace: "nowrap", overflow: "hidden" }}>{value || placeholder}</div>
    <div style={{ ...chip, fontSize: 25 }}>High</div>
    <div style={{ width: 62, height: 62, borderRadius: 31, background: value ? ink : "#8FA79A", scale: `${1 - 0.25 * sent}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="28" height="28" viewBox="0 0 28 28"><path d="M14 23V6M6 13l8-8 8 8" fill="none" stroke={surface} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  </div>
);

/** A demand line, the chosen price on it, and the revenue that price earns as an area. */
export const Demand: React.FC<{ w: number; h: number; price: number; draw?: number }> = ({ w, h, price, draw = 1 }) => {
  const left = 16;
  const base = h - 16;
  const x = (quantity: number) => left + (quantity / 100) * (w - left - 16);
  const y = (p: number) => base - (p / 100) * (base - 16);
  const shown = price >= 100 * (1 - draw);
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <rect x={left} y={y(price)} width={shown ? x(100 - price) - left : 0} height={base - y(price)} fill={leaf} opacity={0.55} />
      <path d={`M${left} 16V${base}H${w - 16}`} fill="none" stroke={lineStrong} strokeWidth={4} strokeLinecap="round" />
      <line x1={x(0)} y1={y(100)} x2={x(100 * draw)} y2={y(100 - 100 * draw)} stroke={botanical} strokeWidth={6} strokeLinecap="round" />
      {shown ? <circle cx={x(100 - price)} cy={y(price)} r={12} fill={ink} /> : null}
    </svg>
  );
};
