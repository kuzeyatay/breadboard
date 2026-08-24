// Council routing metadata for ChatMock requests.
//
// ChatMock runs a council kernel behind its OpenAI-compatible API. These extra
// body fields tell it which kind of Breadboard task a request is, so it can
// pick the cheapest council mode that is still safe for that task
// (direct_council / lite_council / full_council / evolution_council).
// ChatMock strips the fields before anything is forwarded upstream, and
// requests without them keep working exactly as before.

import { breadSystemPrompt } from './assistant-identity.ts';

export type CouncilTaskType =
  | 'topic_map'
  | 'learning_spine'
  | 'subsection_generation'
  | 'section_generation'
  | 'source_synthesis'
  | 'source_map'
  | 'scope_contract'
  | 'exam_question_generation'
  | 'full_page_revision'
  | 'subsection_repair'
  | 'visualization_generation'
  | 'visual_necessity_review'
  | 'small_revision'
  | 'critique'
  | 'page_assistant_answer'
  | 'tagging'
  | 'classification'
  | 'metadata_generation'
  | 'concept_extraction'
  | 'ocr'
  | 'prompt_improvement'
  | 'template_improvement'
  | 'policy_improvement'
  | 'artifact_evolution';

export type CouncilMode =
  | 'direct_council'
  | 'lite_council'
  | 'full_council'
  | 'evolution_council';

export interface CouncilFields {
  taskType?: CouncilTaskType;
  gardenId?: string;
  pageId?: string;
  sourceContext?: unknown;
  councilModeOverride?: CouncilMode;
  includeCouncilDiagnostics?: boolean;
  /** Durable, promptless recovery binding for a single authoritative request. */
  clientRequestId?: string;
  clientRequestHash?: string;
}

/**
 * Attach council routing fields to an OpenAI request params object.
 * The extra fields ride along in the JSON body (ChatMock reads and strips
 * them); the return type stays `T` so SDK typing is unaffected.
 */
export function withCouncil<T extends object>(params: T, council: CouncilFields): T {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(council)) {
    if (value !== undefined && value !== null) extras[key] = value;
  }

  const identified = { ...params } as Record<string, unknown>;
  if (typeof identified.instructions === 'string') {
    identified.instructions = breadSystemPrompt(identified.instructions);
  }

  if (Array.isArray(identified.messages)) {
    const messages = identified.messages.map((message) =>
      message && typeof message === 'object'
        ? { ...(message as Record<string, unknown>) }
        : message,
    );
    const systemIndex = messages.findIndex(
      (message) =>
        message &&
        typeof message === 'object' &&
        (message as Record<string, unknown>).role === 'system',
    );
    if (systemIndex >= 0) {
      const systemMessage = messages[systemIndex] as Record<string, unknown>;
      if (typeof systemMessage.content === 'string') {
        messages[systemIndex] = {
          ...systemMessage,
          content: breadSystemPrompt(systemMessage.content),
        };
      }
    } else {
      messages.unshift({ role: 'system', content: breadSystemPrompt('') });
    }
    identified.messages = messages;
  }

  return { ...identified, ...extras } as T;
}
