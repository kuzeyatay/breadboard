// The ViMax agent's chat identity: the slash command that reaches it, and the
// parsing of a prompt into a production request.
//
// Mirrors the Hardware Blueprint / HyperFrames identity modules so every runtime
// agent is reached the same way — pick it from the Agents tab, prompt it in
// chat, and its own surface appears inline for that turn.

export const VIMAX_COMMAND = "/agents:vimax";
export const VIMAX_AGENT_ID = "vimax";
export const VIMAX_AGENT_NAME = "ViMax";

/** ViMax's two entry pipelines. `idea2video` writes the story first. */
export type VimaxMode = "idea2video" | "script2video";

export type VimaxAspectRatio = "16:9" | "9:16" | "1:1";

/**
 * Which model draws the frames.
 *
 * `auto` uses whichever image model the provider offers and falls back to the
 * chat model's image tool. The named choices exist because the two run on
 * different subscriptions: a ChatGPT quota that has run out does not stop
 * Gemini from drawing, and vice versa.
 */
export type VimaxImageGenerator = "auto" | "gemini" | "chatgpt";

export interface VimaxRequest {
  /** The idea or screenplay, with the flags stripped out. */
  brief: string;
  mode: VimaxMode;
  /** Visual style, e.g. "Cartoon". Null lets the director choose one. */
  style: string | null;
  /** Requested scene count, or null to let the screenwriter decide. */
  sceneCount: number | null;
  /** Upper bound on shots per scene, or null for the storyboard artist's call. */
  shotBudget: number | null;
  aspectRatio: VimaxAspectRatio;
  /** Whether to draw the storyboard. False produces the written production only. */
  images: boolean;
  /** Which model draws the frames. */
  imageGenerator: VimaxImageGenerator;
  /** Free-form creative constraints, ViMax's `user_requirement`. */
  userRequirement: string;
}

/**
 * The brief carried by a `/agents:vimax …` message, or null when the message is
 * not addressed to this agent. An empty string means the command was typed on
 * its own — the palette inserts the token first and the person is still
 * writing, so the caller waits instead of launching an empty run.
 */
export function briefFromVimaxCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:vimax(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function vimaxUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${VIMAX_COMMAND} ${trimmed}` : VIMAX_COMMAND;
}

function clampInteger(value: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Split a prompt into the brief and its production shape. Options stay inline
 * flags so chat remains the only surface:
 *   `--script`                  the brief already is a screenplay (script2video)
 *   `--idea`                    the brief is an idea to write from (idea2video)
 *   `--scenes 3`                ask the screenwriter for that many scenes
 *   `--shots 6`                 cap the shots the storyboard artist plans per scene
 *   `--style "watercolour"`     the visual style every frame is drawn in
 *   `--landscape|--vertical|--square`  change the frame
 *   `--images|--no-images`      draw the storyboard, or plan the film in writing
 *   `--gemini|--chatgpt|--auto` which model draws the frames
 *   `--for "…"`                 extra creative requirements, verbatim
 * Anything unrecognized stays part of the brief.
 *
 * `defaults` is the user's saved settings — where the production starts before
 * a flag is read. Every default has a flag that undoes it for one message,
 * including the ones that used to have no opposite (`--idea`, `--landscape`,
 * `--images`), because a preference you cannot override in a message is a trap.
 */
export function parseVimaxRequest(
  task: string,
  defaults?: Partial<Omit<VimaxRequest, "brief" | "userRequirement">>,
): VimaxRequest {
  let mode: VimaxMode = defaults?.mode ?? "idea2video";
  let style: string | null = defaults?.style ?? null;
  let sceneCount: number | null = defaults?.sceneCount ?? null;
  let shotBudget: number | null = defaults?.shotBudget ?? null;
  let aspectRatio: VimaxAspectRatio = defaults?.aspectRatio ?? "16:9";
  let images = defaults?.images ?? true;
  let imageGenerator: VimaxImageGenerator = defaults?.imageGenerator ?? "auto";
  const requirements: string[] = [];

  const quoted = String.raw`"[^"]*"|[^\s]+`;

  const brief = task
    .replace(/(?:^|\s)--no-images\b/gi, () => {
      images = false;
      return " ";
    })
    .replace(/(?:^|\s)--images\b/gi, () => {
      images = true;
      return " ";
    })
    .replace(/(?:^|\s)--(?:gemini|nanobanana)\b/gi, () => {
      imageGenerator = "gemini";
      return " ";
    })
    .replace(/(?:^|\s)--(?:chatgpt|openai)\b/gi, () => {
      imageGenerator = "chatgpt";
      return " ";
    })
    .replace(/(?:^|\s)--auto\b/gi, () => {
      imageGenerator = "auto";
      return " ";
    })
    .replace(
      /(?:^|\s)--generator[= ](gemini|chatgpt|openai|auto)\b/gi,
      (_match, value: string) => {
        const chosen = value.toLowerCase();
        imageGenerator = chosen === "openai" ? "chatgpt" : (chosen as VimaxImageGenerator);
        return " ";
      },
    )
    .replace(/(?:^|\s)--(?:vertical|portrait)\b/gi, () => {
      aspectRatio = "9:16";
      return " ";
    })
    .replace(/(?:^|\s)--square\b/gi, () => {
      aspectRatio = "1:1";
      return " ";
    })
    .replace(/(?:^|\s)--(?:landscape|wide)\b/gi, () => {
      aspectRatio = "16:9";
      return " ";
    })
    .replace(/(?:^|\s)--(?:script|screenplay)\b/gi, () => {
      mode = "script2video";
      return " ";
    })
    .replace(/(?:^|\s)--(?:idea|story)\b/gi, () => {
      mode = "idea2video";
      return " ";
    })
    .replace(/(?:^|\s)--scenes[= ](\d+)/gi, (_match, value: string) => {
      sceneCount = clampInteger(value, 1, 12);
      return " ";
    })
    .replace(/(?:^|\s)--shots[= ](\d+)/gi, (_match, value: string) => {
      shotBudget = clampInteger(value, 1, 12);
      return " ";
    })
    .replace(new RegExp(String.raw`(?:^|\s)--style[= ](${quoted})`, "gi"), (_m, value: string) => {
      style = value.replace(/^"|"$/g, "").trim() || null;
      return " ";
    })
    .replace(new RegExp(String.raw`(?:^|\s)--for[= ](${quoted})`, "gi"), (_m, value: string) => {
      const requirement = value.replace(/^"|"$/g, "").trim();
      if (requirement) requirements.push(requirement);
      return " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

  if (sceneCount !== null) requirements.push(`Use exactly ${sceneCount} scenes.`);
  if (shotBudget !== null) {
    requirements.push(`Plan no more than ${shotBudget} shots per scene.`);
  }

  return {
    brief,
    mode,
    style,
    sceneCount,
    shotBudget,
    aspectRatio,
    images,
    imageGenerator,
    userRequirement: requirements.join(" "),
  };
}
