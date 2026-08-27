// Turning "cut the dead air and make it vertical" into a cut.
//
// This is the reasoning step of the clone's pipeline — Transcribe → Pack → LLM
// Reasons → EDL → Render — and it is the only step Breadboard performs itself,
// because the clone's version of it is a Claude Code session and Breadboard
// already has a model layer. The craft it needs is not invented here: the hard
// rules and the cut technique are read out of the clone's own SKILL.md at run
// time, so the editing standard tracks the checkout rather than a copy of it
// that silently goes stale.
//
// The output is not a video and not a filter string — it is a whole edit
// program, replacing the previous one. That matters for the studio: the tenth
// prompt is not ten stacked effects, it is the tenth revision of one plan, so
// "actually, put the intro back" is a thing the model can do rather than a thing
// that needs an undo stack.

import path from "node:path";
import {
  externalRuntimeLstat,
  externalRuntimeReadUtf8,
} from "../external-runtime-filesystem.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { describeTransportFailure } from "../model-transport.ts";
import { humanizeProviderError } from "../provider-error.ts";
import { GRADE_PRESETS } from "./filters.ts";
import {
  programDurationSeconds,
  validatePlan,
  VideoProgramError,
  type VideoEditProgram,
} from "./program.ts";
import type { VideoProbe } from "./media.ts";

const MODEL_TIMEOUT_MS = 180_000;
const MAX_MODEL_REQUEST_BYTES = 128 * 1024;
const MAX_MODEL_RESPONSE_BYTES = 512 * 1024;
const MAX_MODEL_ERROR_BYTES = 16 * 1024;
const MAX_SKILL_BYTES = 256 * 1024;

const MODEL_TRANSPORT_ATTEMPTS = 2;
const MODEL_TRANSPORT_RETRY_MS = 1_500;

export class VideoPlanError extends Error {
  /**
   * True when the request never reached the model — a dropped socket rather
   * than an answer anyone disagrees with. Only these are worth repeating: the
   * plan is the one step of the pipeline that leaves this machine, and by the
   * time it runs, the probe, the transcription and the silence map have already
   * been paid for. Throwing that away over a connection that can be remade is
   * the difference between a finished edit and two minutes of nothing.
   */
  readonly transport: boolean;

  constructor(message: string, options: { transport?: boolean } = {}) {
    super(message);
    this.name = "VideoPlanError";
    this.transport = options.transport ?? false;
  }
}

export interface PlanUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface VideoPlanResult {
  program: Omit<VideoEditProgram, "history" | "version"> & { summary: string };
  usage: PlanUsage;
  /** True when the first answer failed validation and the repair pass fixed it. */
  repaired: boolean;
}

// ---------------------------------------------------------------------------
// The clone's own instructions
// ---------------------------------------------------------------------------

/**
 * Lift a `## `-delimited section out of SKILL.md. Returns null rather than a
 * guess when the heading has been renamed upstream — a wrong section is worse
 * than the built-in fallback.
 *
 * Deliberately no `m` flag. With it, `$` matches at the end of *every* line, so
 * the lazy body group closes on the first newline and every section comes back
 * empty — which reads as "the heading is gone" and silently falls back to the
 * built-in text. `(?:^|\n)` does the line-start job instead, and the file's
 * CRLF endings are normalized first so `\r` cannot end up inside the prompt.
 */
function skillSection(skill: string, heading: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)##[ \\t]+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)`,
    "i",
  );
  const match = pattern.exec(skill);
  const body = match?.[1]?.trim();
  return body ? body : null;
}

const FALLBACK_CRAFT = `- Cut candidates come from speech boundaries and silence gaps; audio is primary and the picture follows.
- Silences of 400ms or more are the cleanest cut targets. Between 150ms and 400ms is usable. Under 150ms is mid-phrase and unsafe.
- Never cut inside a word.
- Pad every cut edge by 30-200ms; timestamps drift and padding absorbs it.
- Preserve peaks: laughs, punchlines and emphasis beats. Extend past a punchline to include the reaction.
- Speaker handoffs want 400-600ms of air between utterances.`;

/**
 * The editing standard, read from the checkout. Cached for the process because
 * SKILL.md does not change under a running server, and it is 23 KB.
 */
let cachedInstructions: { root: string; value: string } | null = null;

export function editingInstructions(root: string): string {
  if (cachedInstructions?.root === root) return cachedInstructions.value;
  let skill = "";
  try {
    const skillPath = path.join(root, "SKILL.md");
    const metadata = externalRuntimeLstat(skillPath);
    if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= MAX_SKILL_BYTES) {
      skill = externalRuntimeReadUtf8(skillPath).replace(/\r\n/g, "\n");
    }
  } catch {
    skill = "";
  }
  const rules = skill ? skillSection(skill, "Hard Rules") : null;
  const craft = skill ? skillSection(skill, "Cut craft") : null;
  const value = [
    craft ?? FALLBACK_CRAFT,
    rules
      ? `Production rules the renderer enforces (context — you do not implement these):\n${rules}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6_000);
  cachedInstructions = { root, value };
  return value;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function systemPrompt(root: string): string {
  return [
    "You are the editor in a video editing pipeline. You do not see the video: you read it, from a transcript or a silence map, and you decide the cut.",
    "",
    "You answer with ONE JSON object and nothing else. No prose, no code fence, no explanation outside the object.",
    "",
    "```",
    "{",
    '  "summary": "one sentence, past tense, describing what you changed",',
    '  "ranges": [{"start": 0.0, "end": 12.5, "reason": "why this is in the cut"}],',
    '  "grade": null,',
    '  "aspect": "original",',
    '  "subtitles": "none",',
    '  "transform": {"speed": 1, "mute": false, "volumeDb": 0, "fadeInSeconds": 0, "fadeOutSeconds": 0, "reverse": false}',
    "}",
    "```",
    "",
    "Field rules:",
    "- `ranges` are seconds into the ORIGINAL source, in the order they should play. They may skip material, repeat it, or reorder it. They are the whole cut: whatever is not in a range is not in the video.",
    `- \`grade\` is null, one of ${GRADE_PRESETS.map((preset) => `"${preset}"`).join(", ")}, or an ffmpeg video filter chain (for example "eq=contrast=1.08:saturation=1.1"). "auto" analyses each segment and applies a subtle correction — it is the right choice when someone asks for a clean-up rather than a look. File paths, graph labels and quotes are refused.`,
    '- `aspect` is "original", "16:9", "9:16", "1:1" or "4:5". Anything but "original" centre-crops and rescales the frame.',
    '- `subtitles` is "burn" only when captions were asked for AND a transcript is available. Otherwise "none".',
    "- `transform` applies to the finished cut. `speed` 0.25-4 (audio is pitch-corrected), `volumeDb` -30 to 20, fades in seconds, `reverse` plays it backwards.",
    "",
    "How to decide:",
    editingInstructions(root),
    "",
    "You are revising an existing edit program, not starting from nothing. Keep everything the person did not ask you to change. If they ask for something this pipeline cannot do (an overlay, a new soundtrack, a graphic), do the part you can and say what you skipped in `summary`.",
    "Do not ask questions. If anything is ambiguous, pick the most obvious interpretation and proceed.",
  ].join("\n");
}

function describeProgram(program: VideoEditProgram): string {
  const lines = [
    `ranges (${program.ranges.length}):`,
    ...program.ranges
      .slice(0, 40)
      .map(
        (range) =>
          `  [${range.start.toFixed(2)}-${range.end.toFixed(2)}] ${range.reason || "kept"}`,
      ),
    program.ranges.length > 40 ? `  … ${program.ranges.length - 40} more` : "",
    `grade: ${program.grade ?? "none"}`,
    `aspect: ${program.aspect}`,
    `subtitles: ${program.subtitles}`,
    `transform: speed ${program.transform.speed}, ${program.transform.mute ? "muted" : `volume ${program.transform.volumeDb}dB`}, fade in ${program.transform.fadeInSeconds}s, fade out ${program.transform.fadeOutSeconds}s${program.transform.reverse ? ", reversed" : ""}`,
    `current runtime: ${programDurationSeconds(program).toFixed(1)}s`,
  ];
  return lines.filter(Boolean).join("\n");
}

export interface VideoPlanInput {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  root: string;
  probe: VideoProbe;
  program: VideoEditProgram;
  /** The packed phrase-level transcript, when there is one. */
  packedTranscript: string | null;
  /** The silence map, used when there is no transcript. */
  silenceMap: string | null;
  prompt: string;
  signal?: AbortSignal;
  /**
   * Called when a lost connection is about to be retried, so the run can say so
   * instead of appearing to stall on "Planning the cut" for twice as long.
   */
  onTransportRetry?: (detail: string) => void;
}

function userPrompt(input: VideoPlanInput, correction?: string): string {
  const { probe } = input;
  const sections = [
    "SOURCE",
    `  duration: ${probe.durationSeconds.toFixed(2)}s`,
    `  frame: ${probe.width}x${probe.height}${probe.portrait ? " (portrait)" : ""} at ${probe.fps || "unknown"}fps`,
    `  audio: ${probe.hasAudio ? probe.audioCodec ?? "present" : "none"}`,
    "",
    "CURRENT EDIT PROGRAM",
    describeProgram(input.program),
    "",
  ];

  if (input.program.history.length) {
    sections.push(
      "WHAT HAS BEEN ASKED FOR SO FAR",
      ...input.program.history
        .slice(-8)
        .map((entry) => `  ${entry.version}. "${entry.prompt}" → ${entry.summary}`),
      "",
    );
  }

  if (input.packedTranscript) {
    sections.push(
      "TRANSCRIPT (phrase level, [start-end] in seconds, speaker id after the range)",
      input.packedTranscript,
      "",
    );
  } else {
    sections.push(
      "NO TRANSCRIPT IS AVAILABLE — plan from the silence map and the clock. Do not invent quotes.",
      input.silenceMap ?? "No silence information could be read from the audio.",
      "",
    );
  }

  if (correction) {
    sections.push(
      "YOUR PREVIOUS ANSWER WAS REJECTED",
      `  ${correction}`,
      "  Answer again, corrected, with the same JSON object and nothing else.",
      "",
    );
  }

  sections.push("THE REQUEST", input.prompt.trim());
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Model call
// ---------------------------------------------------------------------------

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

async function providerFailureMessage(response: Response): Promise<string> {
  const fallback = `The model endpoint returned ${response.status}.`;
  let body = "";
  try {
    body = await readBoundedResponseText(response, MAX_MODEL_ERROR_BYTES);
  } catch {
    return fallback;
  }
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "");
  } catch {
    detail = body;
  }
  const humanized = humanizeProviderError(detail).trim().slice(0, 2_000);
  return humanized ? `${humanized} (HTTP ${response.status})` : fallback;
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new VideoPlanError("The model returned more planning data than this edit accepts.");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new VideoPlanError("The model returned more planning data than this edit accepts.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

/**
 * Say what actually went wrong when the request never reached the model.
 *
 * The translation itself is shared — every agent that calls a model has the
 * same "fetch failed" to explain — and only the two sentences around it belong
 * to editing: what was being attempted, and the promise that nothing changed.
 */
export function transportFailureMessage(error: unknown, baseUrl: string): string {
  return describeTransportFailure(error, {
    endpoint: completionsUrl(baseUrl),
    lead: "The edit could not be planned",
    recovery: "Check that the model service is running, then ask again — nothing was changed.",
  });
}

async function completeOnce(
  input: VideoPlanInput,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; usage: PlanUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);
  try {
    const body = JSON.stringify({
      model: input.model,
      messages,
      ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
    });
    if (Buffer.byteLength(body, "utf8") > MAX_MODEL_REQUEST_BYTES) {
      throw new VideoPlanError("The edit context is too large to plan safely.");
    }
    const response = await fetch(completionsUrl(input.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new VideoPlanError(await providerFailureMessage(response));
    let data: {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      data = JSON.parse(
        await readBoundedResponseText(response, MAX_MODEL_RESPONSE_BYTES),
      ) as typeof data;
    } catch (error) {
      if (error instanceof VideoPlanError) throw error;
      throw new VideoPlanError("The model returned an unreadable edit plan.");
    }
    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: Number.isSafeInteger(inputTokens) && (inputTokens ?? -1) >= 0
          ? inputTokens as number
          : 0,
        outputTokens: Number.isSafeInteger(outputTokens) && (outputTokens ?? -1) >= 0
          ? outputTokens as number
          : 0,
      },
    };
  } catch (error) {
    if (error instanceof VideoPlanError) throw error;
    if (controller.signal.aborted && input.signal?.aborted) {
      throw new VideoPlanError("The edit was stopped.");
    }
    // The other abort is this function's own timer, which is a slow model
    // rather than a broken connection and reads as "aborted" if left alone.
    if (controller.signal.aborted) {
      throw new VideoPlanError(
        `The model took longer than ${Math.round(
          MODEL_TIMEOUT_MS / 60_000,
        )} minutes to plan the edit, so it was given up on. Nothing was changed — try again, or ask for a simpler edit.`,
      );
    }
    throw new VideoPlanError(transportFailureMessage(error, input.baseUrl), {
      transport: true,
    });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The model call, with one repeat if the connection failed.
 *
 * Only a transport failure is repeated. An HTTP error is the service answering
 * — asking again gets the same answer — and the timeout above is a model that
 * is genuinely slow, where a second 3-minute wait helps nobody. A dropped
 * socket is the one case where the same request would simply have worked, and
 * it is worth catching precisely because everything expensive already happened:
 * this call is the last step before the render, and the whole run dies with it.
 */
async function complete(
  input: VideoPlanInput,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; usage: PlanUsage }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await completeOnce(input, messages);
    } catch (error) {
      const retryable =
        error instanceof VideoPlanError &&
        error.transport &&
        attempt < MODEL_TRANSPORT_ATTEMPTS &&
        !input.signal?.aborted;
      if (!retryable) throw error;
      input.onTransportRetry?.("Lost the connection to the model — trying once more");
      await sleep(MODEL_TRANSPORT_RETRY_MS, input.signal);
      // Stopping during the pause is a stop, not a reason to send the request.
      if (input.signal?.aborted) throw new VideoPlanError("The edit was stopped.");
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Pull the JSON out of a reply. ChatMock inlines its reasoning summary as a
 * `<think>` block and models like to wrap JSON in a fence, so neither is
 * treated as a failure.
 */
export function extractJson(content: string): unknown {
  const withoutThinking = content
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(withoutThinking);
  const candidates = [fenced?.[1], withoutThinking].filter(
    (value): value is string => typeof value === "string",
  );
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Plan one revision. A rejected answer gets exactly one corrected attempt, with
 * the refusal quoted back — most failures are a range past the end of the file
 * or a filter the allowlist does not carry, and both are one sentence to fix.
 * A second failure is reported rather than retried, because at that point the
 * model is not misreading the format, it is disagreeing with it.
 */
export async function planEdit(input: VideoPlanInput): Promise<VideoPlanResult> {
  const system = systemPrompt(input.root);
  const usage: PlanUsage = { inputTokens: 0, outputTokens: 0 };
  let correction: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await complete(input, [
      { role: "system", content: system },
      { role: "user", content: userPrompt(input, correction) },
    ]);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    const parsed = extractJson(result.content);
    if (!parsed) {
      correction = "You did not answer with a JSON object.";
      continue;
    }
    try {
      const program = validatePlan(parsed, {
        durationSeconds: input.probe.durationSeconds,
        hasTranscript: Boolean(input.packedTranscript),
      });
      return { program, usage, repaired: attempt > 0 };
    } catch (error) {
      if (!(error instanceof VideoProgramError)) throw error;
      correction = error.message;
    }
  }

  throw new VideoPlanError(
    correction
      ? `The editor could not produce a usable cut: ${correction}`
      : "The editor could not produce a usable cut.",
  );
}
