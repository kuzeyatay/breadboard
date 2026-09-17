// Shared, conservative request parsing for deterministic routing. Recognizing a
// word is not evidence that the user asked us to perform the action it names.
// Only a requested clause head can supply an action; its own object supplies
// the subject. Tool authorization remains the capability broker's job.

export interface RequestedAction {
  verb: string;
  /** The complete requested clause, with literal text restored. */
  source: string;
  /** Literal contents cannot supply keywords to another action. */
  target: string;
  /** Direct object, before source, purpose, destination or explanatory clauses. */
  object: string;
  /** The same object with quoted names/paths restored for resource scoping. */
  objectSource: string;
  /** First-person wishes describe an outcome, not an instruction to send/buy. */
  personalIntent: boolean;
}

const VERBS = [
  "wire\\s+up", "set\\s+up", "back\\s+up", "clear\\s+out", "get\\s+rid\\s+of",
  "kick\\s+off", "save\\s+as", "output\\s+as", "turn\\s+(?:it\\s+)?into",
  "extract\\s+audio", "keep\\s+in\\s+mind", "note\\s+that", "look\\s+up",
  "look\\s+for", "take\\s+over", "interact\\s+with", "listen\\s+to",
  "git\\s+reset\\s+--hard", "force[- ]push", "shut\\s*down",
  "double[ -]?click", "right[ -]?click", "fill(?:\\s+in|\\s+out)?",
  "check\\s+(?:the\\s+)?(?:box|checkbox)",
  "implement", "refactor", "debug", "patch", "instrument", "scaffold", "wire",
  "integrate", "migrate", "port", "rewrite", "reimplement", "fix", "repair",
  "resolve", "correct", "harden", "optimi[sz]e", "parameteri[sz]e", "deprecate", "unit[- ]test",
  "add", "build", "create", "develop", "generate", "introduce", "make", "produce", "write",
  "draft", "prepare", "author", "compose",
  "change", "edit", "modify", "update", "adjust", "revise", "replace", "extend", "rename",
  "move", "copy", "duplicate", "organi[sz]e", "sort", "tidy", "group", "consolidate",
  "flatten", "archive", "unzip", "zip", "extract", "relocate", "reorgani[sz]e", "restructure", "stage",
  "delete", "remove", "erase", "purge", "trash", "wipe", "discard",
  "run", "execute", "invoke", "launch", "start", "rerun", "re-run",
  "convert", "export", "render", "transform", "transcribe", "caption", "subtitle", "diari[sz]e", "re-?encode", "trim", "clip",
  "download", "fetch", "pull\\s+down", "grab",
  "email", "e-mail", "send", "post", "publish", "share", "submit", "tweet", "notify",
  "invite", "schedule", "book", "order", "purchase", "pay", "message", "text", "msg",
  "forward", "shoot", "push", "deliver", "drop", "whats\\s?app", "telegram",
  "commit", "deploy", "release", "rebase", "reset", "revoke", "rotate", "uninstall", "format", "reboot",
  "remember", "recall", "save", "import", "propose", "append",
  "analy[sz]e", "assess", "audit", "compare", "describe", "diagnose", "examine", "explain",
  "identify", "inspect", "interpret", "list", "outline", "read", "review", "show", "summari[sz]e",
  "trace", "understand", "find", "search", "locate", "grep", "browse", "google", "research", "watch",
  "click", "drag", "scroll", "type", "enter", "select", "choose", "press", "toggle", "uncheck",
  "open", "close", "dismiss", "resize", "use", "control", "operate", "drive",
].join("|");
const HEAD = new RegExp(`^(${VERBS})\\b(?!-)`, "i");
// "actually"/"really" are how a user insists after a refusal ("can you
// actually read those papers"); left in place they hide the verb and the
// clause parses as no request at all.
const PREFIX = /^(?:(?:please|now|then|next|also|instead|okay|ok|sure|yes|just|kindly|actually|really)\s+)*(?:(?:(?:can|could|would|will)\s+you\s+|(?:i|we)\s+(?:want|need|would\s+like)\s+you\s+to\s+|(?:i'd|we'd)\s+like\s+you\s+to\s+|help\s+(?:me|us)\s+(?:to\s+)?)(?:please\s+)?)?/i;
const NEGATION = /^(?:do\s+not|don['’]?t|dont|not|never|without|avoid|no\s+need\s+to)\s+(?:ever\s+)?/i;
const QUESTION = /^(?:how|why|what|which|where|when|whether|should\b|could\s+i|can\s+i|would\s+i|may\s+i)\b/i;
const EXPLICIT_RESTART = /^(?:(?:please|now|then|next|instead)\s+|(?:can|could|would|will)\s+you\b|(?:i|we)\s+(?:want|need)\s+you\b)/i;
const PERSONAL_INTENT = /^(?:(?:i|we)\s+(?:want|need|would\s+like)|(?:i['’]d|we['’]d)\s+like)\s+/i;
const SUBORDINATE = new RegExp(`\\S\\s+(?:that|which)\\b|\\b(?:how|whether|if|when)\\b|\\bto\\s+(?:${VERBS})\\b`, "i");
const OBJECT_BOUNDARY = /\b(?:from|using|via|based\s+on|according\s+to|about|because|while|where|which|that|so|when|if|with|for|into|onto|to)\b/i;

/** Attached/pasted evidence is not another set of user instructions. */
export function requestProse(value: string): string {
  return value
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, "\n")
    .replace(/^\s*>.*$/gm, "")
    .replace(/<(document|attachment|untrusted_text|tool_output|source_content)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "\n");
}

/** A source/URL/string can be an object, but its words cannot be verbs. */
function protectLiterals(text: string): { text: string; restore: (value: string) => string } {
  const literals: string[] = [];
  const masked = text.replace(
    /https?:\/\/[^\s<>]+|`[^`\n]+`|"[^"\n]*"|“[^”\n]*”|(?:^|(?<=\s))'[^'\n]+'(?=\s|[.,;!?]|$)/g,
    (literal) => `BBLITERAL${literals.push(literal) - 1}TOKEN`,
  );
  return {
    text: masked,
    restore: (value) => value.replace(/BBLITERAL(\d+)TOKEN/g, (token, index) => literals[Number(index)] ?? token),
  };
}

function stripPrefix(text: string): string {
  let clause = text.trim().replace(/^(?:[-*]|\d+[.)])\s+/, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = clause.replace(PREFIX, "").trim();
    if (next === clause) break;
    clause = next;
  }
  return clause;
}

export function requestKeywords(value: string): string {
  return protectLiterals(requestProse(value)).text;
}

function directObject(target: string): string {
  // "Make changes to the parser" names the parser as the object of change.
  const object = target.replace(/^(?:(?:a|the|some)\s+)?(?:changes?|updates?|improvements?|fixes?)\s+(?:to|in)\s+/i, "");
  const boundary = object.search(new RegExp(`\\s+(?:${OBJECT_BOUNDARY.source})`, "i"));
  return (boundary < 0 ? object : object.slice(0, boundary)).trim();
}

export function requestedActions(value: string): RequestedAction[] {
  const protectedText = protectLiterals(requestProse(value).slice(0, 8_000));
  const actions: RequestedAction[] = [];
  // Unlike splitting at every period, this preserves filenames and decimals.
  for (const sentence of protectedText.text.split(/(?:[.!?;](?:\s+|$)|\r?\n+)/)) {
    let inheritedNegation = false;
    let inheritedDiscussion = false;
    let subordinate = false;
    // Retain separators so "or" inherits a prohibition while "but" can
    // introduce an independent instruction. A fresh explicit request resets it.
    const parts = sentence.split(/(,\s*|\s+(?:and|but|or|then)\s+)/i);
    for (let index = 0; index < parts.length; index += 2) {
      const part = parts[index].trim();
      if (!part) continue;
      const separator = (parts[index - 1] ?? "").trim().toLowerCase();
      const restart = EXPLICIT_RESTART.test(part) || /^(?:but|then)\s+/i.test(part) || separator === "but" || separator === "then";
      if (restart) {
        inheritedNegation = false;
        inheritedDiscussion = false;
        subordinate = false;
      }
      let clause = stripPrefix(part.replace(/^(?:and|but|or)\s+/i, ""));
      const personalIntent = PERSONAL_INTENT.test(clause);
      if (personalIntent) {
        clause = clause.replace(PERSONAL_INTENT, "");
        clause = /^to\s+/i.test(clause) ? clause.replace(/^to\s+/i, "") : `create ${clause}`;
      }
      if (NEGATION.test(clause)) {
        inheritedNegation = true;
        clause = clause.replace(NEGATION, "");
      }
      if (QUESTION.test(clause)) inheritedDiscussion = true;
      const head = clause.match(HEAD);
      if (head && !inheritedNegation && !inheritedDiscussion && !subordinate) {
        const target = clause.slice(head[0].length).trim();
        actions.push({
          verb: head[0].toLowerCase(),
          source: protectedText.restore(clause),
          target,
          object: directObject(target),
          objectSource: protectedText.restore(directObject(target)),
          personalIntent,
        });
        subordinate = SUBORDINATE.test(target);
      }
    }
  }
  return actions;
}

/** Match the action head, never a second verb embedded in its object. */
export function actionMatches(action: RequestedAction, verbs: RegExp): boolean {
  return new RegExp(`^(?:${verbs.source})$`, verbs.flags.replace(/[gy]/g, "")).test(action.verb);
}
