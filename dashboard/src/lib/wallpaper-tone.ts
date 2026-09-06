import type { AppearanceTheme } from "./page-appearance";

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

/** Choose the higher-contrast foreground used by the wallpaper CSS. */
export function wallpaperToneFromPixels(pixels: Uint8ClampedArray): AppearanceTheme | null {
  let total = 0;
  let weight = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255;
    total += luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]) * alpha;
    weight += alpha;
  }
  if (!weight) return null;
  const background = total / weight;
  const darkInk = luminance(18, 32, 25); // #122019
  const lightInk = luminance(251, 252, 249); // #fbfcf9
  const contrast = (ink: number) => (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
  return contrast(lightInk) > contrast(darkInk) ? "dark" : "light";
}

// Share decoding between a page and its appearance drawer. Bound cached uploads.
const samples = new Map<string, Promise<AppearanceTheme | null>>();

export function sampleWallpaperTone(src: string): Promise<AppearanceTheme | null> {
  const cached = samples.get(src);
  if (cached) return cached;
  const sample = (async () => {
    try {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return wallpaperToneFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      // Keep the existing theme/preset fallback if the photo cannot be sampled.
      return null;
    }
  })();
  samples.set(src, sample);
  if (samples.size > 12) samples.delete(samples.keys().next().value!);
  void sample.then((tone) => {
    if (tone === null && samples.get(src) === sample) samples.delete(src);
  });
  return sample;
}
