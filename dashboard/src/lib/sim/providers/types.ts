// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/providers/types.ts; adapted for
// Breadboard. `ProviderId` is widened to a string: sim's closed union names ~26 vendor
// SDKs, while Breadboard routes every model through one OpenAI-compatible provider
// (see providers/index.ts) whose id is `breadboard`.

import type { BillingAttributionSnapshot } from "@/lib/sim/core/billing/core/billing-attribution";
import type { ProviderTimingSegment, StreamingExecution, UserFile } from "@/lib/sim/executor/types";

export type ProviderId = string;

export const BREADBOARD_PROVIDER_ID = "breadboard";

export interface ModelPricing {
  /** Per 1M tokens. */
  input: number;
  cachedInput?: number;
  output: number;
  updatedAt: string;
}

export type ModelPricingMap = Record<string, ModelPricing>;

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  models: string[];
  defaultModel: string;
  initialize?: () => Promise<void>;
  executeRequest: (
    request: ProviderRequest,
  ) => Promise<ProviderResponse | ReadableStream<any> | StreamingExecution>;
}

export interface FunctionCallResponse {
  name: string;
  arguments: Record<string, any>;
  startTime?: string;
  endTime?: string;
  duration?: number;
  result?: unknown;
  output?: Record<string, any>;
  input?: Record<string, any>;
  success?: boolean;
}

export type TimeSegment = ProviderTimingSegment;

export interface ProviderResponse {
  content: string;
  model: string;
  tokens?: {
    /** Tokens billed at the base input rate, excluding cache reads and writes. */
    input?: number;
    output?: number;
    total?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  toolCalls?: FunctionCallResponse[];
  toolResults?: Record<string, unknown>[];
  timing?: {
    startTime: string;
    endTime: string;
    duration: number;
    modelTime?: number;
    toolsTime?: number;
    firstResponseTime?: number;
    iterations?: number;
    timeSegments?: TimeSegment[];
  };
  cost?: {
    input: number;
    output: number;
    toolCost?: number;
    total: number;
    pricing: ModelPricing;
  };
  interactionId?: string;
}

export type ToolUsageControl = "auto" | "force" | "none";

export interface ProviderToolConfig {
  id: string;
  name: string;
  description: string;
  params: Record<string, any>;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  usageControl?: ToolUsageControl;
  /**
   * Params the model may never supply because the tool declares them `user-only` or
   * `hidden`. Stripped from the model's arguments before they merge with the user's —
   * omitting them from `parameters` alone does not stop a model emitting one anyway.
   */
  modelBlockedParams?: string[];
  /** Block-level params transformer — converts SubBlock values to tool-ready params. */
  paramsTransform?: (params: Record<string, any>) => Record<string, any>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  files?: UserFile[];
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface ProviderRequest {
  model: string;
  systemPrompt?: string;
  context?: string;
  tools?: ProviderToolConfig[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  messages?: Message[];
  responseFormat?: {
    name: string;
    schema: any;
    strict?: boolean;
  };
  local_execution?: boolean;
  workflowId?: string;
  workspaceId?: string;
  chatId?: string;
  userId?: string;
  stream?: boolean;
  agentEvents?: boolean;
  environmentVariables?: Record<string, string>;
  workflowVariables?: Record<string, any>;
  blockData?: Record<string, any>;
  blockNameMapping?: Record<string, string>;
  isCopilotRequest?: boolean;
  isBYOK?: boolean;
  azureEndpoint?: string;
  azureApiVersion?: string;
  vertexProject?: string;
  vertexLocation?: string;
  bedrockAccessKeyId?: string;
  bedrockSecretKey?: string;
  bedrockRegion?: string;
  reasoningEffort?: string;
  verbosity?: string;
  thinkingLevel?: string;
  promptCaching?: boolean;
  /** Stable identity of the block issuing the request, used for cache routing. */
  blockId?: string;
  isDeployedContext?: boolean;
  callChain?: string[];
  executionId?: string;
  billingAttribution?: BillingAttributionSnapshot;
  previousInteractionId?: string;
  abortSignal?: AbortSignal;
}

/** Provider failure carrying the timing the block log needs. */
export class ProviderError extends Error {
  timing: {
    startTime: string;
    endTime: string;
    duration: number;
  };

  constructor(
    message: string,
    timing: { startTime: string; endTime: string; duration: number },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.timing = timing;
  }
}

export const providers: Record<string, ProviderConfig> = {};
