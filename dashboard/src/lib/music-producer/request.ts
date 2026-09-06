import { z } from "zod";
export const musicSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact"), artifactId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("attachment"), blobId: z.string().regex(/^aud_[a-f0-9]{32}$/) }).strict(),
]);
export const musicRequestSchema = z.object({
  operation: z.enum(["generate", "variation", "reference", "cover", "repaint", "arrange"]).default("generate"),
  brief: z.string().min(1).max(8000),
  lyrics: z.string().max(16000).default(""),
  lyricsAction: z.enum(["preserve", "rewrite", "remove"]).default("preserve"),
  vocalMode: z.enum(["instrumental", "vocal"]).default("instrumental"),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).nullable().default(null),
  duration: z.number().min(10).max(600).default(60),
  bpm: z.number().int().min(30).max(300).nullable().default(null),
  key: z.string().regex(/^[A-G](?:#|b)? (?:major|minor)$/i).nullable().default(null),
  timeSignature: z.enum(["2/4", "3/4", "4/4", "6/8"]).nullable().default(null),
  seed: z.number().int().min(0).max(2147483647).nullable().default(null),
  source: musicSourceSchema.nullable().default(null),
  interval: z.object({ start: z.number().min(0), end: z.number().positive().max(600) }).strict().nullable().default(null),
  preserveOutsideInterval: z.boolean().default(false),
  outputFormat: z.literal("wav").default("wav"),
  inferenceSteps: z.number().int().min(1).max(200).nullable().default(null),
  guidanceScale: z.number().min(1).max(20).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (["variation", "reference", "cover", "repaint"].includes(value.operation) && !value.source)
    issue("Choose a source from this conversation and pin its version.");
  if (value.operation === "generate" && value.source)
    issue("Use reference, cover, repaint or variation when specifying a source.");
  if (value.operation === "repaint") {
    if (!value.interval || value.interval.end <= value.interval.start || value.interval.end > value.duration)
      issue("Repaint requires a valid interval within the source duration.");
  }
  else if (value.interval || value.preserveOutsideInterval)
    issue("Intervals are only supported for repainting.");
  if (value.vocalMode === "instrumental" && value.lyrics)
    issue("Instrumental requests cannot contain lyrics.");
  if (value.operation === "arrange" && value.vocalMode !== "instrumental")
    issue("Resonant arrangement currently supports instruments and imported audio; create vocal songs with ACE-Step first.");
  if (value.operation === "arrange" && ((value.timeSignature && value.timeSignature !== "4/4") || value.seed !== null || value.inferenceSteps !== null || value.guidanceScale !== null))
    issue("Resonant supports 4/4 arrangements; ACE-Step seeds and inference settings do not apply.");
  if (value.vocalMode === "vocal" && (!value.lyrics || !value.language))
    issue("Vocal songs require lyrics and their language.");
});
export type MusicRequest = z.infer<typeof musicRequestSchema>;
export type MusicSource = z.infer<typeof musicSourceSchema>;
export function musicDefaults(values: Record<string, unknown>) {
  return {
    duration: typeof values.duration === "number" ? values.duration : 60,
    vocalMode: values.vocalMode === "vocal" ? "vocal" as const : "instrumental" as const,
  };
}
/** Explicit flags win over a model's interpretation and stored defaults. */
export function musicFlags(task: string): Partial<MusicRequest> {
  task = task.split(/(?:^|\n)Lyrics:\s*\r?\n/i)[0];
  const allowed = new Set(["duration", "bpm", "seed", "language", "instrumental", "source", "arrange", "resume"]);
  for (const match of task.matchAll(/--([A-Za-z][A-Za-z0-9_-]*)/g))
    if (!allowed.has(match[1].toLowerCase()))
      throw Error(`Unsupported Music Producer flag: --${match[1]}`);
  const result: Partial<MusicRequest> = {};
  for (const [flag, field] of [["duration", "duration"], ["bpm", "bpm"], ["seed", "seed"]] as const) {
    const match = new RegExp(`--${flag}\\s+(\\S+)`, "i").exec(task);
    if (new RegExp(`--${flag}\\b`, "i").test(task) && !match)
      throw Error(`--${flag} needs a numeric value.`);
    if (match)
      result[field] = Number(match[1]);
  }
  if (/--instrumental\b/i.test(task))
    result.vocalMode = "instrumental";
  const language = /--language\s+([^\s]+)/i.exec(task);
  if (language)
    result.language = language[1];
  if (/--arrange\b/i.test(task))
    result.operation = "arrange";
  const source = /--source\s+([A-Za-z0-9_-]+)@(\d+)\b/.exec(task);
  if (/--source\b/.test(task) && !source)
    throw Error("Select a source as --source ARTIFACT_ID@VERSION.");
  if (source)
    result.source = { kind: "artifact", artifactId: source[1], version: Number(source[2]) };
  return result;
}
