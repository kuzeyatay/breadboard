import type { MusicRequest } from "../music-producer/request.ts";
export const ACESTEP_REVISION = "ca1e85fe9430179831e6bc6be790c332190a3866";
export const ACESTEP_CAPABILITY_VERSION = 1;
export const ACESTEP_MODELS = ["acestep-v15-turbo", "acestep-v15-sft", "acestep-v15-base"] as const;
export type AceStepModel = typeof ACESTEP_MODELS[number];
/** Conservative, reviewed mapping, intersected with GET /v1/models. No discovery endpoint is invented. */
export function capabilitiesFor(model: string) {
  if (!(ACESTEP_MODELS as readonly string[]).includes(model))
    throw new Error("unsupported_model: select a reviewed ACE-Step model.");
  const turbo = model === "acestep-v15-turbo";
  return {
    provider: "acestep", model: model as AceStepModel, revision: ACESTEP_REVISION,
    mappingVersion: ACESTEP_CAPABILITY_VERSION,
    operations: ["generate", "variation", "reference", "cover", "repaint"] as const,
    formats: ["wav"] as const, duration: { min: 10, max: 600 }, bpm: { min: 30, max: 300 },
    inferenceSteps: { min: 1, max: turbo ? 20 : 200, default: turbo ? 8 : 50 },
    guidance: model === "acestep-v15-base", perTaskCancellation: false,
    extension: false, stemExtraction: false,
  };
}
export function providerPayload(request: MusicRequest, model: string) {
  if (request.operation === "arrange")
    throw new Error("Arrangement requires the optional Resonant adapter.");
  const capabilities = capabilitiesFor(model);
  if (request.inferenceSteps !== null && request.inferenceSteps > capabilities.inferenceSteps.max)
    throw new Error("unsupported_inference_steps");
  if (request.guidanceScale !== null && !capabilities.guidance)
    throw new Error("guidance_unsupported_by_model");
  const taskType = request.operation === "cover" ? "cover" : request.operation === "repaint" ? "repaint" : "text2music";
  return {
    model, prompt: request.brief, lyrics: request.vocalMode === "instrumental" ? "[Instrumental]" : request.lyrics,
    vocal_language: request.language ?? "unknown", audio_duration: request.duration,
    ...(request.bpm === null ? {} : { bpm: request.bpm }),
    key_scale: request.key ?? "", time_signature: request.timeSignature?.split("/")[0] ?? "",
    use_random_seed: request.seed === null, seed: request.seed ?? -1, batch_size: 1,
    task_type: taskType, audio_format: "wav", thinking: false,
    sample_mode: false, use_format: false, use_cot_caption: false, use_cot_language: false,
    inference_steps: request.inferenceSteps ?? capabilities.inferenceSteps.default,
    ...(request.guidanceScale === null ? {} : { guidance_scale: request.guidanceScale }),
    ...(request.interval ? { repainting_start: request.interval.start, repainting_end: request.interval.end, chunk_mask_mode: "explicit" } : {}),
  };
}
