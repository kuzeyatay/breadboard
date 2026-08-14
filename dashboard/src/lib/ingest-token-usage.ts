import type OpenAI from "openai";
import {
  attachLearnTokenUsageTracking,
  emptyLearnTokenUsage,
  sumLearnTokenUsage,
  type LearnTokenUsage,
  type LearnTokenUsageEvent,
} from "./learn-token-usage.ts";

/** Request-scoped usage emitted by document ingestion. The counters include
 * every ChatMock call made for OCR, PDF formatting, knowledge extraction, and
 * note generation, including calls whose provider response omitted usage. */
export type IngestTokenUsage = LearnTokenUsage & {
  /** Server-resolved model used for every metered call in this request. */
  model?: string;
};

export function emptyIngestTokenUsage(): IngestTokenUsage {
  return emptyLearnTokenUsage();
}

export function sumIngestTokenUsage(
  usages: Iterable<IngestTokenUsage | null | undefined>,
): IngestTokenUsage {
  const collected = Array.from(usages).filter(
    (usage): usage is IngestTokenUsage => Boolean(usage),
  );
  const total = sumLearnTokenUsage(collected);
  const models = Array.from(
    new Set(collected.map((usage) => usage.model?.trim()).filter(Boolean)),
  );
  return models.length === 1 ? { ...total, model: models[0] } : total;
}

export function recordIngestTokenUsageEvent(
  current: IngestTokenUsage,
  event: LearnTokenUsageEvent,
): IngestTokenUsage {
  if (event.type === "started") {
    return {
      ...current,
      startedCalls: current.startedCalls + 1,
      inFlightCalls: current.inFlightCalls + 1,
    };
  }

  const usage = event.usage;
  return {
    ...current,
    inputTokens: current.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: current.outputTokens + (usage?.outputTokens ?? 0),
    totalTokens: current.totalTokens + (usage?.totalTokens ?? 0),
    cachedInputTokens: current.cachedInputTokens + (usage?.cachedInputTokens ?? 0),
    reasoningTokens: current.reasoningTokens + (usage?.reasoningTokens ?? 0),
    estimated: current.estimated || Boolean(usage?.estimated),
    completedCalls: current.completedCalls + 1,
    reportedCalls: current.reportedCalls + (usage ? 1 : 0),
    unreportedCalls: current.unreportedCalls + (usage ? 0 : 1),
    inFlightCalls: Math.max(0, current.inFlightCalls - 1),
  };
}

export function attachIngestTokenUsageTracking(
  client: OpenAI,
  listener: (usage: IngestTokenUsage) => void,
): OpenAI {
  let current = emptyIngestTokenUsage();
  return attachLearnTokenUsageTracking(client, (event) => {
    current = recordIngestTokenUsageEvent(current, event);
    listener({ ...current });
  });
}
