export const RANDOM_AMBIENT_PERIOD_MS = 20_000;

/** A time-seeded palette: every Terminal (and its preview) gets the same colors
 * without tab leaders, storage races, broadcasts, or background network work. */
export function randomAmbientPalette(cycle: number): string[] {
  let seed = (cycle ^ 0x43504c52) >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const hue = ((cycle * 137.508 + random() * 55) % 360 + 360) % 360;
  // One color family at a time. Travel around the full wheel between cycles,
  // with nearby tones inside each scene instead of opposing neon colors.
  const hues = [hue, hue - 5 - random() * 5, hue + 5 + random() * 5];
  const saturation = 38 + random() * 10;
  const lightness = 56 + random() * 6;
  return hues.map((value, index) => `hsl(${Math.round((value + 360) % 360)} ${Math.round(saturation + random() * 4)}% ${Math.round(lightness + [0, -5, 5][index])}%)`);
}
