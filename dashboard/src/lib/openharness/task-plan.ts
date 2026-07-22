// Outcome-based task planning for the OpenHarness runtime.
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
}

export interface TaskPlan {
  userGoal: string;
  intendedOutcome: string;
  steps: PlannedStep[];
  requiredCapabilities: TaskCapability[];
  requiredResources: ResourceReference[];
  requiresCoding: boolean;
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
// deliberately NOT in this list — see codeArtifactMentioned().
const CODE_ARTIFACT =
  /\b(api|app|application|authentication|authori[sz]ation|backend|bug|class|cli|codebase|code|component|constructor|controller|dependency|endpoint|feature|frontend|function|handler|hook|interface|library|method|middleware|migration|module|package|parser|pipeline|plugin|program|regression|route|schema|script|server|service|software|test|tests|suite|type|typing|validator|variable|website|webhook)\b/i;

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

const FS_CREATE_VERB =
  /\b(create|make|add|new)\b[^.\n]{0,24}\b(folder|directory|file|note|subfolder)\b/i;

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

const WEB_VERB =
  /\b(browse|google|research|search\s+(?:the\s+)?(?:web|internet|online)|look\s+up\s+online|check\s+online|latest|current|news|recent\s+developments?|up[- ]to[- ]date)\b/i;

// Live conditions are inherently time-sensitive even when the user does not
// spell that out with words such as "current" or "latest". Treating a plain
// "what's the weather" prompt as conversation makes the model answer from its
// training data instead of activating the web tools needed to verify it.
const LIVE_WEATHER_QUERY =
  /\b(weather|forecast|temperature|temperatures|air\s+quality|wind\s+speed|precipitation)\b/i;

const DOWNLOAD_VERB = /\b(download|fetch|pull\s+down|grab)\b/i;

const GARDEN_OBJECT =
  /\b(garden|gardens|note|notes|page|pages|source|sources|learning|quartz|graph|cluster)\b/i;

const GARDEN_WRITE_VERB =
  /\b(add|create|write|save|import|publish|update|revise|propose|append)\b/i;

const MEMORY_VERB =
  /\b(remember|recall|keep\s+in\s+mind|note\s+that|for\s+(?:next|future)\s+time|don'?t\s+forget|my\s+preference)\b/i;

const EXTERNAL_ACTION_VERB =
  /\b(email|e-mail|send|message|post|publish|share|submit|tweet|notify|invite|schedule|book|order|purchase|pay)\b/i;

const DESTRUCTIVE_SYSTEM =
  /\b(force[- ]push|git\s+reset\s+--hard|rebase|deploy|release|drop\s+(?:the\s+)?(?:database|table)|revoke|rotate\s+(?:the\s+)?(?:secret|credential|key)|uninstall|format\s+(?:the\s+)?(?:drive|disk)|shut\s*down|reboot)\b/i;

const EXPLICIT_NO_MUTATION =
  /\b(?:do\s+not|don'?t|without|no\s+need\s+to)\b[^.\n]{0,60}\b(?:change|edit|modify|write|delete|remove|move|implement)\b/i;

// Phrases that state the request is purely conceptual, so no artifact is touched.
const CONCEPTUAL_ONLY =
  /\b(brainstorm|conceptually|in\s+theory|hypothetically|what\s+would\s+it\s+take|pros\s+and\s+cons|trade[- ]?offs?)\b/i;

/* ------------------------------------------------------------------ */
/* Reference extraction                                                */
/* ------------------------------------------------------------------ */

const PATH_LIKE =
  /(?:[A-Za-z]:[\\/][^\s"'`,;]+|\\\\[^\s"'`,;]+|~[\\/][^\s"'`,;]+|(?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])+[\w.-]+)/g;

const URL_LIKE = /https?:\/\/[^\s"'`<>)]+/gi;

const KNOWN_FOLDER =
  /\b(documents?|desktop|downloads?|pictures?|videos?|music|onedrive|home\s+(?:folder|directory))\b/gi;

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
    push({ kind: "path", value, absolute });
  }
  for (const match of withoutUrls.matchAll(KNOWN_FOLDER)) {
    push({ kind: "path", value: match[0], absolute: false });
  }
  for (const match of text.matchAll(FORMAT_TOKEN)) {
    push({ kind: "format", value: match[1].toLowerCase() });
  }
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
function codeArtifactMentioned(text: string): boolean {
  return CODE_ARTIFACT.test(text);
}

/**
 * Decide whether producing the requested end state requires writing or
 * modifying source code.
 *
 * True only when an authoring/creation/modification verb is applied to a
 * software artifact. Filesystem manipulation of code files, inspection of
 * code, and execution of existing commands all return false.
 */
export function requiresCodingOutcome(text: string): boolean {
  if (EXPLICIT_NO_MUTATION.test(text)) return false;
  if (CONCEPTUAL_ONLY.test(text) && !CODE_AUTHORING_VERB.test(text)) return false;

  const codeArtifact = codeArtifactMentioned(text);
  if (!codeArtifact) return false;

  // "fix the failing tests", "refactor the parser", "debug this handler"
  if (CODE_AUTHORING_VERB.test(text)) {
    // Guard: a filesystem mutation verb applied to files wins over an
    // incidental authoring word (e.g. "move the fixed files").
    if (isPurelyFileManipulation(text)) return false;
    return true;
  }

  // "create a Python script that cleans this dataset", "add authentication"
  if (CREATION_VERB.test(text) || MODIFICATION_VERB.test(text)) {
    if (isPurelyFileManipulation(text)) return false;
    // "create a folder", "add a file" are filesystem outcomes even though the
    // creation verb matched.
    if (FS_CREATE_VERB.test(text) && !CODE_AUTHORING_VERB.test(text)) {
      // Only filesystem if no software artifact is the object of creation.
      if (!/\b(?:script|program|application|app|cli|library|module|component|function|class|api|endpoint|service|parser)\b/i.test(text)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * True when the request is about relocating/organising/removing files, even if
 * those files happen to contain code. This is the guard that keeps
 * "move these .ts files into an archive folder" out of the coding class.
 */
function isPurelyFileManipulation(text: string): boolean {
  const mutates = FS_MUTATION_VERB.test(text) || DESTRUCTIVE_FS_VERB.test(text);
  if (!mutates) return false;
  // If the sentence also asks for behaviour change, it is not purely file work.
  if (/\b(so\s+that\s+it|so\s+it|and\s+(?:make|fix|implement|refactor)\b)/i.test(text)) {
    return false;
  }
  // Renaming a *symbol* is coding; renaming *files* is not.
  if (/\brename\b/i.test(text) && /\b(function|class|method|variable|symbol|type|interface)\b/i.test(text)) {
    return false;
  }
  return true;
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
  fileScope: boolean;
  pathReference: boolean;
}

function readSignals(text: string, resources: ResourceReference[]): Signals {
  const pathReference = resources.some((r) => r.kind === "path");
  const fileScope = FILE_OBJECT.test(text) || pathReference;
  const garden = GARDEN_OBJECT.test(text);
  return {
    inspect: INSPECT_VERB.test(text),
    search: SEARCH_VERB.test(text),
    fsMutate: FS_MUTATION_VERB.test(text),
    fsCreate: FS_CREATE_VERB.test(text),
    destructiveFs: DESTRUCTIVE_FS_VERB.test(text),
    run: RUN_VERB.test(text),
    convert: CONVERT_VERB.test(text),
    documents: DOCUMENT_OBJECT.test(text),
    media: MEDIA_OBJECT.test(text) || MEDIA_VERB.test(text),
    web:
      WEB_VERB.test(text) ||
      LIVE_WEATHER_QUERY.test(text) ||
      resources.some((r) => r.kind === "url"),
    download: DOWNLOAD_VERB.test(text),
    garden,
    gardenWrite: garden && GARDEN_WRITE_VERB.test(text),
    memory: MEMORY_VERB.test(text),
    externalAction: EXTERNAL_ACTION_VERB.test(text),
    destructiveSystem: DESTRUCTIVE_SYSTEM.test(text),
    coding: requiresCodingOutcome(text),
    fileScope,
    pathReference,
  };
}

function describeOutcome(text: string, signals: Signals): string {
  if (signals.coding) return "Modify or create software so the described behaviour exists.";
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
  // Continuation context is used for *goal* wording only, never to widen
  // capability: a prior turn cannot silently escalate the current one.
  const goal = raw || (input.priorRequests?.at(-1) ?? "").slice(0, 8_000);
  const resources = extractResources(raw);
  const signals = readSignals(raw, resources);

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
  const needsFsRead =
    !isolated &&
    (signals.pathReference || signals.fileScope) &&
    (signals.inspect ||
      signals.search ||
      signals.fsMutate ||
      signals.fsCreate ||
      signals.destructiveFs ||
      signals.convert ||
      signals.documents ||
      signals.media ||
      signals.coding);
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
  if (signals.download) {
    addStep("Download the authorized resource.", ["web_research", "filesystem_write"]);
  }

  // --- Filesystem writes ------------------------------------------------
  if (!isolated && (signals.fsMutate || signals.fsCreate)) {
    addStep("Create the target structure and move the files into place.", ["filesystem_write"]);
  }
  // A produced artifact (converted document, transcript, download) has to land
  // somewhere, so conversion/media outcomes imply a write.
  if (!isolated && (signals.convert || signals.media) && !capabilities.has("filesystem_write")) {
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
    addStep("Create or update the garden content through the proposal workflow.", ["garden_write"]);
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
    requiresConfirmation,
    confirmationReason: requiresConfirmation
      ? confirmationSteps.map((s) => s.description).join(" ")
      : undefined,
    riskLevel,
    rationale: explainPlan(signals, isolated),
    planSource: "breadboard_task_planner_v1",
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
  if (signals.web) parts.push("current external information is required");
  return parts.length
    ? `Capabilities were selected from the requested outcome: ${parts.join("; ")}.`
    : "No action capability was required; the request is conversational.";
}
