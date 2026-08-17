// When a turn asking for a drawing should select the Diagram Design skill on
// its own.
//
// "Draw me an architecture diagram of this" names no skill, and without one the
// model answers with a Mermaid block or an ASCII box sketch — the two outputs
// the skill exists to replace. Nobody types `/diagram-design` for the same
// reason nobody types `/watch` at a video: the sentence already says what it
// wants.
//
// The rule is text-only, unlike Watch or Image to 3D. There is no attachment
// that means "diagram" — a screenshot is usually the *subject* of one, not a
// request for one — so the wording has to carry it: a making verb next to a
// diagram noun, a diagram noun leading its own sentence, or a source file that
// is already a diagram.
//
// Runs after the interactive visualizer in both chains, which matters: an
// interactive or animated model belongs to that runtime, and once it has
// claimed the turn the text starts with a slash and nothing here fires.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const DIAGRAM_DESIGN_SKILL = "diagram-design";

/**
 * The 27 things this skill draws, in the words people actually use for them.
 * Bare "chart" and "graph" are here because "make me a chart of the quarterly
 * numbers" is a bar chart request; they are only ever read next to a making
 * verb, never on their own.
 */
const DIAGRAM_NOUN =
  "(?:diagram|flow[\\s-]?chart|org(?:ani[sz]ation(?:al)?)?[\\s-]?chart|swim[\\s-]?lane(?:s)?|lifecycle|architecture|topology|wireframe|schematic|sequence|state[\\s-]machine|entity[\\s-]relationship|er[\\s-]diagram|data[\\s-]model|timeline|roadmap|gantt|quadrant|2\\s?x\\s?2|venn|pyramid|funnel|radar[\\s-]chart|spider[\\s-]chart|bar[\\s-]chart|line[\\s-]chart|scatter[\\s-]?plot|tree|hierarchy|mind[\\s-]?map|layer[\\s-]stack|process[\\s-]map|value[\\s-]stream|chart|graph)";

/**
 * Asking for one to be made. Four shapes, because the same request is written
 * all four ways and missing one costs the whole turn:
 *
 *   "make me a swimlane of onboarding"    verb … noun
 *   "flowchart for the refund path"       noun-first
 *   "diagram the auth handshake"          the noun used as a verb
 *   "redraw this .drawio at slide size"   an existing diagram source
 */
const MAKE_VERB =
  "(?:make|draw|create|generate|build|produce|render|design|sketch|redraw|redo|mock\\s+up|put\\s+together|whip\\s+up|give\\s+me|show\\s+me|i\\s+(?:want|need)|(?:can|could)\\s+you\\s+(?:make|draw|create|generate|build|sketch|show|give|produce|design))";

const VERB_NOUN = new RegExp(
  `\\b${MAKE_VERB}\\b[^.!?]{0,60}\\b${DIAGRAM_NOUN}\\b`,
  "i",
);

const NOUN_LED = new RegExp(
  `\\b${DIAGRAM_NOUN}\\b[^.!?]{0,40}\\b(?:of|for|showing|that\\s+shows|describing|covering)\\b`,
  "i",
);

/** "diagram the flow", "map out our process", "sketch out how a request lands". */
const NOUN_AS_VERB =
  /\b(?:diagram|sketch(?:\s+out)?|map\s+out|draw\s+(?:up|out)|chart|lay\s+out|visuali[sz]e)\s+(?:the|this|that|these|those|our|my|a|an|it|how|what|where|who)\b/i;

/** A source that is already a diagram: redraw it, whatever the sentence says. */
const DIAGRAM_SOURCE =
  /\.(?:drawio|drawio\.png|drawio\.svg|mmd|mermaid)\b|\bmermaid\b|\bdraw\.?io\b|```\s*mermaid/i;

/**
 * Talking *about* diagrams rather than asking for one, plus the two neighbours
 * that would otherwise be stolen: a request for diagram *markup* (the person
 * wants text they can paste into their own renderer, and upstream's whole
 * position is that a redrawn diagram is not a rendered Mermaid one), and a
 * request for a picture, which belongs to image generation.
 */
const DISCUSSION_ONLY =
  /\b(?:what\s+(?:is|are)\b|what'?s\s+the\s+difference|which\s+(?:tool|app|library|software)|how\s+do\s+i\s+(?:make|draw|create)\b|tell\s+me\s+about\b|explain\s+(?:what|how)\s+[^.!?]{0,40}\b(?:diagram|chart)s?\b|pros?\s+and\s+cons?)/i;

const MARKUP_REQUEST =
  /\b(?:mermaid|graphviz|plantuml|dot|d2|excalidraw)\s+(?:code|source|syntax|markup|snippet|block|file)\b|\bwrite\s+(?:me\s+)?(?:the\s+)?(?:mermaid|graphviz|plantuml|dot)\b|\bas\s+mermaid\b|\bin\s+mermaid\s+(?:syntax|format)\b/i;

/**
 * A question that never asks for anything to be made. "What's on the roadmap
 * for next quarter?" reads as noun-then-"for" and would otherwise be drawn as a
 * timeline; an interrogative opening with no making verb anywhere in it is a
 * question about the subject, not a request for a picture of it.
 */
const QUESTION_WITHOUT_REQUEST = new RegExp(
  `^\\s*(?:what|what'?s|when|where|who|whom|why|how)\\b(?![\\s\\S]*\\b${MAKE_VERB}\\b)`,
  "i",
);

const PICTURE_REQUEST =
  /\b(?:photo(?:realistic)?|picture|illustration|logo|icon|wallpaper|poster|artwork|painting|portrait|comic|sticker)\b/i;

/**
 * Motion and manipulation belong to the interactive visualizer, which runs
 * ahead of this in both chains. This is the second guard, for the case where it
 * declined and the request is still not a static drawing.
 */
const INTERACTIVE_REQUEST =
  /\b(?:interactive|simulat(?:e|ion)|clickable|draggable|slider|zoomable|playable|three\.?js|webgl|3-?d\s+(?:model|scene|object))\b/i;

/** A link is not prose; it is stripped before any test so a URL cannot match one. */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

/**
 * A short follow-up to a diagram that was just drawn. Skill guidance is injected
 * per turn, so "make the boxes wider" arrives with none of the connector rules
 * that produced the first one unless the skill is selected again.
 */
const REVISION_REQUEST =
  /^(?:(?:can|could|would|will|please)\s+you\s+|please\s+|now\s+)?(?:(?:make|move|swap|change|add|remove|drop|widen|shrink|resize|recolo(?:u)?r|tweak|adjust|fix|redo|redraw|split|merge|flip|rotate|relabel|rename|simplify|clean\s+up|try)\b[^.!?]{0,80}|(?:try|do)\s+(?:it|that)\s+again)[?.!]*$/i;

const DIAGRAM_CONTEXT =
  /(?:\/diagram-design\b|diagram-design|\b(?:diagram|flowchart|swimlane|org chart|quadrant|venn|gantt)\b)/i;

function drewADiagramRecently(
  priorMessages: ReadonlyArray<{ role: string; content: string }> | undefined,
): boolean {
  return (priorMessages ?? [])
    .slice(-8)
    .some(
      (message) =>
        message.role === "assistant" && DIAGRAM_CONTEXT.test(message.content),
    );
}

export interface DiagramIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectDiagramDesign(input: DiagramIntentInput): boolean {
  const text = input.text.trim();
  // Both conversational surfaces, and neither of the unauthenticated ones:
  // the diagram is filed as an artifact on the conversation. An explicit
  // command already says what the turn is, so never argue with one.
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/")) return false;
  const prose = text.replace(ANY_URL, " ");
  if (
    DISCUSSION_ONLY.test(prose) ||
    MARKUP_REQUEST.test(prose) ||
    INTERACTIVE_REQUEST.test(prose) ||
    QUESTION_WITHOUT_REQUEST.test(prose)
  ) {
    return false;
  }
  const asks =
    VERB_NOUN.test(prose) ||
    NOUN_LED.test(prose) ||
    NOUN_AS_VERB.test(prose) ||
    DIAGRAM_SOURCE.test(prose);
  // "draw me a picture of the office" is image generation. A diagram source in
  // hand outranks that, because "redraw this .drawio as an illustration" is
  // still this skill's job.
  if (asks && PICTURE_REQUEST.test(prose) && !DIAGRAM_SOURCE.test(prose)) {
    return false;
  }
  if (asks) return true;
  return (
    REVISION_REQUEST.test(prose) && drewADiagramRecently(input.priorMessages)
  );
}

/**
 * Whether the skill is actually installed is not decided here. The caller
 * resolves the selection and falls back to the plain text when it turns out to
 * be unavailable — the same answer this module would give, and one fewer place
 * that has to know what the skill needs to run.
 */
export function diagramCommandText(
  input: DiagramIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectDiagramDesign(input);
  return {
    text: automatic ? `/${DIAGRAM_DESIGN_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
