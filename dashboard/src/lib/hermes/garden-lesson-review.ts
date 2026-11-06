import { readGardenPage } from "./garden-reader.ts";
import { getHermesUserSettings } from "./runtime-store.ts";
import { createChatmockClient } from "../chatmock-client.ts";
import { withCouncil } from "../council.ts";
import { reviewAndHealLesson, type TeachingLessonInput } from "../learn-teaching-healing.ts";
import { noteDepthError } from "./note-depth.ts";

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`lesson.${name} must be an array of nonempty strings (use [] when empty).`);
  return value.map((item) => item.trim());
}

export async function reviewGardenLesson(input: {
  userId: number; gardenId: string; contentPath: string; title: string;
  markdown: string; lesson: unknown; minimumProseWords: unknown;
}) {
  if (!input.lesson || typeof input.lesson !== "object" || Array.isArray(input.lesson)) {
    throw new Error("A full lesson requires lesson context: learningQuestion, newConcepts, assumedBackground, taughtLater, previousLessonSlugs, and sourcePassages. Supply those fields so the teaching review can repair missing explanations before saving.");
  }
  const raw = input.lesson as Record<string, unknown>;
  if (typeof raw.learningQuestion !== "string" || !raw.learningQuestion.trim()) throw new Error("lesson.learningQuestion is required.");
  const previousLessonSlugs = stringList(raw.previousLessonSlugs, "previousLessonSlugs");
  if (previousLessonSlugs.length > 8) throw new Error("Supply at most eight relevant earlier lessons, including the immediately preceding lesson.");
  const lesson: TeachingLessonInput = {
    title: input.title, learningQuestion: raw.learningQuestion,
    newConcepts: stringList(raw.newConcepts, "newConcepts"),
    assumedBackground: stringList(raw.assumedBackground, "assumedBackground"),
    taughtLater: stringList(raw.taughtLater, "taughtLater"),
    earlierLessons: [], sources: [],
    ...(typeof raw.learnerRequest === "string" ? { learnerRequest: raw.learnerRequest } : {}),
  };
  const earlier = [];
  for (const slug of previousLessonSlugs) {
    const { node } = await readGardenPage(input.contentPath, input.gardenId, slug);
    if (!node) throw new Error(`Earlier lesson ${slug} was not found. A title or planned lesson is not evidence of prior teaching.`);
    earlier.push({ pageId: node.relPath, title: node.title, concepts: [], markdown: node.content });
  }
  lesson.earlierLessons = earlier;
  if (!Array.isArray(raw.sourcePassages) || raw.sourcePassages.length === 0 || raw.sourcePassages.length > 12) throw new Error("Supply 1–12 lesson.sourcePassages with pageSlug and optional character offset/limit for the evidence this lesson teaches.");
  const sources = [];
  for (const passage of raw.sourcePassages) {
    if (!passage || typeof passage.pageSlug !== "string") throw new Error("Every source passage needs a pageSlug.");
    const offset = passage.offset ?? 0;
    const limit = passage.limit ?? 24000;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24000) throw new Error("Source passage offsets must be nonnegative integers and limits 1–24000 characters.");
    const { node } = await readGardenPage(input.contentPath, input.gardenId, passage.pageSlug);
    if (!node || offset >= node.content.length) throw new Error(`Source passage ${passage.pageSlug} is unavailable at that offset.`);
    sources.push({ pageId: `${node.relPath}:${offset}`, text: node.content.slice(offset, offset + limit) });
  }
  lesson.sources = sources;
  if (JSON.stringify(lesson).length > 180000) throw new Error("The lesson evidence exceeds 180000 characters. Select the relevant earlier lessons and precise source passages; nothing was saved.");
  const settings = getHermesUserSettings(input.userId);
  const client = createChatmockClient(undefined, { timeout: 180000, maxRetries: 0 });
  return reviewAndHealLesson({ markdown: input.markdown, lesson,
    validate: (markdown) => {
      const error = noteDepthError(markdown, input.minimumProseWords);
      const problems = error ? [{ code: "lesson-depth", message: error, hard: true }] : [];
      if (markdown.length > 100000) problems.push({ code: "lesson-size", message: "The lesson exceeds the 100000-character note limit.", hard: true });
      const repairedImages = new Set([...markdown.matchAll(/!\[[^\]]*\]\(([^\n)]+)\)/g)].map(match => match[1]));
      for (const embed of input.markdown.matchAll(/!\[[^\]]*\]\(([^\n)]+)\)/g)) {
        // Improving alt text preserves the figure. Compare its target rather
        // than forcing a repair to restore an obsolete description.
        if (!repairedImages.has(embed[1])) problems.push({ code: "missing-source-figure", message: `Restore this assigned image beside its explanation: ${embed[0]}`, hard: true });
      }
      return problems;
    },
    request: async (request) => {
      const response = await client.chat.completions.create(withCouncil({
        model: settings.fallbackModel,
        // These bounded internal editorial passes use the chosen model, with
        // moderate reasoning so a chat's maximum-effort setting cannot turn
        // each of seven possible review/repair calls into a long research run.
        reasoning_effort: "medium" as const,
        messages: [{ role: "system" as const, content: request.system }, { role: "user" as const, content: request.user }],
        stream: false as const,
      }, { gardenId: input.gardenId, taskType: request.kind === "review" ? "critique" : "subsection_repair",
        councilModeOverride: "direct_council", sourceContext: { taskType: "garden_lesson_teaching", stage: request.kind, round: request.round } }));
      const choice = response.choices[0];
      if (choice?.finish_reason && choice.finish_reason !== "stop") throw new Error("Lesson teaching review was interrupted; nothing was saved.");
      const text = choice?.message?.content;
      if (!text?.trim()) throw new Error("Lesson teaching review returned no text; nothing was saved.");
      return text;
    },
  });
}
