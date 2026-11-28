// Reader-clarity revision for garden chat answers.
//
// After the model finishes an answer, a cheap text check (no model call, well
// under a millisecond) looks for the shapes that made Bread's garden answers
// hard to follow: bold everywhere, paragraphs broken into fragments, list
// stacks for things that are one argument, and stacks of "this is not ..."
// sentences. Only when the check fires is the answer sent back, once, to the
// same model that wrote it, with instructions to fill the gaps a newcomer would
// hit (READER_CLARITY_INSTRUCTION). The original answer is kept whenever the
// revision fails, times out, or looks unsafe (lost links or equations, much
// shorter or much longer), so this step can only ever replace an answer with a
// checked revision of itself.
//
// The thresholds come from the textbooks in the user's own gardens (Feynman,
// Sedra/Smith, Hayt, Adams, DSP First, Gerstner): a rule fires only where at
// most ~10% of textbook prose would.
import { DEFAULT_MODEL } from "../ai-models.ts";
import { localChatmockBaseUrl, normalizeChatmockBaseUrl } from "../chatmock-server.ts";
import { systemPromptText } from "../system-prompts/service.ts";

export const READER_CLARITY_PROMPT_ID = "reader-clarity-revision";
const DEFAULT_TIMEOUT_MS = 90_000;
const MIN_WORDS = 120;
const THRESHOLDS = { boldMax: 2, paragraphWordsMin: 42, listPercentMax: 20, negationsPer1kMax: 8.4, headingsWordsBelow: 600 };

export interface ReaderClarityLint {
  words: number;
  bold: number;
  headings: number;
  paragraphWords: number;
  paragraphs: number;
  listPercent: number;
  negationsPer1k: number;
}

export interface ReaderClarityResult {
  text: string;
  revised: boolean;
  findings: string[];
  reason?: string;
  gaps?: string[];
  durationMs?: number;
  model?: string;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function stripMath(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, " MATH. ")
    .replace(/\\\[[\s\S]*?\\\]/g, " MATH. ")
    .replace(/\$[^$\n]+\$/g, " X ")
    .replace(/\\\([\s\S]*?\\\)/g, " X ");
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z']+/g) ?? []).length;
}

export function lintReaderClarity(answer: string): ReaderClarityLint {
  const text = stripMath(answer);
  const lines = text.split("\n");
  const listLines = lines.filter((line) => /^\s*([-*•]|\d+[.)])\s/.test(line) || line.trim().startsWith("|"));
  const headings = lines.filter((line) => /^\s*#{1,6}\s/.test(line)).length;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    // A bullet is "- " / "* " / "• " / "1. " followed by a space; a paragraph
    // that opens with a **bold label** is still a paragraph.
    .filter((block) => block && !/^([-*•]\s|\d+[.)]\s|[#|>]|MATH\.?\s*$)/.test(block) && block.split(/\s+/).length >= 4);
  const words = Math.max(wordCount(text), 1);
  const listWords = listLines.reduce((sum, line) => sum + wordCount(line), 0);
  const negations = (text.match(/\b(not|n't|never|no|neither|nor)\b/gi) ?? []).length;
  return {
    words,
    bold: (answer.match(/\*\*[^*\n]+\*\*/g) ?? []).length,
    headings,
    paragraphWords: paragraphs.length ? paragraphs.reduce((sum, block) => sum + block.split(/\s+/).length, 0) / paragraphs.length : 0,
    paragraphs: paragraphs.length,
    listPercent: (100 * listWords) / words,
    negationsPer1k: (1000 * negations) / words,
  };
}

const LIST_REQUEST = /\b(table|list|bullet|bullets|steps|step-by-step|outline|enumerate|checklist|compare|comparison)\b/i;

/** Which reader-clarity rules this answer breaks. Empty means "leave it alone". */
export function readerClarityFindings(answer: string, question = ""): string[] {
  // Fenced blocks carry code, widgets and image results that a prose rewrite
  // must not touch; those answers are left exactly as written.
  if (answer.includes("```")) return [];
  const lint = lintReaderClarity(answer);
  if (lint.words < MIN_WORDS) return [];
  const askedForStructure = LIST_REQUEST.test(question);
  const findings: string[] = [];
  if (lint.bold > THRESHOLDS.boldMax) findings.push("bold");
  if (lint.paragraphs >= 2 && lint.paragraphWords < THRESHOLDS.paragraphWordsMin) findings.push("fragmented_paragraphs");
  if (!askedForStructure && lint.listPercent > THRESHOLDS.listPercentMax) findings.push("list_heavy");
  if (lint.negationsPer1k > THRESHOLDS.negationsPer1kMax) findings.push("negation");
  if (!askedForStructure && lint.headings > 0 && lint.words < THRESHOLDS.headingsWordsBelow) findings.push("headings_on_short_answer");
  return findings;
}

function tag(text: string, name: string): string | null {
  const closed = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (closed) return closed[1].trim();
  const open = text.match(new RegExp(`<${name}>([\\s\\S]*)`));
  return open ? open[1].trim() : null;
}

function linkTargets(text: string): string[] {
  const targets = new Set<string>();
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) targets.add(match[1]);
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) targets.add(match[0]);
  return [...targets];
}

function displayMathCount(text: string): number {
  return (text.match(/\$\$[\s\S]*?\$\$/g) ?? []).length + (text.match(/\\\[[\s\S]*?\\\]/g) ?? []).length;
}

/** Why a revision must not replace the original, or null when it is safe to use. */
export function unsafeRevisionReason(original: string, revision: string): string | null {
  const before = wordCount(stripMath(original));
  const after = wordCount(stripMath(revision));
  if (!revision.trim()) return "empty";
  if (after < before * 0.5) return "too_short";
  if (after > before * 2.5) return "too_long";
  const lost = linkTargets(original).filter((target) => !revision.includes(target));
  if (lost.length) return "lost_links";
  if (displayMathCount(revision) < displayMathCount(original)) return "lost_equations";
  return null;
}

interface MessageReader {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/** The user's message for this turn plus the few turns before it, oldest first. */
export function readerClarityTurn(conversationId: number, database: MessageReader): { question: string; context: Array<{ role: string; content: string }> } {
  const rows = (database.prepare(`
    SELECT role, content FROM conversation_messages
    WHERE conversation_id = ? AND status = 'complete' AND length(content) > 0
    ORDER BY order_index DESC LIMIT 7
  `).all(conversationId) as Array<{ role: string; content: string }>).reverse();
  const lastUser = rows.map((row) => row.role).lastIndexOf("user");
  if (lastUser < 0) return { question: "", context: rows };
  return { question: rows[lastUser].content, context: rows.slice(0, lastUser) };
}

export function readerClarityEnabled(): boolean {
  return process.env.BREADBOARD_READER_CLARITY !== "0";
}

export async function reviseForReader(input: {
  answer: string;
  question: string;
  context?: Array<{ role: string; content: string }>;
  model?: string | null;
  userId?: number | null;
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): Promise<ReaderClarityResult> {
  const findings = readerClarityFindings(input.answer, input.question);
  if (!findings.length) return { text: input.answer, revised: false, findings, reason: "passed_check" };
  if (!readerClarityEnabled()) return { text: input.answer, revised: false, findings, reason: "disabled" };
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  timeout.unref?.();
  const conversation = [
    ...(input.context ?? []).map((turn) => `[${turn.role}] ${turn.content.slice(0, 1500)}`),
    `[user] ${input.question.slice(0, 4000)}`,
  ].join("\n\n");
  try {
    const base = normalizeChatmockBaseUrl(input.baseUrl ?? localChatmockBaseUrl()) ?? localChatmockBaseUrl();
    const response = await (input.fetcher ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}` },
      body: JSON.stringify({
        // The same model that wrote the answer revises it, so whichever model
        // the user picked stays the one speaking.
        model: input.model || DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPromptText(READER_CLARITY_PROMPT_ID, input.userId ?? undefined) },
          {
            role: "user",
            content: `CONVERSATION SO FAR\n${conversation}\n\nDRAFT ANSWER TO THE LAST USER MESSAGE\n${input.answer}\n\nLINT FINDINGS: ${findings.join(", ")}`,
          },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { text: input.answer, revised: false, findings, reason: `http_${response.status}`, durationMs: Date.now() - started };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }>; model?: string };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const revision = tag(raw, "answer") ?? "";
    const unsafe = unsafeRevisionReason(input.answer, revision);
    if (unsafe) return { text: input.answer, revised: false, findings, reason: unsafe, durationMs: Date.now() - started };
    const gaps = (tag(raw, "gaps") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    return { text: revision, revised: true, findings, gaps, durationMs: Date.now() - started, model: payload.model ?? input.model ?? undefined };
  } catch (error) {
    const reason = controller.signal.aborted ? "timeout" : "error";
    void error;
    return { text: input.answer, revised: false, findings, reason, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}
