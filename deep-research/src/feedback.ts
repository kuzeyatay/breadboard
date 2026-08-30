import { z } from 'zod';

import { generateStructuredObject } from './ai/structured-output';
import { systemPrompt } from './prompt';

export async function generateFeedback({
  query,
  numQuestions = 3,
}: {
  query: string;
  numQuestions?: number;
}) {
  const userFeedback = await generateStructuredObject({
    system: systemPrompt(),
    prompt: `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
    schema: z.object({
      questions: z
        .array(z.string())
        .describe(
          `Follow up questions to clarify the research direction, max of ${numQuestions}`,
        ),
    }),
    schemaName: 'research_follow_up_questions',
    schemaDescription:
      'Questions that clarify the requested research direction.',
  });

  return userFeedback.questions.slice(0, numQuestions);
}
