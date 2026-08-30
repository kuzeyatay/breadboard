import {
  generateObject,
  NoObjectGeneratedError,
  type GenerateObjectResult,
  type LanguageModelUsage,
} from 'ai';
import { z } from 'zod';

import { getModel, objectGenerationMode } from './providers';

export type StructuredOutputMode = 'auto' | 'json' | 'tool';

type StructuredAttemptResult<T> = Pick<
  GenerateObjectResult<T>,
  'object' | 'usage'
>;

/**
 * Run structured generation with a compatibility fallback for gateways that
 * occasionally answer a forced tool call with ordinary text.
 *
 * ChatMock normally supports tool mode, but a model can still omit the tool
 * call. AI SDK reports that as NoObjectGeneratedError. Retrying in JSON mode
 * keeps the schema instruction while allowing the model to return JSON text.
 */
export async function runStructuredOutputAttempts<T>({
  initialMode,
  attempt,
  onUsage,
}: {
  initialMode: StructuredOutputMode;
  attempt: (mode: StructuredOutputMode) => Promise<StructuredAttemptResult<T>>;
  onUsage?: (usage: LanguageModelUsage) => void;
}): Promise<T> {
  try {
    const result = await attempt(initialMode);
    onUsage?.(result.usage);
    return result.object;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.usage) {
      onUsage?.(error.usage);
    }
    if (initialMode !== 'tool' || !NoObjectGeneratedError.isInstance(error)) {
      throw error;
    }
  }

  try {
    const fallback = await attempt('json');
    onUsage?.(fallback.usage);
    return fallback.object;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.usage) {
      onUsage?.(error.usage);
    }
    throw error;
  }
}

export async function generateStructuredObject<T>({
  system,
  prompt,
  schema,
  schemaName,
  schemaDescription,
  abortSignal,
  onUsage,
}: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription: string;
  abortSignal?: AbortSignal;
  onUsage?: (usage: LanguageModelUsage) => void;
}): Promise<T> {
  return runStructuredOutputAttempts({
    initialMode: objectGenerationMode(),
    onUsage,
    attempt: mode =>
      generateObject({
        model: getModel(),
        mode,
        abortSignal,
        system,
        prompt,
        schema,
        schemaName,
        schemaDescription,
      }),
  });
}
