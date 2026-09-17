// Outcome-based task planning for the Hermes runtime.
//
// This module replaces the legacy `decideCapabilityMode` classifier, which
// asked a single question ("does this look like a code change?") and answered
// it from surface identity plus a flat OR of verb/artifact regexes. That model
// could not express the capabilities Breadboard actually needs (filesystem,
// media, documents, web, MCP, skills, subagents, memory), and it gated
// capability on the *surface* rather than on the *requested outcome*.
//
// The rule this module enforces:
//
//   Capabilities are derived from the end state the user asked for.
//
// Deliberately NOT inputs to the decision:
//   - which surface sent the request
//   - whether the workspace happens to be a git repository
//   - whether a referenced file has a programming-language extension
//   - whether the user is asking to *read* code
//   - whether a shell command may be useful internally
//
// Coding is a capability of last resort: it is required only when the
// requested end state is new or modified software. Reading, searching,
// moving, copying, renaming, or deleting a `.ts` file are filesystem
// outcomes, not development outcomes. Running an already-existing command is
// a command-execution outcome, not a development outcome.
//
// The planner is deterministic and server-owned. Model prose, slash selectors,
// and client-supplied hints are never inputs to authority; ambiguity always
// resolves toward the least-privileged capability set.

// The one predicate shared with turn selection: what counts as a video link
// must be the same question here (does this URL oblige web evidence?) and in
// watch-intent (does this URL select Watch?), or a link could select the Watch
// pipeline while still being judged as an unopened web source.
import { hasVideoUrl } from "./watch-intent.ts";
import { actionMatches, requestedActions, requestProse, requestKeywords, type RequestedAction } from "./request-language.ts";

export type TaskCapability =
  | "conversation"
  | "garden_read"
  | "garden_write"
  | "web_research"
  | "filesystem_read"
  | "filesystem_write"
  | "destructive_filesystem"
  | "document_processing"
  | "media_processing"
  | "command_execution"
  | "application_action"
  | "mcp"
  | "skill"
  | "subagent"
  | "memory"
  | "coding"
  | "destructive_system_action";

export type RiskLevel = "low" | "medium" | "high";

export interface PlannedStep {
  index: number;
  description: string;
  capabilities: TaskCapability[];
  requiresConfirmation: boolean;
}

export interface ResourceReference {
  kind: "path" | "url" | "garden" | "page" | "format";
  value: string;
  /** True when a path reference is absolute (and therefore needs a grant). */
  absolute?: boolean;
  /** Server-resolved resource shape used to scope a file to its parent grant. */
  resourceType?: "file" | "directory";
}

export interface TaskPlan {
  userGoal: string;
  intendedOutcome: string;
  steps: PlannedStep[];
  requiredCapabilities: TaskCapability[];
  requiredResources: ResourceReference[];
  requiresCoding: boolean;
  /**
   * True when the request itself asked for something only a live source can
   * settle, so the answer owes external evidence.
   *
   * Deliberately its own field rather than `requiredCapabilities.includes(
   * "web_research")`. That list is *reach* — what this turn is permitted to
   * touch — and `elevateForSuperAgent` widens it to the whole inventory no
   * matter what was asked. Reading the obligation off reach made every
   * super-agent turn, "hi" included, owe a web result, and the enforcement at
   * the end of the stream then discarded the answer when none arrived.
   */
  requiresWebEvidence: boolean;
  requiresConfirmation: boolean;
  confirmationReason?: string;
  riskLevel: RiskLevel;
  /** Why the planner selected this capability set, for diagnostics and UI. */
  rationale: string;
  planSource: "breadboard_task_planner_v1";
}

export interface TaskPlanInput {
  /** The raw user request for this turn. */
  request: string;
  /** Prior user requests in the same task, oldest first, for continuation. */
  priorRequests?: string[];
  /**
   * Narrow resources resolved server-side from verified conversation evidence.
   * These affect resource scoping only; they never add an intent/capability.
   */
  resolvedResources?: ResourceReference[];
  /** Whether an authenticated user owns this turn. */
  authenticated: boolean;
  /** Whether the surface may reach private user resources at all. */
  isolated?: boolean;
}

/* ------------------------------------------------------------------ */
/* Lexicon                                                             */
/* ------------------------------------------------------------------ */

// Verbs that describe *authoring or altering software behaviour*. These are
// the only verbs that can imply `coding`, and only when paired with a code
// artifact (see CODE_ARTIFACT).
const CODE_AUTHORING_VERB =
  /\b(implement|refactor|debug|patch|instrument|scaffold|wire\s+up|wire|integrate|migrate|port|rewrite|reimplement|fix|repair|resolve|correct|harden|optimi[sz]e|parameteri[sz]e|deprecate|unit[- ]test)\b/i;

// Verbs that create something new. Whether this means coding depends entirely
// on the object: "create a folder" is filesystem, "create a parser" is coding.
const CREATION_VERB =
  /\b(add|build|create|develop|generate|introduce|make|produce|set\s+up|write)\b/i;

// Verbs that change an existing thing. Same object-dependence as above.
const MODIFICATION_VERB =
  /\b(change|edit|modify|update|adjust|revise|replace|extend|rename)\b/i;

// Artifacts that are software. Note: a *filename* with a code extension is
// deliberately not enough: the requested action must author the software.
const CODE_ARTIFACT =
  /\b(api|app|application|authentication|authori[sz]ation|backend|bug|class|cli|codebase|code|component|constructor|controller|dependency|endpoint|feature|frontend|function|handler|hook|interface|library|method|middleware|migration|module|package|parser|pipeline|plugin|program|regression|route|schema|script|server|service|software|test|tests|suite|type|typing|validator|variable|website|webhook)\b/i;
const WRITTEN_DELIVERABLE = /\b(plan|proposal|summary|report|explanation|guide|tutorial|outline|comparison|recommendations?|email|message|notes?|documentation|description|checklist|review)\b/i;
const SOFTWARE_OBJECT = /\b(api|app|authentication|authori[sz]ation|backend|bug|cli|codebase|code|config(?:uration)?|constructor|database|endpoint|frontend|handler|middleware|parser|plugin|regression|repository|schema|script|software|validator|variable|website|webhook)\b/i;
const SOFTWARE_QUALIFIER = /\b(python|typescript|javascript|java|rust|golang|react|vue|svelte|html|css|sql|npm|node|git|unit|integration|regression|failing|compiler|runtime|async|keyboard|navigation|ui|web|desktop|mobile)\b/i;

// Explicit file-system objects.
const FILE_OBJECT =
  /\b(file|files|folder|folders|directory|directories|subfolder|archive|attachment|attachments|photo|photos|picture|pictures|image|images|screenshot|screenshots|download|downloads|document|documents|desktop|onedrive)\b/i;

// Outcome families -------------------------------------------------------

const INSPECT_VERB =
  /\b(analy[sz]e|assess|audit|compare|describe|diagnose|examine|explain|identify|inspect|interpret|list|outline|read|review|show|summari[sz]e|tell\s+me|trace|understand|walk\s+me\s+through|what(?:'s|s|\s+is|\s+are)|why)\b/i;

const SEARCH_VERB =
  /\b(find|search|locate|look\s+for|look\s+up|grep|which\s+files?|where\s+(?:is|are))\b/i;

const FS_MUTATION_VERB =
  /\b(move|copy|duplicate|rename|organi[sz]e|sort|tidy|group|consolidate|flatten|archive|unzip|zip|extract|relocate|reorgani[sz]e|restructure|back\s+up|stage)\b/i;

const FS_CREATE_OBJECT = /\b(folder|directory|file|subfolder)\b/i;

const DESTRUCTIVE_FS_VERB =
  /\b(delete|remove|erase|purge|trash|wipe|discard|clear\s+out|get\s+rid\s+of)\b/i;

const RUN_VERB =
  /\b(run|execute|invoke|launch|start|kick\s+off|rerun|re-run)\b/i;

const CONVERT_VERB =
  /\b(convert|export|render|transform|turn\s+(?:it\s+)?into|save\s+as|output\s+as)\b/i;

const DOCUMENT_OBJECT =
  /\b(pdfs?|docx?|word|spreadsheets?|xlsx?|excel|csv|markdown|md|slides?|powerpoint|pptx?|ebook|epub|report|invoice|contract)\b/i;

const MEDIA_OBJECT =
  /\b(video|videos|audio|recording|recordings|podcast|lecture|mp3|mp4|wav|m4a|mkv|mov|webm|youtube|transcript|subtitles?|captions?)\b/i;

const MEDIA_VERB =
  /\b(transcribe|transcription|caption|subtitle|diari[sz]e|extract\s+audio|re-?encode|trim|clip)\b/i;

// A media noun says what the conversation is about, not necessarily that raw
// media bytes must be processed. Garden questions commonly refer to already
// indexed "recordings", "lectures", or the "Video & audio" section while
// asking for a chronology/table from retained metadata and transcripts.
const MEDIA_ANALYSIS_VERB =
  /\b(analy[sz]e|describe|inspect|listen\s+to|review|summari[sz]e|watch|what\s+(?:happens?|is\s+said|was\s+said))\b/i;

const WEB_VERB =
  /\b(browse|google|research)\b/i;

// "Read those papers", "open the studies behind it": a published source the
// user names but has not supplied is only reachable by opening it. Without
// this clause the follow-up carried no web signal at all, so nothing in the
// directive asked the model to fetch anything and a model that answered "I
// cannot access papers" with its web tools sitting unused drew no shortfall
// notice. Attached material is the documents signal's business: an object
// that points at an upload, or a turn that names a local path, is excluded.
const PUBLISHED_SOURCE_VERB =
  /\b(read|open|review|analy[sz]e|examine|inspect|assess|audit|interpret|summari[sz]e|find|locate|look\s+up|fetch|grab)\b/i;
const PUBLISHED_SOURCE_OBJECT =
  /\b(papers?|studies|study|articles?|publications?|preprints?|literature|journals?|citations?|trials?|meta-?analys[ie]s|research)\b|\bsources?\b(?!\s+(?:code|files?|tree|maps?))/i;
const SUPPLIED_SOURCE_OBJECT =
  /\b(attached|attachments?|uploaded|uploads?|pasted|this\s+file|these\s+files|pdfs?|docx?)\b/i;
const LIVE_INFORMATION = /\b(?:latest|recent|up[- ]to[- ]date)\s+\w|\bcurrent\s+(?:time|date|weather|forecast|prices?|costs?|rates?|scores?|standings?|results?|availability|versions?|releases?|president|ceo|government)\b|\bnews\b/i;
const CONCEPTUAL_WEATHER = /\b(?:explain\s+(?:how|why|what)|how\s+(?:do|does)|what\s+(?:is|are)\s+(?:a|an)|difference\s+between)\b/i;

// Live conditions are inherently time-sensitive even when the user does not
// spell that out with words such as "current" or "latest". Treating a plain
// "what's the weather" prompt as conversation makes the model answer from its
// training data instead of activating the web tools needed to verify it.
const LIVE_WEATHER_QUERY =
  /\b(weather|forecast|temperature|temperatures|air\s+quality|wind\s+speed|precipitation)\b/i;

// Scheduled real-world events need live evidence when the request anchors them
// to a relative date. Without this signal, questions such as "is the eclipse
// viewable tomorrow?" were treated as timeless conversation and answered from
// model memory even though visibility and the user's local date are decisive.
const RELATIVE_DATE_QUERY =
  /\b(today|tomorrow|tonight|yesterday|this\s+(?:morning|afternoon|evening|week|weekend|month|year)|next\s+(?:week|weekend|month|year)|right\s+now|as\s+of)\b/i;
const SCHEDULED_REAL_WORLD_EVENT =
  /\b(eclipses?|meteor\s+showers?|auroras?|launch(?:es)?|flights?|trains?|ferries?|matches?|games?|concerts?|shows?|events?|elections?|deadlines?|openings?|closures?)\b/i;

// Recommendations about businesses, venues, activities, travel, products,
// and services are external-data questions even when the user never says
// "search the web". Availability, opening hours, quality, and the set of
// candidates all change. Keep this category-driven rather than naming any one
// venue, and fold common Turkish characters so the same policy applies to the
// language the user actually writes in.
const LIVE_RECOMMENDATION_STRONG =
  /\b(things? to do|something (?:fun|interesting|unusual) to do|places? to (?:visit|eat|stay|go)|where to (?:eat|stay|go|visit)|what to do (?:in|near|around)|near me|gezilecek yer(?:ler)?|yapilacak sey(?:ler)?|nereye gidilir|nereye gidelim|ne yapalim|nerede yenir|yakinda ne yapilir|(?:orada|orda|cevre(?:si)?nde) neler var)\b/i;
const LIVE_RECOMMENDATION_INTENT =
  /\b(recommend(?:ation)?s?|suggest(?:ion)?s?|(?:i am|i m|we are|we re) looking for|find (?:me|us)|help (?:me|us) (?:choose|pick|find)|(?:i|we) want(?! (?:to|you)\b)|best|top|good|great|popular|must[- ](?:see|visit|try)|worth (?:visiting|buying|trying)|interesting|unusual|nearby|near me|around here|where should|which|what should (?:i|we) (?:buy|try|visit|choose)|oner\w*|tavsiye|ariyorum|istiyorum|bul|hangi|sec|en iyi|iyi|populer|mutlaka|ilginc|degisik|guzel|yakinda|yakinlarda|cevre(?:si)?nde|nerede|nereye|ne yapilir|var mi)\b/i;
const LIVE_RECOMMENDATION_OBJECT =
  /\b(places?|venues?|restaurants?|cafes?|coffee shops?|bars?|museums?|galler(?:y|ies)|exhibitions?|events?|concerts?|shows?|tours?|classes|nightlife|date ideas?|activit(?:y|ies)|experiences?|attractions?|hotels?|destinations?|trips?|vacations?|itinerar(?:y|ies)|shops?|stores?|products?|laptops?|phones?|cameras?|headphones|monitors?|apps?|software|services?|subscriptions?|food|eat|mekan(?:lar)?|yer(?:ler)?|restoran(?:lar)?|kafe(?:ler)?|kahveci(?:ler)?|bar(?:lar)?|muze(?:ler)?|sergi(?:ler)?|etkinlik(?:ler)?|konser(?:ler)?|gosteri(?:ler)?|tur(?:lar)?|kurs(?:lar)?|gece hayati|aktivite(?:ler)?|deneyim(?:ler)?|gezi(?:ler)?|rota(?:lar)?|otel(?:ler)?|tatil(?:ler)?|magaza(?:lar)?|urun(?:ler)?|telefon(?:lar)?|kulaklik(?:lar)?|uygulama(?:lar)?|hizmet(?:ler)?|yemek)\b/i;
const RECOMMENDATION_FOLLOW_UP =
  /(?:^|\b)(?:also|but|more|instead|for example|i mean|what about|how about|something|somewhere|ama|daha|peki|mesela|yani|baska|ayrica|onun yerine)(?:\b|$)|\bnot\b.{0,80}\bbut\b|\bdegil de\b/i;
const REFERENTIAL_RECOMMENDATION_FOLLOW_UP =
  /\b(more like that|something like that|somewhere like that|another one|what else|buna benzer|onun gibi|boyle bir|baska ne)\b/i;

function foldRecommendationText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("\u0131", "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How far apart an intent word and an object word may sit and still describe
 * the same request.
 *
 * The pair carries meaning only when it is one phrase — "best cafes nearby",
 * "which laptop should I buy". Testing the two regexes independently over the
 * whole message asks a much weaker question, and the answer is yes for almost
 * any long text: a pasted blood-test report was classified as a request for
 * venue recommendations because "at the very top of the normal range" supplied
 * the intent and "diet, physical activity and sleep habits" supplied the
 * object, 6.5 KB apart, neither written by the user. The window is generous
 * enough for a clause with a qualifier in it and far too small to bridge two
 * unrelated paragraphs.
 */
const RECOMMENDATION_PAIR_WINDOW = 80;

function matchPositions(text: string, pattern: RegExp): number[] {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`);
  const positions: number[] = [];
  for (const match of text.matchAll(scan)) {
    if (match.index === undefined) continue;
    positions.push(match.index + match[0].length / 2);
    if (positions.length > 400) break;
  }
  return positions;
}

/** True when some intent word and some object word sit inside one window. */
function hasAdjacentRecommendationPair(text: string): boolean {
  const intents = matchPositions(text, LIVE_RECOMMENDATION_INTENT);
  if (!intents.length) return false;
  const objects = matchPositions(text, LIVE_RECOMMENDATION_OBJECT);
  if (!objects.length) return false;
  return intents.some((intent) =>
    objects.some(
      (object) => Math.abs(intent - object) <= RECOMMENDATION_PAIR_WINDOW,
    ),
  );
}

function requestsLiveRecommendation(value: string): boolean {
  const text = foldRecommendationText(value);
  return (
    LIVE_RECOMMENDATION_STRONG.test(text) || hasAdjacentRecommendationPair(text)
  );
}

function isRecommendationContinuation(value: string): boolean {
  const text = foldRecommendationText(value);
  if (REFERENTIAL_RECOMMENDATION_FOLLOW_UP.test(text)) return true;
  if (!RECOMMENDATION_FOLLOW_UP.test(text)) return false;
  // Held to the same proximity rule as the pair above, and for the same
  // reason: "but" at the top of a long paste and "products" buried in its
  // middle are not one follow-up request.
  const follow = matchPositions(text, RECOMMENDATION_FOLLOW_UP);
  const objects = matchPositions(text, LIVE_RECOMMENDATION_OBJECT);
  return follow.some((at) =>
    objects.some((object) => Math.abs(at - object) <= RECOMMENDATION_PAIR_WINDOW),
  );
}

function hasActiveRecommendationContext(
  priorRequests: readonly string[],
): boolean {
  for (let index = priorRequests.length - 1; index >= 0; index -= 1) {
    const request = priorRequests[index]?.trim();
    if (!request) continue;
    if (requestsLiveRecommendation(request)) return true;
    if (!isRecommendationContinuation(request)) return false;
  }
  return false;
}

function continuesLiveRecommendation(
  value: string,
  priorRequests: readonly string[],
): boolean {
  return (
    isRecommendationContinuation(value) &&
    hasActiveRecommendationContext(priorRequests)
  );
}

const DOWNLOAD_VERB = /\b(download|fetch|pull\s+down|grab)\b/i;

const GARDEN_OBJECT =
  /\b(garden|gardens|note|notes|page|pages|source|sources|learning|quartz|graph|cluster)\b/i;

const GARDEN_WRITE_VERB =
  /\b(add|create|write|save|import|publish|update|revise|propose|append)\b/i;

const MEMORY_VERB =
  /\b(remember|recall|keep\s+in\s+mind|note\s+that|for\s+(?:next|future)\s+time|don'?t\s+forget|my\s+preference)\b/i;

const EXTERNAL_ACTION_VERB =
  /\b(email|e-mail|send|post|publish|share|submit|tweet|notify|invite|schedule|book|order|purchase|pay)\b/i;

// "message" is also a very common conversational noun (for example,
// "What did I say in my previous message?").  Treat it as an external
// action only when it is followed by an object/recipient.  Matching the
// target after the word keeps ordinary references to a prior message in the
// conversation-only path while preserving requests such as "message the
// team" and "message Alex".
const MESSAGE_ACTION =
  /\b(message|text|msg|forward|deliver|whats\s?app|telegram)\b/i;

const DESTRUCTIVE_SYSTEM =
  /\b(force[- ]push|git\s+reset\s+--hard|rebase|deploy|release|drop\s+(?:the\s+)?(?:database|table)|revoke|rotate\s+(?:the\s+)?(?:secret|credential|key)|uninstall|format\s+(?:the\s+)?(?:drive|disk)|shut\s*down|reboot)\b/i;

const COMMAND_OBJECT = /\b(commands?|scripts?|programs?|tests?|suite|build|server|service|cli|terminal|shell|npm|npx|node|python|pytest|git|cargo|bun|deno|powershell|bash)\b/i;
const FORMAT_OBJECT = /\b(pdfs?|docx?|xlsx?|csv|markdown|md|html|txt|json|png|jpe?g|mp3|mp4|wav)\b/i;
const CONTENT_ACTION = /\b(summari[sz]e|read|review|analy[sz]e|extract|write|create|make|generate|produce|edit|revise)\b/i;

/* ------------------------------------------------------------------ */
/* Reference extraction                                                */
/* ------------------------------------------------------------------ */

const PATH_LIKE =
  /(?:[A-Za-z]:[\\/][^\s"'`,;]+|\\\\[^\s"'`,;]+|~[\\/][^\s"'`,;]+|(?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])+[\w.-]+)/g;

const URL_LIKE = /https?:\/\/[^\s"'`<>)]+/gi;

const KNOWN_FOLDER =
  /\b(documents?|docments?|docuemnts?|desktop|destkop|downloads?|donwloads?|pictures?|pictuers?|onedrive|onedirve|home\s+(?:folder|directory))\b/gi;

// "video", "videos", and "music" are usually content categories, especially
// on the Garden surface (whose library has a "Video & audio" section). Treat
// them as Windows known folders only when the user actually names a personal
// folder. The old bare-token match turned "in video and audio" into
// C:\Users\...\Videos and raised an unrelated filesystem permission prompt.
const PERSONAL_MEDIA_FOLDER =
  /\b(?:my\s+(videos?|vidoes?|music|muisc)|(?:videos?|vidoes?|music|muisc)\s+(?:folder|directory))\b/gi;

const KNOWN_FOLDER_CANONICAL_NAMES: Readonly<Record<string, string>> = {
  document: "documents",
  documents: "documents",
  docment: "documents",
  docments: "documents",
  docuemnt: "documents",
  docuemnts: "documents",
  desktop: "desktop",
  destkop: "desktop",
  download: "downloads",
  downloads: "downloads",
  donwload: "downloads",
  donwloads: "downloads",
  picture: "pictures",
  pictures: "pictures",
  pictuer: "pictures",
  pictuers: "pictures",
  video: "videos",
  videos: "videos",
  vidoe: "videos",
  vidoes: "videos",
  music: "music",
  muisc: "music",
  onedrive: "onedrive",
  onedirve: "onedrive",
  "home folder": "home folder",
  "home directory": "home directory",
};

const FORMAT_TOKEN =
  /\b(?:to|into|as)\s+(pdfs?|docx?|xlsx?|csv|markdown|md|html|txt|json|png|jpe?g|mp3|mp4|wav)\b/gi;

function extractResources(text: string): ResourceReference[] {
  const out: ResourceReference[] = [];
  const seen = new Set<string>();
  const push = (ref: ResourceReference) => {
    const key = `${ref.kind}:${ref.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  for (const match of text.matchAll(URL_LIKE)) {
    push({ kind: "url", value: match[0] });
  }
  // Strip URLs before path scanning so URL segments are not read as paths.
  const withoutUrls = text.replace(URL_LIKE, " ");
  for (const match of withoutUrls.matchAll(PATH_LIKE)) {
    const value = match[0];
    // A bare "a/b" with no extension and no drive is too weak to treat as a
    // path reference; require a drive, UNC, home prefix, separator depth, or
    // a file extension.
    const absolute = /^(?:[A-Za-z]:[\\/]|\\\\|~[\\/])/.test(value);
    const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(value);
    if (!absolute && !hasExtension) continue;
    push({
      kind: "path",
      value,
      absolute,
      ...(hasExtension ? { resourceType: "file" as const } : {}),
    });
  }
  for (const match of withoutUrls.matchAll(KNOWN_FOLDER)) {
    // A document or picture is not the user's Documents/Pictures directory.
    // Require a personal/location phrase, an explicit folder noun, or the
    // conventional capitalized plural name rather than a bare category word.
    const before = withoutUrls.slice(Math.max(0, match.index! - 24), match.index);
    const after = withoutUrls.slice(match.index! + match[0].length);
    if (!/\b(?:my|our|in|under|inside)\s+(?:the\s+)?$/i.test(before) &&
        !/^\s+(?:folder|directory|fodler)\b/i.test(after) &&
        !/^(?:Documents|Downloads|Pictures|Desktop|OneDrive)$/.test(match[0])) continue;
    const key = match[0].toLowerCase().replace(/\s+/g, " ");
    push({
      kind: "path",
      value: KNOWN_FOLDER_CANONICAL_NAMES[key] ?? key,
      absolute: false,
      resourceType: "directory",
    });
  }
  for (const match of withoutUrls.matchAll(PERSONAL_MEDIA_FOLDER)) {
    const key = String(match[1] ?? match[0])
      .toLowerCase()
      .replace(/\b(?:my|folder|directory)\b/g, "")
      .trim();
    push({
      kind: "path",
      value: KNOWN_FOLDER_CANONICAL_NAMES[key] ?? key,
      absolute: false,
      resourceType: "directory",
    });
  }
  for (const match of text.matchAll(FORMAT_TOKEN)) {
    push({ kind: "format", value: match[1].toLowerCase() });
  }
  return out.slice(0, 40);
}

function mergeResources(
  extracted: ResourceReference[],
  resolved: readonly ResourceReference[],
): ResourceReference[] {
  const out: ResourceReference[] = [];
  const seen = new Set<string>();
  const push = (resource: ResourceReference) => {
    const key = `${resource.kind}:${resource.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resource);
  };
  // Server-verified references take the bounded slots before heuristic tokens
  // extracted from the current sentence. A plural list must never lose its
  // ninth target because an unrelated format/path token appeared first.
  for (const resource of resolved.slice(0, 32)) {
    if (
      resource.kind !== "path" ||
      resource.absolute !== true ||
      !resource.value.trim() ||
      resource.value.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(resource.value)
    ) {
      continue;
    }
    push({
      kind: "path",
      value: resource.value,
      absolute: true,
      resourceType: resource.resourceType,
    });
  }
  for (const resource of extracted) push(resource);
  return out.slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Coding determination                                                */
/* ------------------------------------------------------------------ */

/**
 * Whether the request names a *software artifact* as the thing to be produced
 * or altered.
 *
 * A filename that merely ends in `.ts` is explicitly not enough: "move these
 * .ts files" names files, not software behaviour. The artifact has to be
 * described in software terms.
 */
function isCodingAction(action: RequestedAction): boolean {
  if (!actionMatches(action, CODE_AUTHORING_VERB) &&
      !actionMatches(action, CREATION_VERB) &&
      !actionMatches(action, MODIFICATION_VERB)) return false;
  // A file's incidental extension/type never makes relocation code authoring.
  if (actionMatches(action, FS_MUTATION_VERB) &&
      !/\b(function|class|method|variable|symbol|type|interface)\b/i.test(action.object)) return false;
  if (FS_CREATE_OBJECT.test(action.object) &&
      !actionMatches(action, CODE_AUTHORING_VERB) &&
      !/\b(script|program|module|component|function|class|api|parser)\b/i.test(action.object)) return false;
  if (WRITTEN_DELIVERABLE.test(action.object)) return false;
  return SOFTWARE_OBJECT.test(action.object) ||
    (CODE_ARTIFACT.test(action.object) && SOFTWARE_QUALIFIER.test(action.object)) ||
    (CODE_ARTIFACT.test(action.object) && actionMatches(action, /\b(refactor|debug|instrument|scaffold|deprecate|unit[- ]test)\b/i)) ||
    // Naming a symbol as a rename target is unambiguously code manipulation.
    (action.verb === "rename" && /\b(function|class|method|variable|symbol|type|interface)\b/i.test(action.object));
}

export function requiresCodingOutcome(text: string): boolean {
  return requestedActions(text).some(isCodingAction);
}

function isExternalAction(action: RequestedAction): boolean {
  if (action.personalIntent || !action.target) return false;
  // Ordering information is a presentation request; purchasing is a different
  // sense of the verb and remains subject to confirmation.
  if (action.verb === "order" && /\b(?:alphabetically|chronologically|ascending|descending|by\s+(?:date|name|size|priority|importance|difficulty)|from\s+(?:best|worst|highest|lowest|smallest|largest))\b/i.test(action.target)) return false;
  // Delivery inside the current conversation needs no external connection.
  // Explicit recipients/channels still win over a conversational "me".
  if (/^(?:send|share|post)$/.test(action.verb) &&
      !/\b(?:to|via|on|through)\s+(?:(?:my|our|the)\s+)?(?:whats\s?app|telegram|phone|mobile|email|slack|discord|linkedin|twitter|x|facebook)\b|\bto\s+(?!me\b|us\b|this\s+chat\b)\S+/i.test(action.target) &&
      (/^(?:me|us|your\s+(?:thoughts|feedback|ideas))\b/i.test(action.object) || /\b(?:here|in\s+(?:this|the)\s+chat)\b/i.test(action.target))) return false;
  return actionMatches(action, EXTERNAL_ACTION_VERB) || actionMatches(action, MESSAGE_ACTION);
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

/** Strip leading slash selectors so a crafted token cannot steer the plan. */
export function requestWithoutSelectors(value: string): string {
  let remaining = value.trimStart();
  const token = /^\/(?:skill:|mcp:|prompt:|agent:)?[a-z0-9][a-z0-9_.-]*(?:\s+|$)/i;
  while (remaining.startsWith("/")) {
    const match = remaining.match(token);
    if (!match) break;
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return remaining.trim();
}

interface Signals {
  inspect: boolean;
  search: boolean;
  fsMutate: boolean;
  fsCreate: boolean;
  destructiveFs: boolean;
  run: boolean;
  convert: boolean;
  documents: boolean;
  media: boolean;
  web: boolean;
  download: boolean;
  garden: boolean;
  gardenWrite: boolean;
  memory: boolean;
  externalAction: boolean;
  destructiveSystem: boolean;
  coding: boolean;
  filesystemRead: boolean;
  fileScope: boolean;
  pathReference: boolean;
}

function readSignals(text: string, resources: ResourceReference[], resolvedResources: readonly ResourceReference[] = []): Signals {
  const actions = requestedActions(text);
  const keywords = requestKeywords(text);
  const has = (verbs: RegExp, predicate: (action: RequestedAction) => boolean = () => true) =>
    actions.some((action) => actionMatches(action, verbs) && predicate(action));
  const pathReference = resources.some((r) => r.kind === "path");
  const verifiedReference = resolvedResources.some((resolved) =>
    resolved.kind === "path" && resolved.absolute === true &&
    resources.some((resource) => resource.kind === "path" && resource.value === resolved.value));
  const fileScope = FILE_OBJECT.test(text) || pathReference;
  const garden = GARDEN_OBJECT.test(keywords);
  const namesPath = (action: RequestedAction) =>
    extractResources(action.objectSource.replace(/"([^"\n]*)"|`([^`\n]*)`|'([^'\n]*)'|“([^”\n]*)”/g,
      (_literal, ...groups) => {
        const value = groups.slice(0, 4).find((group) => typeof group === "string") ?? "";
        return /^(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\w.-]+[\\/][\w./\\-]+$)/.test(value) ||
          /^(?:Documents|Downloads|Pictures|Desktop|OneDrive)$/i.test(value) ? value : "";
      })).some((r) => r.kind === "path") ||
    (verifiedReference && /^(?:(?:all|both)\s+)?(?:it|them|these|those|this|that)\b/i.test(action.object));
  const fileTarget = (action: RequestedAction) => FILE_OBJECT.test(action.object) || namesPath(action);
  const fsMutate = has(FS_MUTATION_VERB, (action) => fileTarget(action) && !isCodingAction(action));
  const fsCreate = has(CREATION_VERB, (action) => FS_CREATE_OBJECT.test(action.object) && !isCodingAction(action));
  const destructiveFs = has(DESTRUCTIVE_FS_VERB, fileTarget);
  const convert = has(CONVERT_VERB, (action) =>
    fileTarget(action) || DOCUMENT_OBJECT.test(action.target) || MEDIA_OBJECT.test(action.target) || FORMAT_OBJECT.test(action.target));
  const documents = has(CONTENT_ACTION, (action) => DOCUMENT_OBJECT.test(action.object.replace(/\bword\b/g, ""))) ||
    (convert && actions.some((action) => actionMatches(action, CONVERT_VERB) && DOCUMENT_OBJECT.test(action.target)));
  const media = has(MEDIA_VERB, (action) => MEDIA_OBJECT.test(action.object) || namesPath(action) ||
    /^(?:it|this|that|these|those)(?:\s+(?:please|too))?$/i.test(action.object)) ||
    has(MEDIA_ANALYSIS_VERB, (action) => MEDIA_OBJECT.test(action.object));
  const filesystemRead = fsMutate || fsCreate || destructiveFs ||
    actions.some((action) =>
      (actionMatches(action, INSPECT_VERB) || actionMatches(action, SEARCH_VERB) || actionMatches(action, CONVERT_VERB) || actionMatches(action, MEDIA_VERB)) &&
      (namesPath(action) || /\b(files?|folders?|director(?:y|ies))\b/i.test(action.object))) ||
    // Information questions can name a location without an imperative verb.
    text.split(/[?!;\n]+/).some((clause) =>
      /^\s*(?:what(?:'?s|\s+is|\s+are)|which|where)\b/i.test(clause) &&
      /\b(files?|folders?|director(?:y|ies))\b/i.test(clause) &&
      extractResources(clause).some((resource) => resource.kind === "path"));
  return {
    inspect: INSPECT_VERB.test(text),
    search: SEARCH_VERB.test(text),
    fsMutate,
    fsCreate,
    destructiveFs,
    run: has(RUN_VERB, (action) => COMMAND_OBJECT.test(action.objectSource) || namesPath(action) || /^`[^`]+`/.test(action.objectSource)),
    convert,
    documents,
    media,
    web:
      has(WEB_VERB) ||
      has(/\b(search|look\s+up|check)\b/i, (action) => /\b(web|internet|online)\b/i.test(action.target)) ||
      LIVE_INFORMATION.test(keywords) ||
      (LIVE_WEATHER_QUERY.test(keywords) && !CONCEPTUAL_WEATHER.test(keywords)) ||
      (RELATIVE_DATE_QUERY.test(keywords) &&
        SCHEDULED_REAL_WORLD_EVENT.test(keywords)) ||
      (!pathReference &&
        has(PUBLISHED_SOURCE_VERB, (action) =>
          PUBLISHED_SOURCE_OBJECT.test(action.object) &&
          !SUPPLIED_SOURCE_OBJECT.test(action.object))) ||
      // A pasted link is a live source the answer must open — except a video
      // link. "What happens in this video <url>" is settled by the Watch
      // pipeline downloading that very video, not by a browser, so counting it
      // here armed the web-grounding gate on turns that could never satisfy it
      // and replaced correct video answers with the grounding refusal. The
      // same predicate Watch selection uses decides this, so the two can
      // never disagree about what a video link is.
      resources.some((r) => r.kind === "url" && !hasVideoUrl(r.value)),
    download: has(DOWNLOAD_VERB, (action) => action.verb === "download" ||
      fileTarget(action) || DOCUMENT_OBJECT.test(action.object) || MEDIA_OBJECT.test(action.object) ||
      /^BBLITERAL\d+TOKEN$/.test(action.object)),
    garden,
    gardenWrite: has(GARDEN_WRITE_VERB, (action) => GARDEN_OBJECT.test(action.object) ||
      /\b(?:to|into|in)\s+(?:(?:my|our|the|this|that)\s+)?(?:garden|notes?|page|quartz)\b/i.test(action.target)),
    memory: has(MEMORY_VERB),
    externalAction: actions.some(isExternalAction),
    destructiveSystem: actions.some((action) => DESTRUCTIVE_SYSTEM.test(action.verb) ||
      (action.verb === "drop" && /^(?:the\s+)?(?:database|table)\b/i.test(action.target)) ||
      (action.verb === "format" && /^(?:the\s+)?(?:drive|disk)\b/i.test(action.target))),
    coding: actions.some(isCodingAction),
    filesystemRead,
    fileScope,
    pathReference,
  };
}

function describeOutcome(text: string, signals: Signals): string {
  if (signals.coding) return "Modify or create software so the described behaviour exists.";
  if (signals.download) return "Download the requested resource to the authorized destination.";
  if (signals.destructiveFs) return "Remove the identified files after the user confirms the candidate list.";
  if (signals.fsMutate || signals.fsCreate) return "Leave the user's files arranged in the requested structure.";
  if (signals.media) return "Produce the requested media-derived artifact.";
  if (signals.convert || signals.documents) return "Produce the requested document in the target format.";
  if (signals.gardenWrite) return "Add the requested content to the authorized garden.";
  if (signals.run) return "Execute the requested command and report its result.";
  if (signals.web) return "Report current information gathered from the web, with sources.";
  if (signals.search || signals.inspect) return "Report an accurate answer grounded in the inspected material.";
  return "Answer the user's question.";
}

/**
 * Build an outcome-based execution plan for a turn.
 *
 * The returned capability set is the *minimum* needed for the steps in the
 * plan. Later steps may request expansion through a fresh plan; the planner
 * never pre-grants capability for work it has not yet justified.
 */
export function planTask(input: TaskPlanInput): TaskPlan {
  const raw = requestWithoutSelectors(input.request).slice(0, 8_000);
  const prose = requestWithoutSelectors(requestProse(input.request)).slice(0, 8_000);
  // Continuation context is used for *goal* wording only, never to widen
  // capability: a prior turn cannot silently escalate the current one.
  const goal = raw || (input.priorRequests?.at(-1) ?? "").slice(0, 8_000);
  const resources = mergeResources(
    extractResources(prose),
    input.resolvedResources ?? [],
  );
  const signals = readSignals(prose, resources, input.resolvedResources);
  // Prior text can continue a low-risk recommendation query, but it can never
  // grant web capability by itself. A current correction/reference marker is
  // required, preventing a stale restaurant question from making an unrelated
  // later turn browse.
  signals.web =
    signals.web ||
    requestsLiveRecommendation(requestKeywords(prose)) ||
    continuesLiveRecommendation(requestKeywords(prose), (input.priorRequests ?? []).map(requestKeywords));

  // A deletion cannot be planned before its target is known. "Delete them all",
  // "how do I delete a file in Python", and "should I clear my Gradle cache"
  // all match the destructive verb, but none of them identifies anything to
  // remove, so none of them is filesystem work: they are questions to answer.
  // Planning deletion anyway asked the broker to authorize removal with no
  // target, which it could only satisfy from an unrelated standing grant.
  if (signals.destructiveFs && !signals.pathReference) {
    signals.destructiveFs = false;
  }

  // The same rule for rearranging. A mutation verb carries no filesystem intent
  // on its own: "it shouldn't be a group thing", "sort out my exam schedule",
  // and "should I move abroad" all match one while naming nothing on disk. The
  // read step below already refuses to plan without a file, folder or path in
  // scope; the write step used to fire on the verb alone, so these turns asked
  // the broker to authorize writing with no target. That is unanswerable — the
  // turn stalls on "which folder should I inspect?" instead of reaching the
  // model — so a targetless mutation is a question to answer, not file work.
  if ((signals.fsMutate || signals.fsCreate) && !signals.pathReference && !signals.fileScope) {
    signals.fsMutate = false;
    signals.fsCreate = false;
  }

  const capabilities = new Set<TaskCapability>(["conversation"]);
  const steps: PlannedStep[] = [];
  const addStep = (
    description: string,
    stepCapabilities: TaskCapability[],
    requiresConfirmation = false,
  ) => {
    stepCapabilities.forEach((c) => capabilities.add(c));
    steps.push({
      index: steps.length + 1,
      description,
      capabilities: stepCapabilities,
      requiresConfirmation,
    });
  };

  const isolated = input.isolated === true || !input.authenticated;

  // --- Garden -----------------------------------------------------------
  if (signals.garden) {
    addStep("Search the authorized garden for relevant pages and sources.", ["garden_read"]);
  }

  // --- Web --------------------------------------------------------------
  if (signals.web) {
    addStep("Search the web and open the most relevant sources.", ["web_research"]);
  }

  // --- Filesystem reads -------------------------------------------------
  // Any request that names files/paths and asks to inspect, search, organise,
  // convert, or delete needs to look at the filesystem first.
  const needsFsRead = !isolated && signals.filesystemRead;
  if (needsFsRead) {
    addStep("Inspect the approved location to identify the relevant files.", ["filesystem_read"]);
  }

  // --- Documents --------------------------------------------------------
  if (signals.documents || (signals.convert && !signals.media)) {
    addStep("Read and convert the documents into the requested format.", ["document_processing"]);
  }

  // --- Media ------------------------------------------------------------
  if (signals.media) {
    addStep("Process the media and produce the derived artifact.", ["media_processing"]);
  }

  // --- Downloads --------------------------------------------------------
  if (signals.download && !isolated) {
    addStep(
      "Download the requested resource to the authorized destination after the exact command is approved.",
      ["web_research", "filesystem_write", "command_execution"],
    );
  }

  // --- Filesystem writes ------------------------------------------------
  if (!isolated && (signals.fsMutate || signals.fsCreate)) {
    addStep("Create the target structure and move the files into place.", ["filesystem_write"]);
  }
  // A converted/downloaded file has to land somewhere. Media analysis does
  // not: attached and Garden-retained recordings are staged into the turn's
  // own workspace, and a summary/transcript can be returned in chat. Requiring
  // a host-filesystem write for every mention of video or audio both exceeds
  // the requested outcome and creates an approval the media tools cannot use.
  if (!isolated && signals.convert && !capabilities.has("filesystem_write")) {
    addStep("Save the generated artifact to the selected location.", ["filesystem_write"]);
  }

  // --- Destructive filesystem -------------------------------------------
  if (!isolated && signals.destructiveFs) {
    addStep("Show the deletion candidates and wait for explicit confirmation.", ["filesystem_read"]);
    addStep("Delete the confirmed files.", ["destructive_filesystem"], true);
  }

  // --- Command execution -------------------------------------------------
  // Running an existing command is its own capability and never implies coding.
  if (!isolated && signals.run) {
    addStep("Run the requested command and capture its output and exit status.", ["command_execution"]);
  }

  // --- Coding ------------------------------------------------------------
  if (signals.coding && !isolated) {
    addStep("Modify the source to produce the requested behaviour.", ["coding", "filesystem_write"]);
    // Verification of a code change requires running its checks.
    addStep("Run the relevant checks and report the result.", ["command_execution"]);
  }

  // --- Garden writes -----------------------------------------------------
  if (signals.gardenWrite) {
    // Adding a new note is a direct write; revising existing content still
    // goes through the proposal workflow.
    addStep("Add or revise the authorized garden's content.", ["garden_write"]);
  }

  // --- Memory ------------------------------------------------------------
  if (signals.memory && !isolated) {
    addStep("Record the durable context through the memory layer.", ["memory"]);
  }

  // --- External / application actions -------------------------------------
  if (signals.externalAction && !isolated) {
    addStep(
      "Perform the external action through an approved connection after confirmation.",
      ["application_action", "mcp"],
      true,
    );
  }

  // --- Destructive system actions ----------------------------------------
  if (signals.destructiveSystem && !isolated) {
    addStep(
      "Perform the high-impact system action only after explicit confirmation.",
      ["destructive_system_action"],
      true,
    );
  }

  // --- Fallback ----------------------------------------------------------
  if (steps.length === 0) {
    addStep("Answer from conversation and available grounded context.", ["conversation"]);
  }

  // Multi-step plans that touch real resources benefit from delegation.
  if (steps.length >= 4 && !isolated) {
    capabilities.add("subagent");
  }

  const confirmationSteps = steps.filter((s) => s.requiresConfirmation);
  const requiresConfirmation = confirmationSteps.length > 0;
  const riskLevel: RiskLevel = signals.destructiveSystem
    ? "high"
    : signals.destructiveFs || signals.externalAction
      ? "high"
      : capabilities.has("filesystem_write") || capabilities.has("coding") || capabilities.has("command_execution")
        ? "medium"
        : "low";

  return {
    userGoal: goal,
    intendedOutcome: describeOutcome(raw, signals),
    steps,
    requiredCapabilities: [...capabilities],
    requiredResources: resources,
    requiresCoding: signals.coding && !isolated,
    // The web *signal* only — not `capabilities.has("web_research")`, which the
    // download step also sets while asking for a file rather than for facts.
    requiresWebEvidence: signals.web,
    requiresConfirmation,
    confirmationReason: requiresConfirmation
      ? confirmationSteps.map((s) => s.description).join(" ")
      : undefined,
    riskLevel,
    rationale: explainPlan(signals, isolated),
    planSource: "breadboard_task_planner_v1",
  };
}

/**
 * Capabilities a Super Agent turn holds no matter how the sentence reads.
 *
 * These are the classes whose authority is the *inventory* — the reviewed skills,
 * the connected services, the specialist roster, the Garden, the web. A super
 * agent is asked to pick the right instrument itself, and the planner cannot know
 * from "sort this out for me" that a connection or a skill is what it will need.
 *
 * The filesystem classes are deliberately absent. Those are authorized by the
 * user's own persisted grants rather than by a mode, so a super-agent turn that
 * needs a folder still asks for it exactly as a normal turn does.
 */
export const SUPER_AGENT_CAPABILITIES: readonly TaskCapability[] = [
  "garden_read",
  "garden_write",
  "web_research",
  "mcp",
  "application_action",
  "skill",
  "subagent",
  "memory",
];

/**
 * Widen a plan to the Super Agent capability set. The plan's own steps, resources
 * and risk level are untouched: this adds reach, not intent, so the broker still
 * decides what is actually granted and every confirmation the plan asked for
 * still stands.
 *
 * `requiresWebEvidence` is part of that "not intent" and rides through the spread
 * unchanged. Holding a super-agent turn to a web result it never asked for is
 * precisely the confusion this function's reach/intent split exists to avoid.
 */
export function elevateForSuperAgent(plan: TaskPlan): TaskPlan {
  const capabilities = new Set<TaskCapability>(plan.requiredCapabilities);
  for (const capability of SUPER_AGENT_CAPABILITIES) capabilities.add(capability);
  return {
    ...plan,
    requiredCapabilities: [...capabilities],
    rationale:
      `${plan.rationale} Super agent is on for this turn, so the skill, connection, delegation, memory, Garden and web classes were added on top of the planned outcome; filesystem access still comes only from the user's own grants.`,
  };
}

function explainPlan(signals: Signals, isolated: boolean): string {
  if (isolated) {
    return "This session is unauthenticated or isolated, so only public conversation and public garden context were planned.";
  }
  const parts: string[] = [];
  if (signals.coding) {
    parts.push("the requested end state is new or modified software, so coding was selected");
  } else if (signals.fsMutate || signals.fsCreate || signals.destructiveFs) {
    parts.push("the requested end state is a change to how the user's files are arranged, which is a filesystem outcome rather than a development one");
  } else if (signals.run) {
    parts.push("the request runs an existing command, which is scoped execution and does not imply code authorship");
  } else if (signals.inspect || signals.search) {
    parts.push("the request asks for an answer about existing material, so only read access was selected");
  }
  if (signals.media) parts.push("media processing is required to produce the derived artifact");
  if (signals.documents) parts.push("document processing is required for the target format");
  if (signals.download) parts.push("the requested external file requires an authorized destination and exact-command approval");
  if (signals.web) parts.push("current external information is required");
  return parts.length
    ? `Capabilities were selected from the requested outcome: ${parts.join("; ")}.`
    : "No action capability was required; the request is conversational.";
}
