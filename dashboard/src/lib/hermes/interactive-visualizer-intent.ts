import type { HermesSurface } from "./config.ts";
import { interactiveVisualizerAvailable } from "./interactive-visualizer-config.ts";

const EXPLICIT_VISUALIZER =
  /\b(?:interactive\s+(?:visuali[sz](?:ation|er)|diagram|model|simulation)|visuali[sz]e|simulation|simulate|2d\s+(?:model|diagram)|3d\s+(?:model|diagram)|three(?:\.js)?\s+(?:model|scene))\b/i;
const MANIPULATION =
  /\b(?:rotate|zoom|scrub|play|pause|reset|step through|slider|control|change|adjust|compare|explore|animate|animation|orbit|drag)\b/i;
const DYNAMIC_EXPLANATION =
  /\b(?:show|demonstrate|explain|model|diagram)\b[\s\S]{0,100}\b(?:how|motion|changes?|works?|behaves?|over time|relationship|structure)\b/i;
const SOURCE_CODE_REQUEST =
  /\b(?:source code|code sample|write (?:the )?(?:html|javascript|typescript|react)|react component|implementation code)\b/i;
const STATIC_IMAGE_REQUEST =
  /\b(?:generate|draw|make|create)\b[\s\S]{0,60}\b(?:photo|poster|wallpaper|static image|illustration)\b/i;
const BASIC_CALCULATION =
  /^\s*(?:calculate|compute|what is|solve)\b[\s\S]{0,180}(?:\d|equation|percent|sum|product)\s*[?.]?\s*$/i;
const RETRY_REQUEST =
  /^(?:(?:can|could|would|will)\s+you\s+|please\s+)?(?:(?:try|retry|run|generate|build)(?:\s+it|\s+that|\s+this)?\s+(?:again|once more)|retry(?:\s+it|\s+that|\s+this)?)[?.!]*$/i;
const VISUALIZER_CONTEXT =
  /(?:\/interactive-visualizer\b|interactive[-\s]visuali[sz]er|visuali[sz]er|renderer rejected|diagram .*schema|working artifact was produced)/i;

function isVisualizerRetry(input: {
  text: string;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  if (!RETRY_REQUEST.test(input.text.trim())) return false;
  return (input.priorMessages ?? [])
    .slice(-8)
    .some((message) =>
      message.role === "assistant" && VISUALIZER_CONTEXT.test(message.content),
    );
}

export function shouldAutoSelectInteractiveVisualizer(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!interactiveVisualizerAvailable(
    input.surface,
    input.authenticated,
    input.env,
  )) return false;
  const text = input.text.trim();
  if (!text || text.startsWith("/")) return false;
  if (SOURCE_CODE_REQUEST.test(text) || BASIC_CALCULATION.test(text)) return false;
  if (STATIC_IMAGE_REQUEST.test(text) && !MANIPULATION.test(text)) return false;
  return EXPLICIT_VISUALIZER.test(text) ||
    (MANIPULATION.test(text) && DYNAMIC_EXPLANATION.test(text));
}

export function visualizerCommandText(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
  env?: NodeJS.ProcessEnv;
}): { text: string; automatic: boolean } {
  const automatic =
    shouldAutoSelectInteractiveVisualizer(input) ||
    (
      interactiveVisualizerAvailable(
        input.surface,
        input.authenticated,
        input.env,
      ) &&
      isVisualizerRetry(input)
    );
  return {
    text: automatic ? `/interactive-visualizer ${input.text}` : input.text,
    automatic,
  };
}
