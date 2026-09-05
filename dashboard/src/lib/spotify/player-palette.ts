"use client";

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface PlayerPalette {
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  hover: string;
  active: string;
  buttonBackground: string;
  buttonForeground: string;
  overlay: string;
  errorSurface: string;
}

const LIGHT_INK: RgbColor = { red: 248, green: 250, blue: 248 };
const DARK_INK: RgbColor = { red: 15, green: 25, blue: 21 };

function mixColor(first: RgbColor, second: RgbColor, amount: number): RgbColor {
  const mix = (left: number, right: number) =>
    Math.round(left + (right - left) * amount);
  return {
    red: mix(first.red, second.red),
    green: mix(first.green, second.green),
    blue: mix(first.blue, second.blue),
  };
}

function rgb(color: RgbColor): string {
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function rgba(color: RgbColor, alpha: number): string {
  return `rgb(${color.red} ${color.green} ${color.blue} / ${alpha})`;
}

function relativeLuminance(color: RgbColor): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.red) +
    0.7152 * channel(color.green) +
    0.0722 * channel(color.blue)
  );
}

function contrastRatio(first: RgbColor, second: RgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function playerPalette(coverColor: RgbColor): PlayerPalette {
  const surface = mixColor(
    coverColor,
    DARK_INK,
    relativeLuminance(coverColor) > 0.46 ? 0.2 : 0.1,
  );
  const foreground =
    contrastRatio(surface, LIGHT_INK) >= contrastRatio(surface, DARK_INK)
      ? LIGHT_INK
      : DARK_INK;
  const foregroundIsLight = foreground === LIGHT_INK;
  return {
    surface: rgb(surface),
    foreground: rgb(foreground),
    muted: rgba(foreground, 0.68),
    border: rgba(foreground, 0.17),
    hover: rgba(foreground, 0.12),
    active: rgba(foreground, 0.18),
    buttonBackground: rgb(foreground),
    buttonForeground: rgb(surface),
    overlay: `linear-gradient(105deg, ${rgba(surface, 0.72)} 0%, ${rgba(
      surface,
      0.84,
    )} 54%, ${rgba(surface, 0.94)} 100%)`,
    errorSurface: foregroundIsLight
      ? "rgb(7 12 10 / 0.52)"
      : "rgb(255 255 255 / 0.38)",
  };
}

export const DEFAULT_PLAYER_PALETTE = playerPalette({ red: 37, green: 61, blue: 55 });

export function paletteFromCover(url: string): Promise<PlayerPalette> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable.");
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const buckets = new Map<
          string,
          {
            red: number;
            green: number;
            blue: number;
            weight: number;
            score: number;
          }
        >();
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] / 255;
          if (alpha < 0.1) continue;
          const maximum = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
          const minimum = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
          const saturation = maximum ? (maximum - minimum) / maximum : 0;
          const lightness = (maximum + minimum) / (2 * 255);
          if ((lightness > 0.93 && saturation < 0.14) || lightness < 0.05) {
            continue;
          }
          const pixelWeight = alpha * (0.2 + saturation * 2);
          const key = `${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${
            pixels[index + 2] >> 4
          }`;
          const bucket = buckets.get(key) ?? {
            red: 0,
            green: 0,
            blue: 0,
            weight: 0,
            score: 0,
          };
          bucket.red += pixels[index] * pixelWeight;
          bucket.green += pixels[index + 1] * pixelWeight;
          bucket.blue += pixels[index + 2] * pixelWeight;
          bucket.weight += pixelWeight;
          bucket.score += pixelWeight;
          buckets.set(key, bucket);
        }
        const dominant = [...buckets.values()].sort(
          (first, second) => second.score - first.score,
        )[0];
        if (!dominant?.weight) throw new Error("The cover has no visible pixels.");
        resolve(
          playerPalette({
            red: Math.round(dominant.red / dominant.weight),
            green: Math.round(dominant.green / dominant.weight),
            blue: Math.round(dominant.blue / dominant.weight),
          }),
        );
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("The cover could not be sampled."));
    image.src = url;
  });
}
