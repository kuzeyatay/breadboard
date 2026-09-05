// Select the reviewed ASCII diagram workflow before the rendered Diagram
// Design workflow gets a chance to claim the turn. The qualifier is
// intentional: "draw an architecture diagram" should still produce the normal
// rendered artifact, while "draw it as plain text" must remain readable in a
// terminal and use the stricter PLAN/DRAW/VERIFY procedure.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const ASCII_ART_DIAGRAMS_SKILL = "ascii-art-diagrams";

const MAKE_VERB =
  "(?:make|draw|create|generate|build|produce|render|design|sketch|redraw|redo|map|show|visuali[sz]e|lay\\s+out|give\\s+me|show\\s+me|i\\s+(?:want|need)|(?:can|could|would|will)\\s+you\\s+(?:make|draw|create|generate|build|produce|render|design|sketch|show|give|visuali[sz]e))";

const DIAGRAM_NOUN =
  "(?:diagram|visuali[sz]ation|flow[\\s-]?chart|architecture|topology|sequence|state[\\s-]?machine|tree|hierarchy|map|chart|graph|layout|boxes?|box[\\s-]and[\\s-]arrows?)";

const ASCII_STYLE =
  "(?:ascii(?:[\\s-]+art)?|plain[\\s-]?text|text[\\s-]?only|terminal[\\s-]?style|monospace(?:d)?)";

const QUALIFIED_NOUN_LED = new RegExp(
  `\\b${ASCII_STYLE}\\b[^.!?]{0,35}\\b${DIAGRAM_NOUN}\\b[^.!?]{0,35}\\b(?:of|for|showing|that\\s+shows|please)\\b`,
  "i",
);

const VISUAL_VERB_WITH_STYLE = new RegExp(
  `\\b(?:draw|diagram|sketch|redraw|map\\s+out|visuali[sz]e|lay\\s+out)\\b[^.!?]{0,80}\\b${ASCII_STYLE}\\b`,
  "i",
);

const MAKE_NOUN_WITH_STYLE = new RegExp(
  `\\b${MAKE_VERB}\\b[^.!?]{0,60}\\b${DIAGRAM_NOUN}\\b[^.!?]{0,40}\\b(?:as|in|using|with)\\s+(?:an?\\s+)?${ASCII_STYLE}\\b`,
  "i",
);

const VERB_WITH_TEXT_DIAGRAM = new RegExp(
  `\\b${MAKE_VERB}\\b[^.!?]{0,60}\\b(?:text[\\s-]+diagram|text[\\s-]+flowchart|box[\\s-]and[\\s-]arrow)\\b`,
  "i",
);

const TEXT_DIAGRAM_NOUN_LED =
  /\b(?:text[\s-]+diagram|text[\s-]+flowchart|box[\s-]and[\s-]arrow(?:\s+layout)?)\b[^.!?]{0,40}\b(?:of|for|showing|that\s+shows|please)\b/i;

/** "No Mermaid; ASCII please" and similarly terse but explicit requests. */
const TERSE_ASCII_REQUEST =
  /(?:^|[;,.!]\s*)\b(?:ascii|plain[\s-]?text|text[\s-]?only|terminal[\s-]?style|monospace)\s+(?:please|instead)\b|\b(?:please|instead)\s+(?:use\s+)?(?:ascii|plain[\s-]?text|text[\s-]?only)\b/i;

/** Asking for visible ASCII punctuation as the drawing medium. */
const CHARACTER_DRAWING_REQUEST =
  /\b(?:draw|diagram|visuali[sz]e|show|map)\b[^.!?]{0,70}(?:\+[-+]{2,}|\|[^\n]{0,20}\||plus(?:es)?[,\s]+pipes?[,\s]+and[,\s]+dashes?)/i;

const NEGATED_ASCII = new RegExp(
  `\\b(?:not|no|without|avoid|instead\\s+of)\\s+(?:an?\\s+)?${ASCII_STYLE}\\b`,
  "i",
);

const DISCUSSION_ONLY =
  /\b(?:what\s+(?:is|are)|what'?s|tell\s+me\s+about|explain\s+(?:what|why|how)|pros?\s+and\s+cons?|history\s+of)\b/i;

const QUESTION_WITHOUT_REQUEST = new RegExp(
  `^\\s*(?:what|what'?s|when|where|who|whom|why|how)\\b(?![\\s\\S]*\\b${MAKE_VERB}\\b)`,
  "i",
);

/** Requests for another output format should keep their own capability. */
const OTHER_FORMAT =
  /\b(?:convert|turn|export|translate)\b[^.!?]{0,70}\b(?:ascii|plain[\s-]?text|text[\s-]?only)\b[^.!?]{0,35}\b(?:to|into|as)\s+(?:mermaid|svg|html|image|png|jpeg|graphviz|plantuml)\b/i;

const INTERACTIVE_REQUEST =
  /\b(?:interactive|animated|simulat(?:e|ion)|clickable|draggable|slider|zoomable|playable|three\.?js|webgl|3-?d\s+(?:model|scene|object))\b/i;

const ANY_URL = /\bhttps?:\/\/\S+/gi;

const REVISION_REQUEST =
  /^(?:(?:can|could|would|will|please)\s+you\s+|please\s+|now\s+)?(?:(?:make|move|swap|change|add|remove|drop|widen|shrink|resize|tweak|adjust|fix|redo|redraw|split|merge|flip|relabel|rename|simplify|clean\s+up|align|straighten|try)\b[^.!?]{0,100}|(?:try|do)\s+(?:it|that)\s+again)[?.!]*$/i;

const ASCII_DIAGRAM_CONTEXT =
  /(?:\/ascii-art-diagrams\b|ascii-art-diagrams|```(?:text|txt)?\s*\n(?=[\s\S]{0,500}(?:\+[-+]{2,}\+|\|[^\n]+\||[-=]{3,}>)))/i;

function drewAsciiRecently(
  priorMessages: ReadonlyArray<{ role: string; content: string }> | undefined,
): boolean {
  return (priorMessages ?? [])
    .slice(-8)
    .some(
      (message) =>
        message.role === "assistant" &&
        ASCII_DIAGRAM_CONTEXT.test(message.content),
    );
}

export interface AsciiDiagramIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectAsciiDiagram(
  input: AsciiDiagramIntentInput,
): boolean {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/")) return false;

  const prose = text.replace(ANY_URL, " ");
  if (
    NEGATED_ASCII.test(prose) ||
    OTHER_FORMAT.test(prose) ||
    INTERACTIVE_REQUEST.test(prose) ||
    DISCUSSION_ONLY.test(prose) ||
    QUESTION_WITHOUT_REQUEST.test(prose)
  ) {
    return false;
  }

  if (
    QUALIFIED_NOUN_LED.test(prose) ||
    VISUAL_VERB_WITH_STYLE.test(prose) ||
    MAKE_NOUN_WITH_STYLE.test(prose) ||
    VERB_WITH_TEXT_DIAGRAM.test(prose) ||
    TEXT_DIAGRAM_NOUN_LED.test(prose) ||
    TERSE_ASCII_REQUEST.test(prose) ||
    CHARACTER_DRAWING_REQUEST.test(prose)
  ) {
    return true;
  }

  return REVISION_REQUEST.test(prose) && drewAsciiRecently(input.priorMessages);
}

export function asciiDiagramCommandText(
  input: AsciiDiagramIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectAsciiDiagram(input);
  return {
    text: automatic ? `/${ASCII_ART_DIAGRAMS_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
