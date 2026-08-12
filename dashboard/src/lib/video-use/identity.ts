// The Video Use agent's chat identity, and the one question that makes it
// different from every other agent here: *should it take this turn at all?*
//
// Video Use is the only runtime agent that selects itself. Every other agent
// waits to be picked from the Agents tab or reached by its slash command; this
// one also runs when someone attaches a video and asks, in their own words, for
// it to be changed. That is the whole point — a person who drops a clip and
// types "cut the dead air at the start" should not have to know an agent exists.
//
// Self-selection is only safe if it is *narrow*. A video attached to "what is
// this about?" is a question, not an edit, and hijacking that turn would be
// worse than never triggering at all: the answer the person wanted is replaced
// by a render they did not ask for. So `videoEditIntent` below is deliberately
// biased toward saying no, and every rule in it is covered by a test.
//
// Deliberately free of Node imports — the composer imports this too.

import { isVideoBlobId } from "../video-attachments.ts";

export const VIDEO_USE_COMMAND = "/agents:video-use";
export const VIDEO_USE_AGENT_ID = "video-use";
export const VIDEO_USE_AGENT_NAME = "Video Use";

/**
 * Extract the task, preserving any other slash tokens the user stacked in front
 * of the command so the capability resolver still sees them.
 */
export function taskFromVideoUseCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:video-use") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function videoUseUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${VIDEO_USE_COMMAND} ${trimmed}` : VIDEO_USE_COMMAND;
}

/** What the run card and the transcript call this edit. */
export function videoUseRunLabel(input: { prompt: string; sourceName: string }): string {
  const prompt = input.prompt.replace(/\s+/g, " ").trim();
  const source = input.sourceName.trim() || "video";
  return prompt ? `${source} — ${prompt.slice(0, 120)}` : `Edit ${source}`;
}

// ---------------------------------------------------------------------------
// Edit intent
// ---------------------------------------------------------------------------

/**
 * Verbs and phrases that only make sense as an instruction to change the file.
 * Matched as whole words against a lowercased message.
 *
 * Kept as explicit strings rather than a clever stemmer because the failure
 * mode of a stemmer here is invisible: "cutting-edge AI video" should not read
 * as "cut".
 */
const EDIT_PHRASES = [
  // structural
  "cut", "cuts", "trim", "trims", "trimmed", "shorten", "shortened", "tighten",
  "splice", "stitch", "clip it", "clip this", "crop", "cropped", "chop",
  "condense", "compress it", "make it shorter", "make it longer", "loop",
  "reorder", "rearrange", "reverse it", "play it backwards",
  // removal
  "remove", "delete", "get rid of", "strip", "drop the", "take out", "cut out",
  "silence", "silences", "dead air", "dead space", "filler", "fillers", "ums",
  "uhs", "pauses", "gaps", "mistakes", "false starts", "bloopers",
  // additive
  "subtitle", "subtitles", "caption", "captions", "burn in", "add text",
  "overlay", "watermark", "intro", "outro", "fade in", "fade out", "fades",
  // look and sound
  "color grade", "colour grade", "grade it", "grading", "color correct",
  "colour correct", "brighten", "darken", "warmer", "cooler", "saturate",
  "desaturate", "contrast", "sharpen", "blur", "vignette", "cinematic",
  "normalize the audio", "normalise the audio", "louder", "quieter", "mute",
  "volume",
  // format — operations only. The format *nouns* live in FORMAT_TARGETS below,
  // because on their own they are as likely to be part of a question about the
  // video ("is this vertical?") as an instruction to produce one.
  "aspect ratio", "resize", "reframe", "letterbox",
  // speed
  "speed up", "speed it", "slow down", "slow it", "faster", "slower",
  "timelapse", "time lapse", "slow motion", "slowmo",
  // generic, but unambiguous when aimed at a video
  "edit", "edits", "re-edit", "reedit", "polish", "clean up", "clean it up",
  "fix up", "make it punchier", "punch it up", "render",
] as const;

/**
 * Naming a delivery format is asking for a different version of the video —
 * but only when something in the sentence says *produce*. "Make this a reel
 * format" is an edit; "what happens in the reel?" is a question about one, and
 * the difference between them is the verb, not the noun.
 *
 * This pair exists because the single-list version missed the commonest way
 * people actually ask: they name the platform, not the operation.
 */
const FORMAT_TARGETS = [
  "reel", "reels", "tiktok", "tik tok", "story", "stories", "igtv", "short",
  "shorts", "vertical", "portrait", "landscape", "square", "widescreen",
  "9:16", "16:9", "1:1", "4:5", "instagram", "youtube short",
] as const;

const SHAPING_VERBS = [
  "make", "makes", "turn", "turns", "convert", "converts", "export", "exports",
  "render", "renders", "save", "give me", "i want", "i need", "format",
  "formatted", "put it in", "put this in", "post it", "repurpose", "adapt",
  "resize", "reframe", "crop",
] as const;

/**
 * Requests that also mention a video but are asking *about* it. When one of
 * these is the only thing the message says, the turn belongs to the chat, not
 * to an editor.
 */
const READING_PHRASES = [
  "transcribe", "transcript", "transcription", "summarize", "summarise",
  "summary", "what is in", "what's in", "what happens", "what does",
  "describe", "explain", "translate", "analyse", "analyze", "review this",
  "watch this", "tell me about", "who is", "how long is", "identify",
  "extract the text", "read this", "notes from", "take notes",
] as const;

export type VideoEditIntent =
  | { edit: true; confidence: "explicit" | "likely"; matched: string }
  | { edit: false; reason: "no_edit_language" | "reading_request" };

/**
 * Does this message ask for the attached video to be changed?
 *
 * `explicit` means an editing verb was found and nothing suggests the person
 * was only asking a question about the file. `likely` covers the shortest real
 * case — a bare "make this vertical" with no verb this list knows — where an
 * output-format word carries the instruction on its own.
 *
 * A message that reads as a question wins over an edit word, because the cost
 * of a wrong yes (a render nobody wanted, minutes of compute, a surprise
 * artifact) is much higher than the cost of a wrong no (the person says "no, I
 * meant edit it", and the studio is one click away on the artifact anyway).
 */
export function videoEditIntent(message: string): VideoEditIntent {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { edit: false, reason: "no_edit_language" };

  const reading = READING_PHRASES.find((phrase) => containsPhrase(text, phrase));
  const edit = EDIT_PHRASES.find((phrase) => containsPhrase(text, phrase));

  // "transcribe this and then cut the filler" is an edit; "transcribe this" is
  // not. Both words present means the edit is what they want done to the file.
  if (edit) return { edit: true, confidence: "explicit", matched: edit };

  // No operation named. A delivery format still counts, but only alongside a
  // verb that asks for one to be produced — otherwise "what happens in the
  // reel?" would render a reel instead of answering.
  const target = FORMAT_TARGETS.find((phrase) => containsPhrase(text, phrase));
  const shaping = SHAPING_VERBS.find((phrase) => containsPhrase(text, phrase));
  if (target && shaping && !reading) {
    return { edit: true, confidence: "likely", matched: `${shaping} … ${target}` };
  }

  if (reading) return { edit: false, reason: "reading_request" };
  return { edit: false, reason: "no_edit_language" };
}

/**
 * Whole-phrase containment. A phrase with a space is matched literally; a
 * single word must sit on word boundaries, so "recut" does not match "cut" and
 * "discolor" does not match "color grade".
 */
function containsPhrase(text: string, phrase: string): boolean {
  if (phrase.includes(" ")) return text.includes(phrase);
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * What the run route accepts. An edit always names the video it changes: an
 * artifact that already exists (the studio, or a second pass in chat), a video
 * attached to the message being sent, or a link in it.
 *
 * A link is a source rather than something the composer resolves first, because
 * fetching is work and work belongs in the run — where it has a progress line
 * and a stop button — not in front of the send button.
 */
export type VideoUseSource =
  | { kind: "artifact"; artifactId: string }
  | { kind: "attachment"; blobId: string; filename: string }
  | { kind: "url"; url: string };

export interface VideoUseRequest {
  source: VideoUseSource;
  /** What the person asked for, in their own words. */
  prompt: string;
  /**
   * Render the full-quality output. A studio pass that is only checking a cut
   * can ask for the draft ladder instead, which is roughly six times faster.
   */
  quality: "final" | "preview";
}

export const VIDEO_USE_QUALITIES = ["final", "preview"] as const;

export function isVideoUseQuality(value: unknown): value is VideoUseRequest["quality"] {
  return typeof value === "string" && (VIDEO_USE_QUALITIES as readonly string[]).includes(value);
}

export const MAX_VIDEO_USE_PROMPT = 4_000;

/**
 * Read a run request out of an HTTP body.
 *
 * This exists so the fields a request can carry are enumerated in exactly one
 * place. The route used to list them itself, and when the `url` source was
 * added the route was not updated — so the browser sent a link, the route
 * dropped it, and every linked edit died on "Choose a video to edit". A new
 * source kind now means editing `VideoUseSource`, `parseVideoUseRequest` and
 * this function, all within a few lines of each other, and the tests drive this
 * with the exact payloads the launchers send.
 */
export function parseVideoUseRequestBody(
  submitted: unknown,
  defaults: { quality: VideoUseRequest["quality"] },
): VideoUseRequest {
  const body = (submitted ?? {}) as Record<string, unknown>;
  return parseVideoUseRequest({
    artifactId: body.artifactId,
    blobId: body.blobId,
    url: body.url,
    filename: body.filename,
    prompt: body.prompt,
    quality: body.quality ?? defaults.quality,
  });
}

export function parseVideoUseRequest(value: unknown): VideoUseRequest {
  if (!value || typeof value !== "object") throw new Error("A video edit request is required.");
  const body = value as Record<string, unknown>;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("Describe the change you want.");
  if (prompt.length > MAX_VIDEO_USE_PROMPT) throw new Error("That instruction is too long.");

  const artifactId = typeof body.artifactId === "string" ? body.artifactId.trim() : "";
  const blobId = typeof body.blobId === "string" ? body.blobId.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  let source: VideoUseSource;
  if (artifactId) {
    if (!/^art_[a-z0-9-]{6,64}$/i.test(artifactId)) throw new Error("That artifact id is not valid.");
    source = { kind: "artifact", artifactId };
  } else if (blobId) {
    if (!isVideoBlobId(blobId)) throw new Error("That video attachment id is not valid.");
    const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
    source = { kind: "attachment", blobId, filename: filename || "video.mp4" };
  } else if (url) {
    // Only the shape is checked here; which links name a single fetchable video
    // is `video-sources/identity.ts`'s job, and the run resolves it.
    if (url.length > 2_000 || !/^https?:\/\//i.test(url)) {
      throw new Error("That video link is not valid.");
    }
    source = { kind: "url", url };
  } else {
    throw new Error("Choose a video to edit.");
  }

  return {
    source,
    prompt,
    quality: isVideoUseQuality(body.quality) ? body.quality : "final",
  };
}
