// Meetily's meeting-notes pass, ported.
//
// The clone's supported runtime is a Tauri desktop app: a person clicks Record,
// Rust captures the audio, and whisper-rs transcribes it in-process. There is no
// headless entry point, so there is nothing for Breadboard to wrap — it fails
// the liveness test in `docs/ADDING_AN_AGENT.md` on all three counts. Its
// Python/FastAPI backend, which did have one, is declared archived and
// unsupported by upstream and carries its own SQLite of meetings that would
// duplicate everything Breadboard already stores.
//
// What is genuinely meetily's, and worth having, is what this module is: the
// shape it reduces a meeting to (who was there, what was decided, what is due,
// what happens next), the chunk-with-overlap walk that lets a two-hour
// transcript through a context window, the schema it holds the model to, and the
// aggregation that folds the per-chunk answers back into one document. All of
// that is ported from `backend/app/transcript_processor.py` and the
// `process_transcript_background` aggregator in `backend/app/main.py`, and the
// prompt below is the clone's own wording rather than a paraphrase.
//
// The model layer is ChatMock, like everywhere else. The clone reached for
// Anthropic, Groq, OpenAI or Ollama directly; none of that survives the port.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";

const MODEL_TIMEOUT_MS = 180_000;

/**
 * The clone's defaults for a cloud-sized context, from `TranscriptRequest`:
 * 5000 characters a chunk, overlapping by 1000. The overlap is what stops a
 * decision that straddles a boundary from being lost by both chunks.
 */
export const DEFAULT_CHUNK_SIZE = 5_000;
export const DEFAULT_CHUNK_OVERLAP = 1_000;

/** `result_retries=2` on the clone's pydantic-ai agent. */
const SCHEMA_RETRIES = 2;

// ---------------------------------------------------------------------------
// The schema — `SummaryResponse` in transcript_processor.py
// ---------------------------------------------------------------------------

/**
 * Block types are constrained to what the clone's own renderer draws. The
 * comment on the Python class is emphatic about it ("must align with frontend
 * rendering capabilities"), and it is the reason the prompt repeats the list.
 */
export const BLOCK_TYPES = ["text", "bullet", "heading1", "heading2"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  /** 'gray' for less important content, '' for default. The clone's whole palette. */
  color: string;
}

export interface Section {
  title: string;
  blocks: Block[];
}

export interface MeetingNotesDocument {
  meetingName: string;
  sections: Section[];
}

/** One chunk's answer. Keys are the clone's, spelled the clone's way. */
export interface ChunkSummary {
  MeetingName: string;
  People: Section;
  SessionSummary: Section;
  CriticalDeadlines: Section;
  KeyItemsDecisions: Section;
  ImmediateActionItems: Section;
  NextSteps: Section;
  MeetingNotes: MeetingNotesDocument;
}

/**
 * The six sections, in the order the clone declares them, each with the title
 * its aggregator seeds. The titles are fixed here rather than taken from the
 * model so a chunk that renames a section cannot fragment the final document.
 */
export const MEETING_SECTIONS = [
  { key: "People", title: "People" },
  { key: "SessionSummary", title: "Session Summary" },
  { key: "CriticalDeadlines", title: "Critical Deadlines" },
  { key: "KeyItemsDecisions", title: "Key Items & Decisions" },
  { key: "ImmediateActionItems", title: "Immediate Action Items" },
  { key: "NextSteps", title: "Next Steps" },
] as const;

export type MeetingSectionKey = (typeof MEETING_SECTIONS)[number]["key"];

export interface MeetingSummary {
  meetingName: string;
  sections: Section[];
  notes: MeetingNotesDocument;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class SchemaError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blockType(value: unknown): BlockType {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (BLOCK_TYPES as readonly string[]).includes(candidate)
    ? (candidate as BlockType)
    : // The clone drops a chunk whose block type is wrong. A note is worth more
      // than the distinction between a paragraph and a bullet, so an unknown
      // type becomes the neutral one instead of costing the whole chunk.
      "text";
}

function parseBlocks(value: unknown, prefix: string): Block[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) return [];
    const color = typeof entry.color === "string" ? entry.color.trim().toLowerCase() : "";
    return [
      {
        id: `${prefix}_${index + 1}`,
        type: blockType(entry.type),
        content: content.slice(0, 4_000),
        color: color === "gray" ? "gray" : "",
      },
    ];
  });
}

function parseSection(value: unknown, fallbackTitle: string, prefix: string): Section {
  if (!isRecord(value)) return { title: fallbackTitle, blocks: [] };
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : fallbackTitle;
  return { title: title.slice(0, 200), blocks: parseBlocks(value.blocks, prefix) };
}

/**
 * Hold the model to the schema, and say precisely what is wrong when it misses.
 *
 * The message matters: it is fed back on the retry, which is how pydantic-ai's
 * `result_retries` actually repairs an answer rather than just rolling the dice
 * again.
 */
export function parseChunkSummary(value: unknown, chunkIndex: number): ChunkSummary {
  if (!isRecord(value)) {
    throw new SchemaError("The answer was not a JSON object.");
  }
  const missing = MEETING_SECTIONS.filter((section) => !isRecord(value[section.key])).map(
    (section) => section.key,
  );
  // Every section is required by the clone's model, even when empty — that is
  // what "return an empty list for its blocks" in the prompt is asking for.
  if (missing.length === MEETING_SECTIONS.length) {
    throw new SchemaError(
      `None of the required sections were present. Every one of ${MEETING_SECTIONS.map(
        (section) => section.key,
      ).join(", ")} must appear, each as an object with a "title" and a "blocks" array.`,
    );
  }

  const prefix = `c${chunkIndex + 1}`;
  const sections = Object.fromEntries(
    MEETING_SECTIONS.map((section) => [
      section.key,
      parseSection(value[section.key], section.title, `${prefix}_${section.key}`),
    ]),
  ) as Record<MeetingSectionKey, Section>;

  const rawNotes = isRecord(value.MeetingNotes) ? value.MeetingNotes : {};
  const notesSections = Array.isArray(rawNotes.sections) ? rawNotes.sections : [];
  const meetingName =
    typeof value.MeetingName === "string" ? value.MeetingName.trim().slice(0, 200) : "";

  return {
    MeetingName: meetingName,
    ...sections,
    MeetingNotes: {
      meetingName:
        typeof rawNotes.meeting_name === "string"
          ? rawNotes.meeting_name.trim().slice(0, 200)
          : meetingName,
      sections: notesSections.flatMap((entry, index) => {
        if (!isRecord(entry)) return [];
        const section = parseSection(entry, "Notes", `${prefix}_notes${index + 1}`);
        return section.blocks.length ? [section] : [];
      }),
    },
  } as ChunkSummary;
}

// ---------------------------------------------------------------------------
// Chunking — transcript_processor.process_transcript
// ---------------------------------------------------------------------------

/**
 * Slide a window of `chunkSize` along the transcript, stepping by
 * `chunkSize - overlap`. Ported including its guard: an overlap at or beyond the
 * chunk size would step by zero and loop forever, so the clone shrinks the
 * overlap rather than failing.
 */
export function chunkTranscript(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const size = Math.max(500, Math.trunc(chunkSize));
  let step = size - Math.max(0, Math.trunc(overlap));
  if (step <= 0) step = Math.max(100, size - 100);
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += step) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : [text];
}

// ---------------------------------------------------------------------------
// Aggregation — process_transcript_background in main.py
// ---------------------------------------------------------------------------

function blockKey(block: Block): string {
  return `${block.type}:${block.content.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/**
 * Fold every chunk's answer into one document.
 *
 * The clone's rules, kept: the last chunk that names the meeting wins; each
 * section's blocks are concatenated across chunks in order; and every section is
 * mirrored into `MeetingNotes.sections`, merging into a section of the same
 * title when one is already there.
 *
 * The one deliberate departure is the deduplication. Chunks overlap by design,
 * so the same decision genuinely is described twice, and the clone's plain
 * `extend` puts it in the notes twice. Dropping a block whose type and text
 * already appeared in the same section removes exactly those repeats and nothing
 * else — a second, differently worded action item survives.
 */
export function aggregateChunkSummaries(summaries: ChunkSummary[]): MeetingSummary {
  const sections = new Map<MeetingSectionKey, Section>(
    MEETING_SECTIONS.map((section) => [section.key, { title: section.title, blocks: [] }]),
  );
  const notes: MeetingNotesDocument = { meetingName: "", sections: [] };
  const seen = new Map<string, Set<string>>();
  let meetingName = "";

  const appendUnique = (target: Section, blocks: Block[]): Block[] => {
    const keys = seen.get(target.title) ?? new Set<string>();
    seen.set(target.title, keys);
    const added: Block[] = [];
    for (const block of blocks) {
      const key = blockKey(block);
      if (keys.has(key)) continue;
      keys.add(key);
      target.blocks.push(block);
      added.push(block);
    }
    return added;
  };

  for (const summary of summaries) {
    if (summary.MeetingName) meetingName = summary.MeetingName;
    if (summary.MeetingNotes.meetingName) notes.meetingName = summary.MeetingNotes.meetingName;

    for (const { key } of MEETING_SECTIONS) {
      const target = sections.get(key);
      const incoming = summary[key];
      if (!target || !incoming?.blocks.length) continue;
      const added = appendUnique(target, incoming.blocks);
      if (!added.length) continue;

      // The mirror into MeetingNotes, exactly as the aggregator does it: extend
      // a section already carrying this title, otherwise append a new one.
      const existing = notes.sections.find((section) => section.title === target.title);
      if (existing) existing.blocks.push(...added);
      else notes.sections.push({ title: target.title, blocks: [...added] });
    }

    // Sections the model wrote into MeetingNotes itself, which are its own and
    // have no counterpart among the six.
    for (const section of summary.MeetingNotes.sections) {
      const existing = notes.sections.find((entry) => entry.title === section.title);
      if (existing) appendUnique(existing, section.blocks);
      else {
        const created: Section = { title: section.title, blocks: [] };
        appendUnique(created, section.blocks);
        if (created.blocks.length) notes.sections.push(created);
      }
    }
  }

  if (!notes.meetingName) notes.meetingName = meetingName;
  return {
    meetingName,
    sections: MEETING_SECTIONS.map(({ key }) => sections.get(key)).filter(
      (section): section is Section => Boolean(section),
    ),
    notes,
  };
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function complete(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<{ content: string; usage: ModelUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  const relay = () => controller.abort();
  input.signal?.addEventListener("abort", relay, { once: true });
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        reasoning_effort: input.reasoningEffort,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ChatMock returned ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", relay);
  }
}

/**
 * Pull the JSON out of a reply. ChatMock inlines its reasoning summary as a
 * `<think>` block and models like to wrap JSON in a fence, so neither is
 * treated as a failure.
 */
export function extractJson(content: string): unknown {
  const withoutThinking = content
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(withoutThinking);
  const candidates = [fenced?.[1], withoutThinking].filter(
    (value): value is string => typeof value === "string",
  );
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The clone's system prompt, kept as the clone words it. The JSON shape is
 * spelled out here because pydantic-ai used to supply it as a tool schema, and
 * that scaffolding is what the port replaces.
 */
const NOTES_SYSTEM = `You extract structured meeting notes from a transcript.

Answer with JSON only — no prose, no explanation, no code fence. The object must have exactly these keys:

{
  "MeetingName": "a short name for this meeting",
  "People": {"title": "People", "blocks": []},
  "SessionSummary": {"title": "Session Summary", "blocks": []},
  "CriticalDeadlines": {"title": "Critical Deadlines", "blocks": []},
  "KeyItemsDecisions": {"title": "Key Items & Decisions", "blocks": []},
  "ImmediateActionItems": {"title": "Immediate Action Items", "blocks": []},
  "NextSteps": {"title": "Next Steps", "blocks": []},
  "MeetingNotes": {"meeting_name": "...", "sections": []}
}

A block is {"id": "1", "type": "text", "content": "...", "color": ""}.

IMPORTANT: Block types must be one of: 'text', 'bullet', 'heading1', 'heading2'
- Use 'text' for regular paragraphs
- Use 'bullet' for list items
- Use 'heading1' for major headings
- Use 'heading2' for subheadings

For the color field, use 'gray' for less important content or '' (empty string) for default.

People is always present: one block per participant, written as "Person Name (Role, Details)".

If a specific section (like Critical Deadlines) has no relevant information in this chunk, return an empty list for its 'blocks'. Never invent a deadline, an owner, or a decision that is not in the transcript.`;

function chunkInstruction(input: {
  chunk: string;
  customPrompt: string;
  index: number;
  total: number;
}): string {
  // Wording carried over from the clone's per-chunk user message, including the
  // spelling-correction licence — a Whisper transcript really does get names
  // wrong, and the surrounding context really is what fixes them.
  return `Given the following meeting transcript chunk, extract the relevant information according to the required JSON structure. If a specific section (like Critical Deadlines) has no relevant information in this chunk, return an empty list for its 'blocks'. Ensure the output is only the JSON data.

This is chunk ${input.index + 1} of ${input.total}.

Transcript Chunk:
---
${input.chunk}
---

Please capture all relevant action items. Transcription can have spelling mistakes. correct it if required. context is important.

While generating the summary, please add the following context:
---
${input.customPrompt || "Generate a summary of the meeting transcript."}
---
Make sure the output is only the JSON data.`;
}

export interface ChunkProgress {
  onChunkStart?: (index: number, total: number) => void;
  onChunkDone?: (index: number, total: number) => void;
  onRetry?: (index: number, attempt: number, reason: string) => void;
}

export interface SummarizeInput {
  transcript: string;
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  customPrompt: string;
  chunkSize?: number;
  overlap?: number;
  signal?: AbortSignal;
  progress?: ChunkProgress;
}

export interface SummarizeResult {
  summary: MeetingSummary;
  usage: ModelUsage & { calls: number };
  chunks: number;
  /** Chunks whose answer could not be repaired into the schema. */
  failedChunks: number;
}

/**
 * Walk the transcript and produce one document.
 *
 * A chunk that cannot be made to answer in schema after its retries is skipped
 * rather than failing the run — the clone does the same, and on a long meeting
 * one unparseable window is a hole in the notes, not a reason to have none. How
 * many were skipped is returned so the run can say so out loud.
 */
export async function summarizeMeeting(input: SummarizeInput): Promise<SummarizeResult> {
  const chunks = chunkTranscript(
    input.transcript,
    input.chunkSize ?? DEFAULT_CHUNK_SIZE,
    input.overlap ?? DEFAULT_CHUNK_OVERLAP,
  );
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const summaries: ChunkSummary[] = [];
  let failedChunks = 0;

  for (const [index, chunk] of chunks.entries()) {
    if (input.signal?.aborted) throw new Error("The meeting notes run was stopped.");
    input.progress?.onChunkStart?.(index, chunks.length);

    const messages: ChatMessage[] = [
      { role: "system", content: NOTES_SYSTEM },
      {
        role: "user",
        content: chunkInstruction({
          chunk,
          customPrompt: input.customPrompt,
          index,
          total: chunks.length,
        }),
      },
    ];

    let parsed: ChunkSummary | null = null;
    for (let attempt = 0; attempt <= SCHEMA_RETRIES; attempt += 1) {
      if (input.signal?.aborted) throw new Error("The meeting notes run was stopped.");
      let reason = "";
      try {
        const { content, usage: callUsage } = await complete({
          baseUrl: input.baseUrl,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          messages,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        usage.inputTokens += callUsage.inputTokens;
        usage.outputTokens += callUsage.outputTokens;
        usage.calls += 1;
        const json = extractJson(content);
        if (json === null) throw new SchemaError("No JSON object was found in the answer.");
        parsed = parseChunkSummary(json, index);
        break;
      } catch (error) {
        if (input.signal?.aborted) throw error;
        reason = error instanceof Error ? error.message : "The answer could not be read.";
        // A transport failure is not a schema failure: retrying it with a
        // correction message would teach the model nothing.
        if (!(error instanceof SchemaError)) {
          if (attempt >= SCHEMA_RETRIES) break;
        } else if (attempt < SCHEMA_RETRIES) {
          messages.push(
            { role: "assistant", content: "(unusable answer)" },
            {
              role: "user",
              content: `That answer did not match the required structure: ${reason}\n\nAnswer again with the JSON object only, with every required key present.`,
            },
          );
        }
        input.progress?.onRetry?.(index, attempt + 1, reason);
      }
    }

    if (parsed) summaries.push(parsed);
    else failedChunks += 1;
    input.progress?.onChunkDone?.(index, chunks.length);
  }

  return {
    summary: aggregateChunkSummaries(summaries),
    usage,
    chunks: chunks.length,
    failedChunks,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBlock(block: Block): string {
  if (block.type === "heading1") return `## ${block.content}`;
  if (block.type === "heading2") return `### ${block.content}`;
  if (block.type === "bullet") return `- ${block.content}`;
  return block.content;
}

/** The notes as a markdown document — what the artifact holds, and what is read. */
export function renderMeetingNotesMarkdown(summary: MeetingSummary): string {
  const lines: string[] = [`# ${summary.meetingName || "Meeting notes"}`];
  for (const section of summary.sections) {
    if (!section.blocks.length) continue;
    lines.push("", `## ${section.title}`, "");
    for (const block of section.blocks) lines.push(renderBlock(block));
  }
  // Anything the model filed under its own heading rather than one of the six.
  const extra = summary.notes.sections.filter(
    (section) => !summary.sections.some((known) => known.title === section.title),
  );
  for (const section of extra) {
    if (!section.blocks.length) continue;
    lines.push("", `## ${section.title}`, "");
    for (const block of section.blocks) lines.push(renderBlock(block));
  }
  return lines.join("\n").trim();
}

/** True when the pass produced nothing worth showing. */
export function isEmptySummary(summary: MeetingSummary): boolean {
  return (
    summary.sections.every((section) => !section.blocks.length) &&
    summary.notes.sections.every((section) => !section.blocks.length)
  );
}
