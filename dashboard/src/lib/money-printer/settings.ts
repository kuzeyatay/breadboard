// What a MoneyPrinter run uses for everything the message does not say.
//
// The values themselves live where every other agent's defaults live — the
// per-user agent-settings catalog and store. This module is only the vocabulary
// in between: reading the catalog's stored values back as the request shape the
// run manager works in, and applying the defaults for anything an older stored
// row is missing.
//
// Every field here maps to a real parameter of the clone's own `VideoParams`
// (see app/models/schema.py). Nothing is invented: a setting the clone cannot
// honour would be a lie told in a settings dialog.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";
import { DEFAULT_MONEY_PRINTER_VOICE } from "./identity.ts";
import type {
  MoneyPrinterAspect,
  MoneyPrinterConcat,
  MoneyPrinterRequest,
  MoneyPrinterSource,
} from "./identity.ts";

export type MoneyPrinterDefaults = Omit<
  MoneyPrinterRequest,
  "subject" | "script" | "terms"
>;

export const DEFAULT_MONEY_PRINTER_SETTINGS: MoneyPrinterDefaults = {
  // Short-form video is the tool's whole point, so a run is vertical unless it
  // is told otherwise.
  aspect: "9:16",
  source: "pexels",
  language: "",
  voice: DEFAULT_MONEY_PRINTER_VOICE,
  paragraphs: 1,
  clipSeconds: 5,
  concat: "random",
  subtitles: true,
  music: true,
  videoCount: 1,
};

const ASPECTS = new Set<string>(["9:16", "16:9", "1:1"]);
const SOURCES = new Set<string>(["pexels", "pixabay", "coverr", "local"]);
const CONCATS = new Set<string>(["random", "sequential"]);
const MAX_VOICE_LENGTH = 120;
const MAX_LANGUAGE_LENGTH = 12;

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Read the catalog's stored values as run defaults. The catalog already
 * normalised them, so this only maps names and falls back for anything a stored
 * row written before a field existed is missing.
 */
export function moneyPrinterSettingsFrom(values: AgentSettingValues): MoneyPrinterDefaults {
  const aspect = boundedText(values.aspect, 8);
  const source = boundedText(values.source, 12);
  const concat = boundedText(values.concat, 12);
  return {
    aspect: ASPECTS.has(aspect)
      ? (aspect as MoneyPrinterAspect)
      : DEFAULT_MONEY_PRINTER_SETTINGS.aspect,
    source: SOURCES.has(source)
      ? (source as MoneyPrinterSource)
      : DEFAULT_MONEY_PRINTER_SETTINGS.source,
    // An empty language box means "follow the subject", not "no language".
    language: boundedText(values.language, MAX_LANGUAGE_LENGTH),
    voice: boundedText(values.voice, MAX_VOICE_LENGTH) || DEFAULT_MONEY_PRINTER_VOICE,
    paragraphs: clamp(values.paragraphs, 1, 10, DEFAULT_MONEY_PRINTER_SETTINGS.paragraphs),
    clipSeconds: clamp(values.clipSeconds, 1, 30, DEFAULT_MONEY_PRINTER_SETTINGS.clipSeconds),
    concat: CONCATS.has(concat)
      ? (concat as MoneyPrinterConcat)
      : DEFAULT_MONEY_PRINTER_SETTINGS.concat,
    // An unset boolean has to read as the default rather than as false, or every
    // stored row written before this field existed would silently disable it.
    subtitles: typeof values.subtitles === "boolean" ? values.subtitles : true,
    music: typeof values.music === "boolean" ? values.music : true,
    videoCount: clamp(values.count, 1, 5, DEFAULT_MONEY_PRINTER_SETTINGS.videoCount),
  };
}

/**
 * The request as the clone's own `TaskVideoRequest` body.
 *
 * Kept here rather than inline in the run manager because it is a protocol
 * boundary: every key is a field of the cloned project's Pydantic model, and a
 * name that drifts would be silently dropped by FastAPI rather than rejected.
 *
 * `localMaterials` are the filenames the clone's own `/video_materials` listing
 * reported. A local run has to name them: the pipeline never scans that folder
 * for itself, and a local request without them fails at the materials stage
 * with "no valid local video materials were found". Filenames rather than
 * paths, because the clone resolves them inside `storage/local_videos` and
 * refuses anything that escapes it.
 */
export function taskRequestBody(
  request: MoneyPrinterRequest,
  localMaterials: readonly string[] = [],
): Record<string, unknown> {
  return {
    ...(request.source === "local"
      ? {
          video_materials: localMaterials.map((name) => ({
            provider: "local",
            url: name,
            // The real length is measured while the video is cut; the clone's
            // own CLI sends the same placeholder.
            duration: 0,
          })),
        }
      : {}),
    video_subject: request.subject,
    video_script: request.script,
    video_terms: request.terms ?? null,
    video_language: request.language,
    video_aspect: request.aspect,
    video_concat_mode: request.concat,
    video_clip_duration: request.clipSeconds,
    video_count: request.videoCount,
    video_source: request.source,
    paragraph_number: request.paragraphs,
    voice_name: request.voice,
    subtitle_enabled: request.subtitles,
    // The clone reads "random" as "pick one of the bundled songs" and treats a
    // zero volume as "no music at all", which is how music is turned off
    // without naming a file that does not exist.
    bgm_type: request.music ? "random" : "",
    bgm_volume: request.music ? 0.2 : 0,
  };
}
