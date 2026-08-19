// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/generic.ts, adapted for Breadboard.
// Adaptation: @sim/logger -> local shim; allowedIps client-IP check and
// processInputFiles (execution file uploads) are dropped — Breadboard's
// generic hook has no IP allowlist field or file-upload input-format UI.

import { NextResponse } from 'next/server'
import { createLogger } from '../support'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'
import { verifyTokenAuth } from './utils'

const logger = createLogger('WebhookProvider:Generic')

export const genericHandler: WebhookProviderHandler = {
  verifyAuth({ request, providerConfig }: AuthContext) {
    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token as string | undefined
      if (!configToken) {
        return new NextResponse('Unauthorized - Authentication required but no token configured', {
          status: 401,
        })
      }

      const secretHeaderName = providerConfig.secretHeaderName as string | undefined
      if (!verifyTokenAuth(request, configToken, secretHeaderName)) {
        return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
      }
    }

    return null
  },

  enrichHeaders({ body, providerConfig }: EventFilterContext, headers: Record<string, string>) {
    const idempotencyField = providerConfig.idempotencyField as string | undefined
    if (idempotencyField && body) {
      const value = idempotencyField
        .split('.')
        .reduce(
          (acc: unknown, key: string) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
          body
        )
      if (value !== undefined && value !== null && typeof value !== 'object') {
        headers['x-breadboard-idempotency-key'] = String(value)
      }
    }
  },

  formatSuccessResponse(providerConfig: Record<string, unknown>) {
    if (providerConfig.responseMode === 'custom') {
      const rawCode = Number(providerConfig.responseStatusCode) || 200
      const statusCode = rawCode >= 100 && rawCode <= 599 ? rawCode : 200
      const responseBody = (providerConfig.responseBody as string | undefined)?.trim()

      if (!responseBody) {
        return new NextResponse(null, { status: statusCode })
      }

      try {
        const parsed = JSON.parse(responseBody)
        return NextResponse.json(parsed, { status: statusCode })
      } catch {
        return new NextResponse(responseBody, {
          status: statusCode,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },
}

void logger
