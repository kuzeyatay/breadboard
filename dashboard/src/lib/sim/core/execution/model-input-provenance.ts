// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/execution/model-input-provenance.ts;
// adapted for Breadboard. TRIMMED to the projection layer the executor's handlers use:
// the header/metadata transport around it exists to carry provenance across sim's internal
// HTTP boundary, which Breadboard does not cross — the executor calls providers in-process.

import { isPlainRecord } from '@/lib/sim/core/utils/object'
import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/lib/sim/executor/utils/resolved-secret-trace-registry'

export interface PrivateSecretProvenanceSelection {
  key: string
  inputPaths: readonly ResolvedSecretInputPath[]
}

export type ResolvedModelInputProjection<T extends Record<string, unknown>> =
  | {
      complete: true
      value: T
      registry?: ResolvedSecretTraceRegistry
    }
  | { complete: false }

const MODEL_SCHEMA_ANNOTATION_KEYS = new Set([
  '$comment',
  'description',
  'example',
  'examples',
  'title',
])
const MODEL_SCHEMA_MAP_KEYS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])
const MODEL_SCHEMA_SINGLE_KEYS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])
const MODEL_SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

export interface ModelSchemaInputPathSelection {
  annotationInputPaths: ResolvedSecretInputPath[]
  semanticInputPaths: ResolvedSecretInputPath[]
}

export type ModelSchemaProjection = { safe: true; value: unknown } | { safe: false }

function haveSameRecordKeys(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key))
}

function areSchemaValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areSchemaValuesEqual(value, right[index]))
    )
  }
  if (!isPlainRecord(left) || !isPlainRecord(right) || !haveSameRecordKeys(left, right)) {
    return false
  }
  return Object.keys(left).every((key) => areSchemaValuesEqual(left[key], right[key]))
}

function selectSchemaMapInputPaths(
  value: unknown,
  path: ResolvedSecretInputPath,
  visitSchema: (schema: unknown, path: ResolvedSecretInputPath) => void,
  semanticInputPaths: ResolvedSecretInputPath[]
): void {
  if (!isPlainRecord(value)) {
    semanticInputPaths.push(path)
    return
  }
  for (const [name, childSchema] of Object.entries(value)) {
    visitSchema(childSchema, [...path, name])
  }
}

/** Selects JSON Schema annotations separately from fields that define its contract. */
export function selectModelSchemaInputPaths(
  schema: unknown,
  rootPath: ResolvedSecretInputPath
): ModelSchemaInputPathSelection {
  const annotationInputPaths: ResolvedSecretInputPath[] = []
  const semanticInputPaths: ResolvedSecretInputPath[] = []

  const visitSchema = (value: unknown, path: ResolvedSecretInputPath): void => {
    if (!isPlainRecord(value)) {
      semanticInputPaths.push(path)
      return
    }

    for (const [key, keywordValue] of Object.entries(value)) {
      const keywordPath = [...path, key]
      if (MODEL_SCHEMA_ANNOTATION_KEYS.has(key)) {
        annotationInputPaths.push(keywordPath)
        continue
      }
      if (MODEL_SCHEMA_MAP_KEYS.has(key)) {
        selectSchemaMapInputPaths(keywordValue, keywordPath, visitSchema, semanticInputPaths)
        continue
      }
      if (MODEL_SCHEMA_ARRAY_KEYS.has(key)) {
        if (!Array.isArray(keywordValue)) {
          semanticInputPaths.push(keywordPath)
          continue
        }
        keywordValue.forEach((childSchema, index) =>
          visitSchema(childSchema, [...keywordPath, String(index)])
        )
        continue
      }
      if (MODEL_SCHEMA_SINGLE_KEYS.has(key)) {
        if (key === 'items' && Array.isArray(keywordValue)) {
          keywordValue.forEach((childSchema, index) =>
            visitSchema(childSchema, [...keywordPath, String(index)])
          )
        } else {
          visitSchema(keywordValue, keywordPath)
        }
        continue
      }
      if (key === 'dependencies' && isPlainRecord(keywordValue)) {
        for (const [name, dependency] of Object.entries(keywordValue)) {
          const dependencyPath = [...keywordPath, name]
          if (Array.isArray(dependency)) semanticInputPaths.push(dependencyPath)
          else visitSchema(dependency, dependencyPath)
        }
        continue
      }
      semanticInputPaths.push(keywordPath)
    }
  }

  visitSchema(schema, rootPath)
  return { annotationInputPaths, semanticInputPaths }
}

function projectSchemaArray(rawValue: unknown, projectedValue: unknown): ModelSchemaProjection {
  if (
    !Array.isArray(rawValue) ||
    !Array.isArray(projectedValue) ||
    rawValue.length !== projectedValue.length
  ) {
    return { safe: false }
  }
  const value: unknown[] = []
  for (let index = 0; index < rawValue.length; index++) {
    const child = projectModelSchemaAnnotations(rawValue[index], projectedValue[index])
    if (!child.safe) return child
    value.push(child.value)
  }
  return { safe: true, value }
}

function projectSchemaMap(rawValue: unknown, projectedValue: unknown): ModelSchemaProjection {
  if (
    !isPlainRecord(rawValue) ||
    !isPlainRecord(projectedValue) ||
    !haveSameRecordKeys(rawValue, projectedValue)
  ) {
    return { safe: false }
  }
  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const child = projectModelSchemaAnnotations(rawValue[key], projectedValue[key])
    if (!child.safe) return child
    value[key] = child.value
  }
  return { safe: true, value }
}

function projectSchemaDependencies(
  rawValue: unknown,
  projectedValue: unknown
): ModelSchemaProjection {
  if (
    !isPlainRecord(rawValue) ||
    !isPlainRecord(projectedValue) ||
    !haveSameRecordKeys(rawValue, projectedValue)
  ) {
    return areSchemaValuesEqual(rawValue, projectedValue)
      ? { safe: true, value: rawValue }
      : { safe: false }
  }
  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const rawDependency = rawValue[key]
    const projectedDependency = projectedValue[key]
    if (Array.isArray(rawDependency)) {
      if (!areSchemaValuesEqual(rawDependency, projectedDependency)) return { safe: false }
      value[key] = rawDependency
      continue
    }
    const child = projectModelSchemaAnnotations(rawDependency, projectedDependency)
    if (!child.safe) return child
    value[key] = child.value
  }
  return { safe: true, value }
}

/** Applies exact projections only to annotations while preserving schema contract fields. */
export function projectModelSchemaAnnotations(
  rawValue: unknown,
  projectedValue: unknown
): ModelSchemaProjection {
  if (Object.is(rawValue, projectedValue)) return { safe: true, value: rawValue }
  if (!isPlainRecord(rawValue) || !isPlainRecord(projectedValue)) return { safe: false }
  if (!haveSameRecordKeys(rawValue, projectedValue)) return { safe: false }

  const value: Record<string, unknown> = {}
  for (const key of Object.keys(rawValue)) {
    const rawKeyword = rawValue[key]
    const projectedKeyword = projectedValue[key]
    if (MODEL_SCHEMA_ANNOTATION_KEYS.has(key)) {
      value[key] = projectedKeyword
      continue
    }
    if (MODEL_SCHEMA_MAP_KEYS.has(key)) {
      const child = projectSchemaMap(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (MODEL_SCHEMA_ARRAY_KEYS.has(key)) {
      const child = projectSchemaArray(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (MODEL_SCHEMA_SINGLE_KEYS.has(key)) {
      const child =
        key === 'items' && Array.isArray(rawKeyword)
          ? projectSchemaArray(rawKeyword, projectedKeyword)
          : projectModelSchemaAnnotations(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (key === 'dependencies') {
      const child = projectSchemaDependencies(rawKeyword, projectedKeyword)
      if (!child.safe) return child
      value[key] = child.value
      continue
    }
    if (!areSchemaValuesEqual(rawKeyword, projectedKeyword)) return { safe: false }
    value[key] = rawKeyword
  }
  return { safe: true, value }
}

/**
 * Builds a model-facing copy from resolver-recorded leaves only.
 *
 * The selected record must retain the same top-level keys and nested paths as the block inputs
 * that passed through `VariableResolver`. No plaintext matching is performed here.
 */
export function projectResolvedModelInput<T extends Record<string, unknown>>(
  registry: ResolvedSecretTraceRegistry | undefined,
  selected: T,
  inputPaths: readonly ResolvedSecretInputPath[]
): ResolvedModelInputProjection<T> {
  if (!registry) return { complete: true, value: selected }

  const modelRegistry = registry.forkForInputPaths(inputPaths)
  const projection = modelRegistry.projectResolvedInputSelection(selected)
  if (!projection.complete) return { complete: false }
  return {
    complete: true,
    value: projection.value as T,
    registry: modelRegistry,
  }
}

