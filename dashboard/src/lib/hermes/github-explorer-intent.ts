// When a turn naming a GitHub repository should select the GitHub Explorer
// skill on its own.
//
// "Look into github.com/org/repo" or "is this project any good?" names no
// skill, and without one the model answers from the README alone — the one
// source the skill exists to see past. Nobody types `/github-explorer` for the
// same reason nobody types `/watch` at a video: the sentence already says what
// it wants.
//
// The rule is text-only. A repo is named either by URL or by the word "repo"
// next to an investigating verb; there is no attachment that means
// "repository". The hard part is the other direction: most sentences that
// contain a GitHub URL are work orders — clone it, fix it, integrate it — and
// a work order must never be answered with a research dossier.
//
// Runs after Diagram Design in both chains, so "diagram the architecture of
// <repo>" stays a drawing, and before messaging, which is an errand.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const GITHUB_EXPLORER_SKILL = "github-explorer";

/**
 * A GitHub URL that identifies a repository. The owner segment excludes
 * GitHub's own top-level pages, so a link to the trending page or a gist is
 * never read as a repo.
 */
const REPO_URL = new RegExp(
  "\\bhttps?://(?:www\\.)?github\\.com/" +
    "(?!(?:orgs|features|topics|search|marketplace|sponsors|settings|about|" +
    "pricing|apps|collections|trending|explore|login|signup|gist)\\b)" +
    "([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\\.git)?([/#?]\\S*)?(?=[\\s)\\]>,;!?]|$)",
  "i",
);

/**
 * A URL that goes past the repo to one object inside it. "Explain this file"
 * or "summarize this PR" is a question about that object, not a request for a
 * repository dossier — unless the words around it ask for one anyway.
 */
const DEEP_OBJECT_PATH =
  /^\/(?:blob|blame|raw|pull|compare|commit|commits\/[0-9a-f]|issues\/\d|discussions\/\d|releases\/tag|actions|wiki\/.)/i;

/**
 * Asking for a repo to be understood. Verbs and the question shapes people
 * actually write; "review" is here because "review this repo" is an
 * evaluation, while "review my PR" is caught by the deep-object rule.
 */
const INVESTIGATE =
  /\b(?:look\s+(?:into|at)|check\s+out|analy[sz]e|investigate|inspect|evaluate|assess|research|explore|dig\s+into|deep[\s-]?dive(?:\s+(?:into|on))?|vet|audit|size\s+up|scope\s+out|review|tell\s+me\s+about|what\s+do\s+you\s+(?:think|make)\s+(?:of|about)|what(?:'|’)?s\s+your\s+(?:take|opinion)\s+on|is\s+(?:this|it|that)\s+(?:any\s+good|good|worth|legit|safe|trustworthy|actively\s+maintained|still\s+maintained|abandoned)|worth\s+(?:using|trying|adopting|a\s+look)|should\s+(?:i|we)\s+(?:use|adopt|trust|depend\s+on|build\s+on)|how\s+(?:good|mature|active|healthy|popular|well[\s-]maintained)\s+is|who\s+(?:maintains|is\s+behind)|compare\s+(?:it|this)\s+(?:to|with|against)|alternatives\s+to|thoughts\s+on)\b/i;

/**
 * A work order. Someone who says "clone and build this repo" wants hands, not
 * a report, and answering with a dossier costs them the turn. An explicit
 * research verb overrides this — "audit this repo before we integrate it" is
 * the skill's job even though "integrate" appears.
 */
const WORK_ORDER =
  /\b(?:clone|fork|install|npm\s+i(?:nstall)?|pip\s+install|build|compile|run|execute|deploy|fix|debug|patch|refactor|implement|port|migrate|integrate|embed|vendor|import\s+it|set\s+(?:it\s+)?up|add\s+(?:it|this|that)\s+to|pull\s+(?:it|this)\s+(?:in|down)|open\s+a\s+(?:pr|pull\s+request|issue)|submit|merge|push|wire\s+(?:it|this)\s+(?:in|up))\b/i;

const RESEARCH_OVERRIDE =
  /\b(?:analy[sz]e|investigate|inspect|evaluate|assess|audit|vet|deep[\s-]?dive|due\s+diligence|is\s+it\s+(?:safe|legit|trustworthy|any\s+good)|before\s+(?:i|we)\s+(?:use|adopt|integrate|depend))\b/i;

/**
 * Questions about GitHub the product, not about a repository on it. "How do I
 * create a github repo" would otherwise read as verb + repo noun.
 */
const PRODUCT_HOWTO =
  /\bhow\s+(?:do\s+i|to|can\s+i)\s+(?:create|make|set\s*up|delete|rename|configure|use)\b[^.!?]{0,40}\b(?:github|repo(?:sitory)?)\b/i;

/**
 * A repo named in words rather than by URL: an investigating verb in the same
 * message as a repository noun tied to GitHub. Bare "check out this project"
 * stays free — "project" alone is any kind of work — but "check out this
 * github project" and "investigate the langchain repo" are this skill's
 * sentences.
 */
const NAMED_REPO =
  /\b(?:github\s+(?:repo(?:sitory)?|project|library|package|org)|(?:repo(?:sitory)?|project|library|framework|package|sdk|codebase)\s+(?:on|from|at)\s+github|the\s+\S{1,40}\s+repo(?:sitory)?\b|this\s+repo(?:sitory)?\b|that\s+repo(?:sitory)?\b)/i;

/**
 * A short follow-up to a dossier that was just produced. Skill guidance is
 * injected per turn, so "what about its issues?" arrives without the sourcing
 * rules that shaped the first report unless the skill is selected again.
 */
const FOLLOW_UP =
  /^(?:(?:and|but|also|ok(?:ay)?,?\s*)?\s*(?:what\s+about|how\s+about|any(?:thing)?\s+(?:on|about)|tell\s+me\s+more\s+about|dig\s+(?:deeper|further)|go\s+deeper|more\s+on)\b[^.!?]{0,80}|how\s+(?:active|healthy|mature|popular)\s+is\s+(?:it|the\s+repo|the\s+project)[^.!?]{0,40}|who\s+(?:maintains|contributes\s+to)\s+it[^.!?]{0,30}|(?:any|what)\s+(?:alternatives|competitors|red\s+flags|known\s+issues)[^.!?]{0,50})[?.!]*$/i;

const EXPLORER_CONTEXT =
  /(?:\/github-explorer\b|github-explorer|Project health|One-line positioning)/i;

function exploredARepoRecently(
  priorMessages: ReadonlyArray<{ role: string; content: string }> | undefined,
): boolean {
  return (priorMessages ?? [])
    .slice(-8)
    .some(
      (message) =>
        message.role === "assistant" && EXPLORER_CONTEXT.test(message.content),
    );
}

export interface GithubExplorerIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectGithubExplorer(
  input: GithubExplorerIntentInput,
): boolean {
  const text = input.text.trim();
  // Both conversational surfaces, neither unauthenticated one: the dossier
  // cites live web sources, which only these turns can fetch. An explicit
  // command already says what the turn is, so never argue with one.
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  if (!available || !text || text.startsWith("/")) return false;
  if (PRODUCT_HOWTO.test(text)) return false;
  if (WORK_ORDER.test(text) && !RESEARCH_OVERRIDE.test(text)) return false;

  const url = REPO_URL.exec(text);
  if (url) {
    const trailing = url[3] ?? "";
    const asksAnyway = INVESTIGATE.test(text);
    // A link into one file, PR or issue is a question about that object; the
    // repo dossier only claims it when the words ask for the repo itself.
    if (DEEP_OBJECT_PATH.test(trailing) && !asksAnyway) return false;
    if (asksAnyway) return true;
    // A repo link sent bare, or with only a nudge ("thoughts?", "this one?"),
    // is the request in its shortest form. All links come off before measuring
    // so a second repo in the same message still reads as a bare send.
    const remainder = text.replace(/\bhttps?:\/\/\S+/gi, " ").trim();
    return remainder.length <= 60;
  }

  if (INVESTIGATE.test(text) && NAMED_REPO.test(text)) return true;
  return (
    FOLLOW_UP.test(text) && exploredARepoRecently(input.priorMessages)
  );
}

/**
 * Whether the skill is actually installed is not decided here. The caller
 * resolves the selection and falls back to the plain text when it turns out to
 * be unavailable — the same answer this module would give, and one fewer place
 * that has to know what the skill needs to run.
 */
export function githubExplorerCommandText(
  input: GithubExplorerIntentInput,
): { text: string; automatic: boolean } {
  const automatic = shouldAutoSelectGithubExplorer(input);
  return {
    text: automatic ? `/${GITHUB_EXPLORER_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
