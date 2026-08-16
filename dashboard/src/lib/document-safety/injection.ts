// The prompt-injection phrase layer.
//
// This is the half the upstream scanner deliberately leaves out: wppoland's
// tool reports *concealment* and lets a human judge intent, and Andy8647's
// pdf-injection-scanner (MIT) carries the phrase patterns instead. Both are
// right on their own terms, and a document pipeline needs both — concealment
// with no instructions in it is usually a redaction accident, and instructions
// with no concealment are usually just prose.
//
// The rule that keeps this usable is the severity split, and it is the whole
// reason this file is not a flat regex list:
//
//   - The same sentence in *hidden* text is an attack. Nobody writes "ignore
//     all previous instructions" in white-on-white 1pt type by accident.
//   - The same sentence in *visible* text is, far more often, a document
//     about prompt injection. This garden has notes on exactly that subject.
//     Flagging them at critical severity would train the user to dismiss the
//     warning, which costs more than the rule earns.
//
// So visible text is reported at warning severity at most, and only when a
// `strong` pattern hits or several weaker ones do at once. Hidden text is
// reported at critical severity on any hit, because the concealment already
// supplied the intent the phrasing alone cannot.

import type { SafetyFinding } from "./types.ts";
import { quote } from "./unicode.ts";

interface InjectionPattern {
  /** The rule name shown in the finding. */
  label: string;
  pattern: RegExp;
  /**
   * Whether one hit is enough to report in *visible* text. Strong patterns
   * are ones with no natural use outside an instruction addressed to a model;
   * weak ones are phrases a normal document can produce innocently.
   */
  strong: boolean;
}

/**
 * Every pattern is case-insensitive and anchored on phrasing rather than on
 * any one model's name, so a rename does not silently retire a rule.
 */
const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── Instruction override ────────────────────────────────────────────────
  {
    label: "instruction override",
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(previous|prior|above|preceding|earlier|all|any|your)\b[^.!?\n]{0,30}\b(instruction|instructions|prompt|prompts|direction|directions|rule|rules|guideline|guidelines|context)\b/i,
    strong: true,
  },
  {
    label: "instruction override",
    pattern: /\b(ignore|disregard)\s+everything\s+(above|before|prior|you|that)\b/i,
    strong: true,
  },
  // ── Role and system reassignment ────────────────────────────────────────
  {
    label: "system prompt injection",
    pattern:
      /(^|\n)\s*(\[|<\|?|#{1,4}\s*)?(system|assistant|developer)\s*(\|?>|\]|:)\s*\S/i,
    strong: false,
  },
  {
    label: "system prompt injection",
    pattern: /\b(new|updated|revised|real|actual)\s+(system\s+)?(prompt|instructions?)\s*[:.]/i,
    strong: true,
  },
  {
    label: "role reassignment",
    pattern:
      /\byou\s+are\s+(now\s+)?(a|an|no\s+longer|not\s+a)\b|\b(act|behave|respond)\s+as\s+(a|an|if)\b|\bpretend\s+(to\s+be|you(?:'re| are))\b/i,
    strong: false,
  },
  // ── Text addressed at the reader-as-model ───────────────────────────────
  {
    label: "instruction addressed to an AI reader",
    pattern:
      /\b(note|message|instruction|instructions)\s+(to|for)\s+(the\s+)?(ai|a\.i\.|llm|language\s+model|assistant|chatbot|reviewer\s+ai|automated\s+reviewer)\b/i,
    strong: true,
  },
  {
    label: "instruction addressed to an AI reader",
    pattern:
      /\b(attention|dear|hello|hey)[,:]?\s+(ai|llm|language\s+model|assistant|chatgpt|claude|gemini|copilot|grok)\b/i,
    strong: true,
  },
  {
    label: "instruction addressed to an AI reader",
    pattern:
      /\b(if|when)\s+you\s+are\s+(an?\s+)?(ai|llm|language\s+model|assistant|automated|reading\s+this)\b/i,
    strong: true,
  },
  // ── Concealment from the human in the loop ──────────────────────────────
  {
    label: "instruction to conceal from the user",
    pattern:
      /\b(do\s+not|don't|never)\s+(tell|mention|inform|reveal|show|disclose|report)\b[^.!?\n]{0,30}\b(the\s+)?(user|human|reader|reviewer|recipient|anyone)\b/i,
    strong: true,
  },
  {
    label: "instruction to conceal from the user",
    pattern:
      /\b(without\s+(telling|informing|notifying|alerting))\b|\bkeep\s+this\s+(secret|hidden|confidential|between\s+us)\b|\bthis\s+(text|message|note|section)\s+is\s+(only\s+)?for\s+(the\s+)?(ai|model|assistant)\b/i,
    strong: true,
  },
  // ── Evaluation and screening manipulation ───────────────────────────────
  {
    label: "evaluation manipulation",
    pattern:
      /\b(give|write|provide|produce|leave|return)\b[^.!?\n]{0,25}\b(positive|favou?rable|glowing|strong|excellent|enthusiastic)\b[^.!?\n]{0,15}\b(review|assessment|evaluation|feedback|recommendation)\b/i,
    strong: true,
  },
  {
    label: "evaluation manipulation",
    pattern:
      /\b(recommend|advance|shortlist|hire|accept|approve)\b[^.!?\n]{0,25}\b(this|the)\s+(candidate|applicant|paper|submission|manuscript|proposal|document|cv|r[ée]sum[ée])\b/i,
    strong: true,
  },
  {
    label: "evaluation manipulation",
    pattern:
      /\b(do\s+not|don't|never)\b[^.!?\n]{0,25}\b(mention|highlight|report|list|raise|note)\b[^.!?\n]{0,25}\b(weakness|weaknesses|flaw|flaws|negative|negatives|shortcoming|shortcomings|concern|concerns|limitation|limitations)\b/i,
    strong: true,
  },
  {
    label: "evaluation manipulation",
    pattern:
      /\b(rate|score|grade)\b[^.!?\n]{0,20}\b(highly|maximum|top|10\s*\/\s*10|5\s*\/\s*5|as\s+(excellent|outstanding|strong))\b/i,
    strong: true,
  },
  // ── Canary phrases: an instruction whose only purpose is to prove the
  //    reader was a model. The Madagascar case in the upstream README.
  {
    label: "output canary instruction",
    pattern:
      /\b(include|place|insert|mention|add|use)\b[^.!?\n]{0,40}\b(the\s+)?word\b[^.!?\n]{0,40}\b(in|somewhere\s+in|within)\b[^.!?\n]{0,25}\b(your\s+)?(response|answer|reply|summary|output)\b/i,
    strong: true,
  },
  // ── Prompt disclosure and exfiltration ──────────────────────────────────
  {
    label: "system prompt disclosure attempt",
    pattern:
      /\b(reveal|repeat|print|output|show|display|summari[sz]e|reproduce)\b[^.!?\n]{0,30}\b(your|the)\s+(system\s+)?(prompt|instructions|rules|guidelines|configuration)\b/i,
    strong: true,
  },
  {
    label: "data exfiltration lure",
    pattern:
      /\b(send|post|upload|transmit|forward|exfiltrate)\b[^.!?\n]{0,40}\bhttps?:\/\//i,
    strong: true,
  },
  {
    label: "data exfiltration lure",
    pattern:
      /!?\[[^\]\n]*\]\(\s*https?:\/\/[^)\s]*[?&][^)\s]*=\s*\{?\{?\s*(conversation|history|prompt|context|secret|api[_-]?key|token)/i,
    strong: true,
  },
  // ── Tool and capability lures ───────────────────────────────────────────
  {
    label: "tool invocation lure",
    pattern:
      /\b(call|invoke|run|execute|use)\s+(the\s+)?(tool|function|command|shell|bash|terminal|python)\b[^.!?\n]{0,30}\b(with|to)\b/i,
    strong: false,
  },
  {
    label: "safety bypass request",
    pattern:
      /\b(developer|debug|god|jailbreak|dan|unrestricted)\s+mode\b|\bwithout\s+(any\s+)?(restrictions|filters|safety|guardrails)\b/i,
    strong: true,
  },
  // ── Non-English phrasings. The same attacks are routinely written in the
  //    document's own language, and an English-only rule set reads clean.
  {
    label: "instruction override (Chinese)",
    pattern: /忽略(掉)?(之前|以上|上述|前面)?(的)?(所有)?(指令|指示|提示|要求)|你现在是|请?给出?(正面|好)的?(评价|评论)/,
    strong: true,
  },
  {
    label: "instruction override (Spanish)",
    pattern: /\bignora\b[^.!?\n]{0,30}\b(instrucciones|indicaciones)\s+(anteriores|previas)/i,
    strong: true,
  },
  {
    label: "instruction override (French)",
    pattern: /\bignore[zr]?\b[^.!?\n]{0,30}\b(instructions|consignes)\s+(pr[ée]c[ée]dentes|ant[ée]rieures)/i,
    strong: true,
  },
  {
    label: "instruction override (German)",
    pattern: /\bignoriere\b[^.!?\n]{0,30}\b(vorherigen|bisherigen|obigen)\s+(anweisungen|anleitungen)/i,
    strong: true,
  },
];

/** How many weak patterns must hit before visible text is worth reporting. */
const WEAK_PATTERN_QUORUM = 3;

/** The most text worth pattern-matching. Long enough for any real document. */
const MAX_SCAN_CHARS = 2_000_000;

interface InjectionMatch {
  label: string;
  strong: boolean;
  /** The matched sentence, trimmed to something quotable. */
  excerpt: string;
}

function excerptAround(text: string, index: number, length: number): string {
  // Widen to the surrounding sentence so the quote reads as a claim rather
  // than as a fragment of one.
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function collectMatches(text: string): InjectionMatch[] {
  const matches: InjectionMatch[] = [];
  const seen = new Set<string>();

  for (const rule of INJECTION_PATTERNS) {
    const found = rule.pattern.exec(text);
    if (!found) continue;
    // One finding per label, keeping the first excerpt. Several rules share a
    // label on purpose — an override phrased four ways is still one override —
    // and the overlapping ones would otherwise report the same sentence three
    // times with the window shifted a few characters, which reads as three
    // separate problems.
    if (seen.has(rule.label)) continue;
    seen.add(rule.label);
    matches.push({
      label: rule.label,
      strong: rule.strong,
      excerpt: excerptAround(text, found.index, found[0].length),
    });
  }

  return matches;
}

/**
 * Scan text a layer has proved a human reader cannot see.
 *
 * Every hit is critical here. The concealment is the intent: a sentence that
 * would be ambiguous in the body of a document is not ambiguous when somebody
 * went to the trouble of making it invisible.
 */
export function scanHiddenTextForInjection(
  hiddenText: string,
  where: string,
): SafetyFinding[] {
  if (!hiddenText.trim()) return [];

  return collectMatches(hiddenText.slice(0, MAX_SCAN_CHARS)).map((match) => ({
    severity: "critical" as const,
    type: `Hidden prompt injection (${match.label})`,
    where,
    detail:
      "Text a reader cannot see contains an instruction addressed to whatever " +
      `model reads this document. Content: ${quote(match.excerpt)}`,
  }));
}

/**
 * Scan the text a reader *can* see.
 *
 * Reported at warning severity and only past the quorum, because a document
 * that discusses prompt injection contains these phrases legitimately, and a
 * warning nobody believes is worse than no warning at all. The finding says so
 * in as many words, so the user is not left guessing which case they have.
 */
export function scanVisibleTextForInjection(
  visibleText: string,
  where: string,
): SafetyFinding[] {
  if (!visibleText.trim()) return [];

  const matches = collectMatches(visibleText.slice(0, MAX_SCAN_CHARS));
  const strong = matches.filter((match) => match.strong);
  const weak = matches.filter((match) => !match.strong);

  const reportable =
    strong.length > 0
      ? strong
      : weak.length >= WEAK_PATTERN_QUORUM
        ? weak
        : [];

  return reportable.map((match) => ({
    severity: "warning" as const,
    type: `Prompt-injection phrasing in visible text (${match.label})`,
    where,
    detail:
      "This is visible to a reader, so it may simply be a document that " +
      "discusses prompt injection rather than one attempting it. " +
      `Content: ${quote(match.excerpt)}`,
  }));
}

/** Exposed for the tests, which assert the rule set does not quietly shrink. */
export const INJECTION_PATTERN_COUNT = INJECTION_PATTERNS.length;
