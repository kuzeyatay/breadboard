// Vendored from simstudioai/sim (Apache-2.0), apps/sim/tools/types.ts —
// adapted for Breadboard: the 5 external `import type` deps (copilot resource
// shapes, hosted-key rate-limit config, model-input provenance, OAuth service
// union, resolved-secret trace path) are declared inline as loose stand-ins
// since Breadboard's executor never exercises the hosted-key billing or
// model-input-provenance systems those types describe — only their presence
// on ToolConfig, so vendored tool files that reference them keep type-checking.

/** Loose stand-in for sim's copilot MothershipResource — never populated here. */
export interface MothershipResource {
  [key: string]: unknown;
}

/** Loose stand-in for sim's hosted-key rate-limit config — not enforced here. */
export type HostedKeyRateLimitConfig = Record<string, unknown>;

/** Mirrors sim's PrivateSecretProvenanceSelection (lib/execution/model-input-provenance).
 * Declared here rather than imported so this file stays free of executor imports. */
export interface PrivateSecretProvenanceSelection {
  key: string;
  inputPaths: readonly ResolvedSecretInputPath[];
}

/** Breadboard bridges OAuth by Nango provider slug, so a bare string suffices. */
export type OAuthService = string;

/** Same shape as the executor's own `ResolvedSecretInputPath` (a path of object keys).
 * Declared, not imported, so this file stays free of executor imports. */
export type ResolvedSecretInputPath = readonly string[];

export type BYOKProviderId = string;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";

export type WorkflowToolExecutionContext = {
  workspaceId?: string;
  workflowId?: string;
  executionId?: string;
  userId?: string;
};

export type OutputType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "file"
  | "file[]"
  | "array"
  | "object";

export interface OutputProperty {
  type: OutputType;
  description?: string;
  optional?: boolean;
  nullable?: boolean;
  properties?: Record<string, OutputProperty>;
  items?: {
    type: OutputType;
    description?: string;
    properties?: Record<string, OutputProperty>;
  };
}

export interface ToolOutputProperty extends OutputProperty {
  fileConfig?: {
    mimeType?: string;
    extension?: string;
  };
}

export type ParameterVisibility = "user-or-llm" | "user-only" | "llm-only" | "hidden";

export interface ToolResponse {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  statusCode?: number;
  resources?: MothershipResource[];
  largeValueKeys?: string[];
  fileKeys?: string[];
  timing?: {
    startTime: string;
    endTime: string;
    duration: number;
  };
}

export interface OAuthConfig {
  required: boolean;
  provider: OAuthService;
  requiredScopes?: string[];
}

export interface ToolRetryConfig {
  enabled: boolean;
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryIdempotentOnly?: boolean;
}

/** JSON Schema subset supported for array item definitions in tool parameters. */
export interface ToolParameterItemSchema {
  readonly type?: string;
  readonly description?: string;
  readonly const?: string | number | boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly additionalProperties?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, ToolParameterItemSchema>>;
  readonly anyOf?: readonly ToolParameterItemSchema[];
}

export interface ToolConfig<P = any, R = any> {
  id: string;
  name: string;
  description: string;
  version: string;

  params: Record<
    string,
    {
      type: string;
      required?: boolean;
      visibility?: ParameterVisibility;
      default?: any;
      description?: string;
      items?: ToolParameterItemSchema;
    }
  >;
  outputs?: Record<string, ToolOutputProperty>;

  oauth?: OAuthConfig;

  errorExtractor?: string;

  request: {
    url: string | ((params: P) => string);
    method: HttpMethod | ((params: P) => HttpMethod);
    headers: (params: P) => Record<string, string>;
    body?: (params: P) => Record<string, any> | string | FormData | undefined;
    /** Selects the signed, workflow-scoped identity required by protected internal routes — unused: Breadboard excludes internal-route tools. */
    internalAuth?: "executor_delegation";
    /**
     * Model-input-provenance projection — no vendored Breadboard tool declares one, but the
     * generic handler branches on the discriminant, so the union must stay a union: a
     * flattened variant with both selectors optional makes `mode === 'project'` fail to
     * guarantee `select` exists.
     */
    modelInput?:
      | {
          mode: "project";
          select: (params: P) => Record<string, unknown>;
          applyProjected?: (
            selectedParams: Partial<P>,
            projectedSelection: Record<string, unknown>,
          ) => Record<string, unknown>;
          privateInputPaths?: (params: P) => readonly ResolvedSecretInputPath[];
        }
      | {
          mode: "private-provenance";
          inputPaths: (params: P) => readonly ResolvedSecretInputPath[];
        };
    /** Private secret provenance transport — unused by Breadboard's executor. */
    secretProvenance?: {
      request?: (params: P) => PrivateSecretProvenanceSelection[];
      response?: {
        incomplete: "reject" | "propagate";
      };
    };
    retry?: ToolRetryConfig;
    stripAuthOnRedirect?: boolean;
  };

  postProcess?: (
    result: R extends ToolResponse ? R : ToolResponse,
    params: P,
    executeTool: (toolId: string, params: Record<string, any>) => Promise<ToolResponse>,
  ) => Promise<R extends ToolResponse ? R : ToolResponse>;

  transformResponse?: (response: Response, params?: P) => Promise<R>;

  directExecution?: (params: P, signal?: AbortSignal) => Promise<ToolResponse>;

  schemaEnrichment?: Record<string, unknown>;
  toolEnrichment?: Record<string, unknown>;

  hosting?: ToolHostingConfig<P>;
}

export interface TableRow {
  id: string;
  cells: {
    Key: string;
    Value: any;
  };
}

export interface OAuthTokenPayload {
  credentialId?: string;
  credentialAccountUserId?: string;
  providerId?: string;
  toolId?: string;
  workflowId?: string;
  impersonateEmail?: string;
  scopes?: string[];
}

export interface ToolFileData {
  name: string;
  mimeType: string;
  data?: Buffer | string;
  url?: string;
  size?: number;
}

export type ToolHostingPricing<P = Record<string, unknown>> =
  | { type: "per_request"; cost: number }
  | {
      type: "custom";
      getCost: (
        params: P,
        output: Record<string, unknown>,
      ) => number | { cost: number; metadata?: Record<string, unknown> };
    };

export type ToolHostingCondition =
  | { field: string; operator: "equals"; value: string | number | boolean | null }
  | { field: string; operator: "one_of"; values: Array<string | number | boolean | null> };

export type ToolHostingPredicate<P> = ((params: P) => boolean) & {
  condition?: ToolHostingCondition;
};

export interface ToolHostingConfig<P = Record<string, unknown>> {
  enabled?: ToolHostingPredicate<P>;
  envKeyPrefix: string;
  apiKeyParam: string;
  byokProviderId?: BYOKProviderId;
  pricing: ToolHostingPricing<P>;
  rateLimit: HostedKeyRateLimitConfig;
}
