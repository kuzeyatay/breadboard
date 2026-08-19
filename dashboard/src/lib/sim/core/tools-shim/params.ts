// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/tools/params.ts (filterSchemaForLLM + ToolSchemaEnrichmentError only,
// the slice the agent handler needs); adapted for Breadboard. Sim's file is 1,182 lines covering the full user/LLM
// param-merge layer; Breadboard's agent handler only needs the schema-filtering step and the enrichment error type.

export interface ToolSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
}

export class ToolSchemaEnrichmentError extends Error {
  constructor(toolId: string, cause: unknown) {
    super(`Failed to enrich schema for tool "${toolId}"`, { cause })
    this.name = 'ToolSchemaEnrichmentError'
  }
}

function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

interface FilterableToolSchema {
  properties?: Record<string, unknown>
  required?: string[]
}

/** Filters user-provided parameters from any object-shaped tool schema sent to an LLM. */
export function filterSchemaForLLM<T extends FilterableToolSchema>(
  originalSchema: T,
  userProvidedParams: Record<string, unknown>
): T {
  if (!originalSchema || !originalSchema.properties) {
    return originalSchema
  }

  const filteredProperties = { ...originalSchema.properties }
  const filteredRequired = [...(originalSchema.required || [])]

  Object.keys(userProvidedParams).forEach((paramKey) => {
    if (isNonEmpty(userProvidedParams[paramKey])) {
      delete filteredProperties[paramKey]
      const reqIndex = filteredRequired.indexOf(paramKey)
      if (reqIndex > -1) {
        filteredRequired.splice(reqIndex, 1)
      }
    }
  })

  return Object.assign({}, originalSchema, {
    properties: filteredProperties,
    required: filteredRequired,
  })
}

interface LLMToolSchemaResult {
  schema: ToolSchema
  enrichedDescription?: string
  modelBlockedParams: string[]
}

/**
 * Builds the JSON Schema an LLM sees for one tool. Sim's version also runs per-param
 * `schemaEnrichment` and whole-tool `toolEnrichment` hooks, which fetch live resource
 * shapes (a Notion database's columns, a workflow's input fields) from its API — no
 * vendored Breadboard tool declares either, so those branches are dropped and this is
 * synchronous in effect while keeping sim's async signature.
 */
export async function createLLMToolSchema(
  toolConfig: import('@/lib/sim/tools/types').ToolConfig,
  userProvidedParams: Record<string, unknown>,
  _enrichmentContext: Record<string, unknown> = {}
): Promise<LLMToolSchemaResult> {
  const schema: ToolSchema = { type: 'object', properties: {}, required: [] }

  // Derived from the declarations, not from which branch skipped a param: the skips below
  // also cover params the user simply filled in, and those are not off-limits to the model.
  const modelBlockedParams = Object.entries(toolConfig.params)
    .filter(([, param]) => param.visibility === 'user-only' || param.visibility === 'hidden')
    .map(([paramId]) => paramId)

  for (const [paramId, param] of Object.entries(toolConfig.params)) {
    if (isNonEmpty(userProvidedParams[paramId])) continue
    if (param.visibility === 'user-only' || param.visibility === 'hidden') continue

    const schemaType = param.type === 'json' || param.type === 'any' ? 'object' : param.type
    const propertySchema: Record<string, unknown> = {
      type: schemaType,
      description: param.description || '',
    }
    if (param.type === 'array' && param.items) propertySchema.items = { ...param.items }

    schema.properties[paramId] = propertySchema
    if ((param.visibility === 'user-or-llm' || param.visibility === 'llm-only') && param.required) {
      schema.required.push(paramId)
    }
  }

  return { schema, modelBlockedParams }
}
