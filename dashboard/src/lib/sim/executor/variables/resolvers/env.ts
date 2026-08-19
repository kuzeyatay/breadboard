// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/variables/resolvers/env.ts; adapted for Breadboard.
import { createLogger } from '@/lib/sim/core/logger'
import { extractEnvVarName, isEnvVarReference } from '@/lib/sim/executor/constants'
import type { ResolutionContext, Resolver } from '@/lib/sim/executor/variables/resolvers/reference'

const logger = createLogger('EnvResolver')

export class EnvResolver implements Resolver {
  canResolve(reference: string): boolean {
    return isEnvVarReference(reference)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const varName = extractEnvVarName(reference)

    const value = context.executionContext.environmentVariables?.[varName]
    if (value === undefined) {
      return reference
    }
    if (Object.hasOwn(context.executionContext.environmentVariables, varName)) {
      context.executionContext.resolvedSecretTraceRegistry?.recordResolvedAtInputPath(
        varName,
        value,
        context.inputPath
      )
    }
    return value
  }
}
