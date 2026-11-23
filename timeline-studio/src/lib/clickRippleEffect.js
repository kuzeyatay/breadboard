export const DEFAULT_CLICK_RIPPLE_EFFECT = Object.freeze({
  version: 5,
  enabled: false,
  meter: "4/4",
  bpm: 60,
  interval: 1,
  rippleDuration: 1.35,
  radius: 5,
  colorAmount: 1,
  glow: 0.78,
  color: "#54f3e1",
});

const METER_PATTERNS = Object.freeze({
  "2/4": Object.freeze({ accents: [1, 0.24] }),
  "4/4": Object.freeze({ accents: [1, 0.24, 0.68, 0.24] }),
  "3/4": Object.freeze({ accents: [1, 0.28, 0.28] }),
  "5/4": Object.freeze({ accents: [1, 0.24, 0.24, 0.7, 0.24] }),
  "6/8": Object.freeze({ accents: [1, 0.2, 0.2, 0.72, 0.2, 0.2] }),
  "7/8": Object.freeze({ accents: [1, 0.2, 0.68, 0.2, 0.68, 0.2, 0.2] }),
  "9/8": Object.freeze({ accents: [1, 0.2, 0.2, 0.72, 0.2, 0.2, 0.64, 0.2, 0.2] }),
  "12/8": Object.freeze({ accents: [1, 0.18, 0.18, 0.72, 0.18, 0.18, 0.6, 0.18, 0.18, 0.72, 0.18, 0.18] }),
});

function seededUnit(index, salt) {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function resolveRandomClickPoint(index) {
  return [13 + seededUnit(index, 0x6d2b79f5) * 74, 14 + seededUnit(index, 0x1b873593) * 72];
}

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};

export function normalizeClickRippleEffect(value) {
  const effect = value && typeof value === "object" ? value : {};
  const legacy = Number(effect.version) !== DEFAULT_CLICK_RIPPLE_EFFECT.version;
  const oldDefaultRadius = Number(effect.radius) <= 12;
  const oldDefaultDuration = Math.abs(Number(effect.rippleDuration) - 0.72) < 0.06;
  const meter = Object.hasOwn(METER_PATTERNS, effect.meter) ? effect.meter : DEFAULT_CLICK_RIPPLE_EFFECT.meter;
  const denominator = Number(meter.split("/")[1]) || 4;
  const bpm = clamp(effect.bpm ?? (60 / (Number(effect.interval) || DEFAULT_CLICK_RIPPLE_EFFECT.interval)), 30, 180, DEFAULT_CLICK_RIPPLE_EFFECT.bpm);
  const interval = (60 / bpm) * (4 / denominator);
  const maximumPropagationDuration = Math.min(1.4, interval * 0.92);
  const minimumPropagationDuration = Math.min(0.3, maximumPropagationDuration);
  const propagationDuration = clamp(
    legacy && oldDefaultDuration ? DEFAULT_CLICK_RIPPLE_EFFECT.rippleDuration : (effect.rippleDuration ?? effect.colorizeDuration),
    minimumPropagationDuration,
    maximumPropagationDuration,
    Math.min(DEFAULT_CLICK_RIPPLE_EFFECT.rippleDuration, maximumPropagationDuration),
  );
  return {
    ...DEFAULT_CLICK_RIPPLE_EFFECT,
    ...effect,
    version: DEFAULT_CLICK_RIPPLE_EFFECT.version,
    enabled: effect.enabled === true,
    meter,
    bpm,
    interval,
    rippleDuration: propagationDuration,
    radius: clamp(legacy && oldDefaultRadius ? DEFAULT_CLICK_RIPPLE_EFFECT.radius : effect.radius, 2, 18, DEFAULT_CLICK_RIPPLE_EFFECT.radius),
    colorizeDuration: propagationDuration,
    colorAmount: clamp(effect.colorAmount, 0, 1, DEFAULT_CLICK_RIPPLE_EFFECT.colorAmount),
    glow: clamp(effect.glow, 0, 1, DEFAULT_CLICK_RIPPLE_EFFECT.glow),
    color: typeof effect.color === "string" && effect.color ? effect.color : DEFAULT_CLICK_RIPPLE_EFFECT.color,
  };
}

const easeInOut = (value) => value * value * (3 - 2 * value);
const easeOut = (value) => 1 - (1 - value) ** 3;

export function resolveClickRippleState(value, time = 0) {
  const effect = normalizeClickRippleEffect(value);
  const safeTime = Math.max(0, Number(time) || 0);
  const clickIndex = Math.floor((safeTime + 1e-7) / effect.interval);
  const pattern = METER_PATTERNS[effect.meter] || METER_PATTERNS["4/4"];
  const beatsPerBar = pattern.accents.length;
  const beatIndex = clickIndex % beatsPerBar;
  const accent = pattern.accents[beatIndex];
  const phaseTime = safeTime - clickIndex * effect.interval;
  const target = resolveRandomClickPoint(clickIndex);
  const nextTarget = resolveRandomClickPoint(clickIndex + 1);
  const travelStart = Math.min(effect.rippleDuration * 0.48, effect.interval * 0.5);
  const travelDuration = Math.max(0.14, effect.interval - travelStart);
  const travel = easeInOut(Math.max(0, Math.min(1, (phaseTime - travelStart) / travelDuration)));
  const clickProgress = Math.min(1, phaseTime / effect.rippleDuration);
  return {
    effect,
    clickIndex,
    beatIndex,
    accent,
    hitScale: beatIndex === 0 ? 1.2 : accent >= 0.6 ? 1.02 : 0.76,
    hitOpacity: 0.32 + accent * 0.68,
    x: target[0] + (nextTarget[0] - target[0]) * travel,
    y: target[1] + (nextTarget[1] - target[1]) * travel,
    hitX: target[0],
    hitY: target[1],
    revealX: target[0],
    revealY: target[1],
    rippleProgress: easeOut(clickProgress),
    ringOpacity: clickProgress < 1 ? (1 - clickProgress) ** 1.25 * accent : 0,
    press: clickProgress < 0.16 ? 1 - Math.sin((clickProgress / 0.16) * Math.PI) * 0.22 : 1,
    revealProgress: easeOut(clickProgress),
  };
}

export function updateClickRippleEffect(current, patch) {
  return normalizeClickRippleEffect({ ...normalizeClickRippleEffect(current), ...(patch || {}) });
}
