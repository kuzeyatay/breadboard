// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/registry.ts, adapted for Breadboard.
// Pruned to the 7 providers this agent vendors. Fallback default handler is a
// bare bearer-token check, same as sim's.

import { NextResponse } from 'next/server'
import type { AuthContext, WebhookProviderHandler } from './types'
import { verifyTokenAuth } from './utils'
import { genericHandler } from './generic'
import { githubHandler } from './github'
import { telegramHandler } from './telegram'
import { stripeHandler } from './stripe'
import { slackHandler } from './slack'
import { linearHandler } from './linear'
import { gitlabHandler } from './gitlab'

const defaultHandler: WebhookProviderHandler = {
  verifyAuth({ request, providerConfig }: AuthContext) {
    const token = providerConfig.token as string | undefined
    if (!token) return null
    return verifyTokenAuth(request, token) ? null : new NextResponse('Unauthorized', { status: 401 })
  },
}

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  generic: genericHandler,
  github: githubHandler,
  telegram: telegramHandler,
  stripe: stripeHandler,
  slack: slackHandler,
  linear: linearHandler,
  gitlab: gitlabHandler,
}

export function getProviderHandler(provider: string): WebhookProviderHandler {
  return PROVIDER_HANDLERS[provider] ?? defaultHandler
}

export const SUPPORTED_HOOK_PROVIDERS = Object.keys(PROVIDER_HANDLERS)
