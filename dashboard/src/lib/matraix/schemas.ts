// The one structure a language model produces in a MatrAIx run: the study.
//
// Nothing the model returns reaches the bridge until it has passed through
// here. The constraints are not decoration — the clone's `SurveyQuestion`
// constructor raises on a choice question with no options and on a likert scale
// whose minimum is not below its maximum, and a raise inside the bridge is a
// study that never starts. Catching those here turns a failed run into a
// repair request the model can answer.

import { z } from "zod";

export type SchemaResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: string[] };

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): SchemaResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: `${label} did not match its schema.`,
    issues: result.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/** The four question types the clone's survey schema accepts. */
export const MATRAIX_QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "likert",
  "free_text",
] as const;

const optionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,48}$/, "choice ids are lowercase words joined by underscores"),
  label: z.string().trim().min(1).max(240),
});

const questionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,32}$/, "question ids are lowercase words joined by underscores"),
    prompt: z.string().trim().min(3).max(400),
    type: z.enum(MATRAIX_QUESTION_TYPES),
    construct: z.string().trim().max(64).default(""),
    required: z.boolean().default(true),
    options: z.array(optionSchema).max(8).default([]),
    minValue: z.number().int().min(0).max(10).nullable().default(null),
    maxValue: z.number().int().min(1).max(10).nullable().default(null),
  })
  .superRefine((question, context) => {
    if (question.type === "single_choice" || question.type === "multi_choice") {
      if (question.options.length < 2) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "choice questions need at least two options",
          path: ["options"],
        });
      }
      const ids = new Set(question.options.map((option) => option.id));
      if (ids.size !== question.options.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "choice ids must be unique within a question",
          path: ["options"],
        });
      }
    }
    if (question.type === "likert") {
      const min = question.minValue ?? 1;
      const max = question.maxValue ?? 5;
      if (min >= max) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a likert scale needs minValue below maxValue",
          path: ["minValue"],
        });
      }
    }
  });

export const studyDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    /**
     * What respondents are told before they answer. This becomes the
     * instrument's `description`, which is what the clone's prompt builder
     * renders as the Context section — so a study with a vague description is a
     * study whose personas are guessing.
     */
    context: z.string().trim().min(20).max(4_000),
    askRationale: z.boolean().default(true),
    questions: z.array(questionSchema).min(1).max(14),
    /** Dimension filters, as `dimension -> accepted values`. */
    filters: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)).default({}),
    stratify: z.array(z.string().trim().min(1)).max(3).default([]),
    groupBy: z.array(z.string().trim().min(1)).max(3).default([]),
    /** One sentence on who this cohort is and why, shown on the run card. */
    cohortRationale: z.string().trim().max(400).default(""),
  })
  .superRefine((study, context) => {
    const ids = new Set(study.questions.map((question) => question.id));
    if (ids.size !== study.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "question ids must be unique",
        path: ["questions"],
      });
    }
  });

export type StudyDraft = z.infer<typeof studyDraftSchema>;
export type StudyQuestion = StudyDraft["questions"][number];
