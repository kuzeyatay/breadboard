// Breadboard adaptation of simstudioai/sim (Apache-2.0) — apps/sim/providers/utils.ts.
// TRIMMED to the two functions the vendored executor imports. Sim's 1,709-line file also
// covers model→vendor routing across ~26 SDKs, blacklists, hosted-key handout, credit
// formatting and BYOK — none of which applies: Breadboard routes every model to one
// provider (providers/index.ts) speaking the local ChatMock/CLIProxy layer.

import { createLogger } from "@/lib/sim/core/logger";
import { omit } from "@/lib/sim/core/utils/object";
import type { WorkflowInputField } from "@/lib/sim/core/workflows/input-format";
import type { CustomBlockToolBinding } from "@/lib/sim/core/workflows/custom-blocks/operations";
import {
  type CanonicalGroup,
  type CanonicalModeOverrides,
  buildCanonicalIndex,
  isCanonicalPair,
  resolveActiveCanonicalValue,
  scopeCanonicalModesForTool,
} from "@/lib/sim/core/workflows/subblocks/visibility";
import { createLLMToolSchema } from "@/lib/sim/core/tools-shim/params";
import { isCustomTool } from "@/lib/sim/executor/constants";
import type { ProviderId, ProviderToolConfig } from "@/lib/sim/providers/types";
import { BREADBOARD_PROVIDER_ID } from "@/lib/sim/providers/types";
import type { WorkflowToolExecutionContext } from "@/lib/sim/tools/types";

const logger = createLogger("ProviderUtils");

/**
 * Every model resolves to the one Breadboard provider. Sim maps a model id onto a vendor
 * SDK here; Breadboard's model layer already does that routing behind an OpenAI-compatible
 * endpoint, so re-deriving it from the id would only be able to disagree with it.
 */
export function getProviderFromModel(_model: string): ProviderId {
  return BREADBOARD_PROVIDER_ID;
}

function resolveCanonicalResourceParams(
  params: Record<string, any>,
  canonicalGroups: CanonicalGroup[],
  scopedCanonicalModes?: CanonicalModeOverrides,
): Record<string, any> {
  if (canonicalGroups.length === 0) return params;
  const resolved = { ...params };
  for (const group of canonicalGroups) {
    const explicitMode = scopedCanonicalModes?.[group.canonicalId];
    const chosen = resolveActiveCanonicalValue(
      group,
      params,
      explicitMode ? { [group.canonicalId]: explicitMode } : undefined,
    );
    if (chosen !== undefined) resolved[group.canonicalId] = chosen;
  }
  return resolved;
}

/**
 * Turns one entry of an agent block's `tool-input` array into the tool config a provider
 * sends to the model.
 *
 * Dropped from sim's version: the custom-block (`deploy-as-block`) branch, the
 * `workflow_executor` metadata lookup, and the knowledge/table id-scoped tool ids — all
 * three read Postgres registries Breadboard does not vendor. `resolveCustomBlockBinding`
 * stays in the options so the agent handler's call site is unchanged; it always resolves
 * to null, and a custom block is simply not offered as a tool.
 */
export async function transformBlockTool(
  block: any,
  options: {
    selectedOperation?: string;
    getAllBlocks: () => any[];
    getTool: (toolId: string) => any;
    getToolAsync?: (toolId: string) => Promise<any>;
    canonicalModes?: Record<string, "basic" | "advanced">;
    enrichmentContext?: WorkflowToolExecutionContext;
    resolveCustomBlockBinding?: (blockType: string) => Promise<CustomBlockToolBinding | null>;
    toolIndex?: number;
  },
): Promise<ProviderToolConfig | null> {
  const { selectedOperation, getAllBlocks, getTool, getToolAsync, canonicalModes, toolIndex } =
    options;
  const scopedCanonicalModes = scopeCanonicalModesForTool(canonicalModes, toolIndex, block.type);

  const blockDef = getAllBlocks().find((candidate: any) => candidate.type === block.type);
  if (!blockDef) {
    logger.warn(`Block definition not found for type: ${block.type}`);
    return null;
  }

  let toolId: string | null = null;
  if ((blockDef.tools?.access?.length || 0) > 1) {
    if (selectedOperation && blockDef.tools?.config?.tool) {
      try {
        toolId = blockDef.tools.config.tool({ ...block.params, operation: selectedOperation });
      } catch (error) {
        logger.error("Error selecting tool for block", {
          blockType: block.type,
          operation: selectedOperation,
          error,
        });
        return null;
      }
    } else {
      toolId = blockDef.tools.access[0];
    }
  } else {
    toolId = blockDef.tools?.access?.[0] || null;
  }

  if (!toolId) {
    logger.warn(`No tool ID found for block: ${block.type}`);
    return null;
  }

  const toolConfig =
    isCustomTool(toolId) && getToolAsync ? await getToolAsync(toolId) : getTool(toolId);
  if (!toolConfig) {
    logger.warn(`Tool config not found for ID: ${toolId}`);
    return null;
  }

  const userProvidedParams = block.params || {};

  const canonicalGroups: CanonicalGroup[] = blockDef?.subBlocks
    ? Object.values(buildCanonicalIndex(blockDef.subBlocks).groupsById).filter(isCanonicalPair)
    : [];

  const resolvedResourceParams = resolveCanonicalResourceParams(
    userProvidedParams,
    canonicalGroups,
    scopedCanonicalModes,
  );

  const { schema: llmSchema, enrichedDescription, modelBlockedParams } = await createLLMToolSchema(
    toolConfig,
    resolvedResourceParams,
    options.enrichmentContext as Record<string, unknown> | undefined,
  );

  const blockParamsFn = blockDef?.tools?.config?.params as
    | ((p: Record<string, any>) => Record<string, any>)
    | undefined;
  const blockInputDefs = blockDef?.inputs as Record<string, any> | undefined;

  const needsTransform = blockParamsFn || blockInputDefs || canonicalGroups.length > 0;
  const paramsTransform = needsTransform
    ? (params: Record<string, any>): Record<string, any> => {
        let result = { ...params };

        for (const group of canonicalGroups) {
          const explicitMode = scopedCanonicalModes?.[group.canonicalId];
          const chosen = resolveActiveCanonicalValue(
            group,
            result,
            explicitMode ? { [group.canonicalId]: explicitMode } : undefined,
          );

          const sourceIds = [group.basicId, ...group.advancedIds].filter(Boolean) as string[];
          result = omit(result, sourceIds);
          if (chosen !== undefined) result[group.canonicalId] = chosen;
        }

        if (blockParamsFn) {
          result = { ...result, ...blockParamsFn(result) };
        }

        if (blockInputDefs) {
          for (const [key, schema] of Object.entries(blockInputDefs)) {
            const value = result[key];
            if (typeof value === "string" && value.trim().length > 0) {
              const inputType = typeof schema === "object" ? schema.type : schema;
              if (inputType === "json" || inputType === "array") {
                try {
                  result[key] = JSON.parse(value.trim());
                } catch {
                  // Not valid JSON — keep as string.
                }
              }
            }
          }
        }

        return result;
      }
    : undefined;

  return {
    id: toolConfig.id,
    name: toolConfig.name,
    description: enrichedDescription || toolConfig.description,
    params: userProvidedParams,
    parameters: llmSchema,
    modelBlockedParams,
    paramsTransform,
  };
}

/** Referenced by workflow-input tooling; kept here so the shape stays with its sibling. */
export type { WorkflowInputField };
