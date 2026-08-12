import { repositoryRoot } from "../runtime-paths.ts";

export const MANIM_QUALITIES = ["draft", "standard", "high"] as const;
export type ManimQuality = (typeof MANIM_QUALITIES)[number];

export const MANIM_QUALITY_FLAGS: Record<ManimQuality, "l" | "m" | "h"> = {
  draft: "l",
  standard: "m",
  high: "h",
};

export const MAX_MANIM_SOURCE_BYTES = 64 * 1024;
export const MAX_MANIM_VIDEO_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MANIM_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_MANIM_IMAGE = "manimcommunity/manim:v0.20.1";

export interface ManimConfig {
  dockerExecutable: string;
  image: string;
  timeoutMs: number;
  repositoryRoot: string;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function readManimConfig(): ManimConfig {
  return {
    dockerExecutable: env("MANIM_DOCKER_BIN") ?? "docker",
    image: env("MANIM_DOCKER_IMAGE") ?? DEFAULT_MANIM_IMAGE,
    timeoutMs: Number(env("MANIM_TIMEOUT_MS") ?? "") || DEFAULT_MANIM_TIMEOUT_MS,
    repositoryRoot: repositoryRoot(),
  };
}
