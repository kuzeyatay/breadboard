import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  LanguageModelV1,
  wrapLanguageModel,
} from 'ai';
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter';

// Providers

// ChatMock is Breadboard's local OpenAI-compatible gateway. When it is
// configured it is the backend for this agent, so a research run needs no
// third-party API key. It is an OpenAI-compatible shim, not OpenAI: it supports
// function calling but NOT `response_format`, so object generation has to run in
// tool mode (see `objectGenerationMode`) and the model is created with
// `structuredOutputs: false`.
//
// Runtime V2 launches this sidecar with the gateway under `OPENAI_BASE_URL`
// (plus `OPENAI_API_KEY=local` and a `CHATMOCK_MODEL`), not `CHATMOCK_BASE_URL`.
// A live desktop run reported "model: none/unset" and every Max Research
// drive lost its broadest participant to "running but not configured to
// answer". `CHATMOCK_MODEL` being set is the runtime's signal that the OpenAI
// variables point at ChatMock, so it is honoured as the same configuration.
const chatmockBaseUrl = normalizeBaseUrl(
  process.env.CHATMOCK_BASE_URL ||
    (process.env.CHATMOCK_MODEL ? process.env.OPENAI_BASE_URL : undefined),
);

const chatmock = chatmockBaseUrl
  ? createOpenAI({
      // ChatMock authenticates the caller locally; the key is a placeholder.
      apiKey: process.env.CHATMOCK_API_KEY || 'local',
      baseURL: chatmockBaseUrl,
      name: 'chatmock',
    })
  : undefined;

const openai = process.env.OPENAI_KEY
  ? createOpenAI({
      apiKey: process.env.OPENAI_KEY,
      baseURL: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
    })
  : undefined;

const fireworks = process.env.FIREWORKS_KEY
  ? createFireworks({
      apiKey: process.env.FIREWORKS_KEY,
    })
  : undefined;

const customModel = process.env.CUSTOM_MODEL
  ? openai?.(process.env.CUSTOM_MODEL, {
      structuredOutputs: true,
    })
  : undefined;

// Models

const chatmockModelId = process.env.CHATMOCK_MODEL || 'gpt-5.6-sol';

const chatmockModel = chatmock?.(chatmockModelId, {
  structuredOutputs: false,
});

const o3MiniModel = openai?.('o3-mini', {
  reasoningEffort: 'medium',
  structuredOutputs: true,
});

const deepSeekR1Model = fireworks
  ? wrapLanguageModel({
      model: fireworks(
        'accounts/fireworks/models/deepseek-r1',
      ) as LanguageModelV1,
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  : undefined;

/** Add the protocol when omitted and guarantee the `/v1` suffix. */
function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`,
    );
    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function getModel(): LanguageModelV1 {
  // ChatMock wins when configured: it is the gateway the surrounding product
  // already runs, and it needs no user-supplied credential.
  if (chatmockModel) {
    return chatmockModel;
  }

  if (customModel) {
    return customModel;
  }

  const model = deepSeekR1Model ?? o3MiniModel;
  if (!model) {
    throw new Error('No model found');
  }

  return model as LanguageModelV1;
}

/**
 * How `generateObject` should coerce structured output.
 *
 * ChatMock ignores `response_format`, so JSON mode would leave the schema
 * unenforced and the parse would depend on the model volunteering bare JSON.
 * Tool mode instead forces a function call whose arguments ARE the object, which
 * ChatMock passes through to the upstream Responses API. Other providers keep
 * the SDK's own choice.
 */
export function objectGenerationMode(): 'auto' | 'tool' {
  return chatmockModel ? 'tool' : 'auto';
}

/** Non-secret description of the active model, for health/diagnostics. */
export function getModelInfo(): {
  provider: string;
  model: string;
  endpoint: string | null;
} {
  if (chatmockModel) {
    return {
      provider: 'chatmock',
      model: chatmockModelId,
      endpoint: chatmockBaseUrl ?? null,
    };
  }
  if (customModel) {
    return {
      provider: 'openai-compatible',
      model: process.env.CUSTOM_MODEL as string,
      endpoint: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
    };
  }
  if (deepSeekR1Model) {
    return {
      provider: 'fireworks',
      model: 'accounts/fireworks/models/deepseek-r1',
      endpoint: null,
    };
  }
  if (o3MiniModel) {
    return { provider: 'openai', model: 'o3-mini', endpoint: null };
  }
  return { provider: 'none', model: '', endpoint: null };
}

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}
