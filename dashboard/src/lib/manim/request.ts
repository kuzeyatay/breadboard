import {
  MANIM_QUALITIES,
  MAX_MANIM_SOURCE_BYTES,
  type ManimQuality,
} from "./config.ts";

export class ManimServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManimServiceError";
    this.code = code;
  }
}

export interface ManimRequest {
  title: string;
  description: string;
  code: string;
  sceneName: string;
  quality: ManimQuality;
}

const SAFE_IMPORT = /^(?:from\s+(?:manim|numpy|math)(?:\.[A-Za-z_][\w.]*)?\s+import\s+.+|import\s+math(?:\s+as\s+\w+)?|import\s+numpy(?:\s+as\s+\w+)?)\s*$/;
const IMPORT_LINE = /^\s*(?:from\s+\S+\s+import\s+|import\s+)/;
const FORBIDDEN_SOURCE = [
  [/__/, "dunder access"],
  [/\b(?:open|exec|eval|compile|input|breakpoint|globals|locals|getattr|setattr|delattr)\s*\(/, "dynamic Python built-ins"],
  [/\b(?:os|sys|subprocess|socket|pathlib|shutil|requests|urllib|http|ftplib|pickle|marshal)\b/, "system, filesystem, or network modules"],
] as const;

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ManimServiceError("manim_invalid_arguments", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maximum) {
    throw new ManimServiceError(
      "manim_invalid_arguments",
      `${field} cannot exceed ${maximum} characters.`,
    );
  }
  return trimmed;
}

/** Validate the public tool payload without importing a process module. */
export function validateManimRequest(args: Record<string, unknown>): ManimRequest {
  const title = text(args.title, "title", 240);
  const description = text(args.description, "description", 1_000);
  const code = text(args.code, "code", MAX_MANIM_SOURCE_BYTES);
  if (Buffer.byteLength(code, "utf8") > MAX_MANIM_SOURCE_BYTES) {
    throw new ManimServiceError(
      "manim_invalid_source",
      `code cannot exceed ${MAX_MANIM_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }
  const sceneName = args.sceneName === undefined
    ? "BreadboardScene"
    : text(args.sceneName, "sceneName", 64);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(sceneName)) {
    throw new ManimServiceError(
      "manim_invalid_arguments",
      "sceneName must be a valid Python class name.",
    );
  }
  const quality = args.quality === undefined ? "standard" : args.quality;
  if (typeof quality !== "string" || !(MANIM_QUALITIES as readonly string[]).includes(quality)) {
    throw new ManimServiceError(
      "manim_invalid_arguments",
      `quality must be one of ${MANIM_QUALITIES.join(", ")}.`,
    );
  }
  if (!/^\s*from\s+manim\s+import\s+\*/m.test(code)) {
    throw new ManimServiceError(
      "manim_invalid_source",
      "The scene must import Manim with `from manim import *`.",
    );
  }
  const scenePattern = new RegExp(
    `^\\s*class\\s+${sceneName}\\s*\\(\\s*(?:Scene|ThreeDScene|MovingCameraScene|ZoomedScene)\\s*\\)\\s*:`,
    "m",
  );
  if (!scenePattern.test(code)) {
    throw new ManimServiceError(
      "manim_invalid_source",
      `${sceneName} must extend Scene, ThreeDScene, MovingCameraScene, or ZoomedScene.`,
    );
  }
  for (const line of code.split(/\r?\n/)) {
    if (IMPORT_LINE.test(line) && !SAFE_IMPORT.test(line.trim())) {
      throw new ManimServiceError(
        "manim_invalid_source",
        `Unsupported import: ${line.trim().slice(0, 160)}.`,
      );
    }
  }
  for (const [pattern, label] of FORBIDDEN_SOURCE) {
    if (pattern.test(code)) {
      throw new ManimServiceError(
        "manim_invalid_source",
        `The scene cannot use ${label}.`,
      );
    }
  }
  return {
    title,
    description,
    code: `${code}\n`,
    sceneName,
    quality: quality as ManimQuality,
  };
}
