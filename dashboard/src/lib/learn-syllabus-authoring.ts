import { breadSystemPrompt } from "./assistant-identity.ts";

/**
 * Authoring a syllabus from a learner's prompt ("I want to learn everything
 * introductory about electronics").
 *
 * The output is a normal syllabus document that the existing Learn machinery
 * reads back with SYLLABUS_READING_PROMPT — nothing downstream knows or cares
 * that a model wrote it rather than a university.
 *
 * The one hard rule that shapes everything here: a generated syllabus must
 * assign NO external readings. The reading stage turns every citation into a
 * `referencedMaterial`, and any citation that does not match a document in the
 * garden becomes a `missingCitation` that the anti-hallucination gate uses to
 * *suppress* content. A syllabus invented alongside its own invented reading
 * list would therefore block the very lessons it asks for. So the model plans
 * scope — units, objectives, topics — and never points at a work.
 */

export interface GeneratedSyllabusUnit {
  label: string;
  title: string;
  objectives: string[];
  topics: string[];
}

export interface GeneratedSyllabus {
  courseTitle: string;
  overview: string;
  audience: string;
  units: GeneratedSyllabusUnit[];
}

/** Context about what the garden already holds, so the plan stays teachable. */
export interface SyllabusGardenContextDocument {
  title: string;
  description?: string;
}

export const SYLLABUS_PROMPT_MAX_CHARS = 4000;
const MAX_UNITS = 16;
const MAX_OBJECTIVES_PER_UNIT = 6;
const MAX_TOPICS_PER_UNIT = 10;
const MAX_TITLE_CHARS = 160;
const MAX_LINE_CHARS = 400;
const MAX_OVERVIEW_CHARS = 1200;
const MAX_CONTEXT_DOCUMENTS = 40;

const AUTHORING_SYSTEM_PROMPT = breadSystemPrompt(`You write a course syllabus from a learner's description of what they want to learn.

The syllabus is a planning document: it states what the course covers, in what order, and to what depth. Breadboard then writes the actual lessons from the learner's own uploaded material, using this syllabus as the plan.

Write the syllabus like a real course outline:
- courseTitle: the course's name, as a course would state it ("Introduction to Electronics"). No marketing language.
- overview: two to four sentences on what the course covers and where it ends up.
- audience: one sentence naming who it is for and what it assumes they already know.
- units: the course in teaching order. Each unit is one coherent stretch of the subject.
  - label: the unit's own numbering ("Unit 1", "Unit 2", ...).
  - title: what that unit teaches.
  - objectives: what the learner can do after the unit, each starting with a verb ("Calculate the equivalent resistance of series and parallel networks").
  - topics: the specific subjects the unit covers, as short noun phrases ("Ohm's law", "Kirchhoff's voltage law").

Scope rules:
- Follow the learner's stated level. "Introductory" means foundations and first principles, not a survey that reaches graduate material.
- Order units so each one only relies on what earlier units established.
- Size the course to the subject: a narrow request earns few units, a broad one earns more. Never pad to reach a count, and never split one idea across two units to look thorough.
- When a list of the learner's existing material is provided, plan the course so that material can actually teach it. Cover what the material supports, and leave out subject areas nothing on the list touches — an unteachable unit produces no lessons.

Never assign readings. Do not name a textbook, paper, author, chapter, page range, video, or any other work anywhere in the syllabus, and do not add a bibliography or reading list. The learner's uploaded documents are the readings; naming anything else makes the course cite works it does not have.

Respond with a single JSON object, no prose and no code fences:
{"courseTitle": "...", "overview": "...", "audience": "...", "units": [{"label": "Unit 1", "title": "...", "objectives": ["..."], "topics": ["..."]}]}`);

export function syllabusDraftMessages(
  intent: string,
  gardenDocuments: SyllabusGardenContextDocument[] = [],
): Array<{ role: "system" | "user"; content: string }> {
  const sections = [`The learner wants to learn:\n\n${intent.trim()}`];
  const listed = gardenDocuments
    .map((doc) => ({
      title: (doc.title ?? "").trim(),
      description: (doc.description ?? "").trim(),
    }))
    .filter((doc) => doc.title)
    .slice(0, MAX_CONTEXT_DOCUMENTS);
  if (listed.length > 0) {
    sections.push(
      `Material already in this garden, which is what the lessons will be written from:\n\n${listed
        .map(
          (doc) =>
            `- ${doc.title}${doc.description ? ` — ${doc.description.slice(0, 200)}` : ""}`,
        )
        .join("\n")}`,
    );
  } else {
    sections.push(
      "This garden has no uploaded material yet, so plan the course from the learner's request alone.",
    );
  }
  return [
    { role: "system", content: AUTHORING_SYSTEM_PROMPT },
    { role: "user", content: sections.join("\n\n") },
  ];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanLine(value: unknown, maxChars: number): string {
  return asString(value).replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function cleanLines(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of value) {
    const line = cleanLine(entry, MAX_LINE_CHARS);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

/**
 * Tolerant parse of the model's JSON. Returns null when the response cannot be
 * turned into a syllabus worth writing to the garden — a unit with neither an
 * objective nor a topic teaches nothing, so it is dropped rather than kept.
 */
export function parseGeneratedSyllabus(raw: string): GeneratedSyllabus | null {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const units: GeneratedSyllabusUnit[] = [];
  if (Array.isArray(record.units)) {
    for (const entry of record.units) {
      if (typeof entry !== "object" || entry === null) continue;
      const unit = entry as Record<string, unknown>;
      const title = cleanLine(unit.title, MAX_TITLE_CHARS);
      const objectives = cleanLines(unit.objectives, MAX_OBJECTIVES_PER_UNIT);
      const topics = cleanLines(unit.topics, MAX_TOPICS_PER_UNIT);
      if (!title || (objectives.length === 0 && topics.length === 0)) continue;
      units.push({
        label:
          cleanLine(unit.label, 40) || `Unit ${units.length + 1}`,
        title,
        objectives,
        topics,
      });
      if (units.length >= MAX_UNITS) break;
    }
  }
  if (units.length === 0) return null;

  return {
    courseTitle: cleanLine(record.courseTitle, MAX_TITLE_CHARS) || "Course syllabus",
    overview: cleanLine(record.overview, MAX_OVERVIEW_CHARS),
    audience: cleanLine(record.audience, MAX_LINE_CHARS),
    units,
  };
}

/**
 * Render the syllabus as the kind of markdown the reading stage already parses
 * out of uploaded study guides: a titled course, then one section per unit with
 * its objectives and topics under plain headings.
 */
export function renderSyllabusMarkdown(syllabus: GeneratedSyllabus): string {
  const lines: string[] = [`# ${syllabus.courseTitle}`, ""];
  if (syllabus.overview) lines.push(syllabus.overview, "");
  if (syllabus.audience) lines.push(`**Who this course is for:** ${syllabus.audience}`, "");
  lines.push("## Course outline", "");
  for (const unit of syllabus.units) {
    lines.push(`### ${unit.label} — ${unit.title}`, "");
    if (unit.objectives.length > 0) {
      lines.push("**Learning objectives**", "");
      for (const objective of unit.objectives) lines.push(`- ${objective}`);
      lines.push("");
    }
    if (unit.topics.length > 0) {
      lines.push("**Topics covered**", "");
      for (const topic of unit.topics) lines.push(`- ${topic}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
