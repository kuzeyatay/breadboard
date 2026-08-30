/**
 * Crypto Paper Trading API — application entry point.
 * Port of `main.py` (FastAPI -> Hono).
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'

import { ensureSchema } from './db/client.js'
import { seedDatabase } from './db/seed.js'
import { accountRoutes } from './api/account.js'
import { configRoutes } from './api/config.js'
import { cryptoRoutes } from './api/crypto.js'
import { marketDataRoutes } from './api/marketData.js'
import { orderRoutes } from './api/orders.js'
import { rankingRoutes } from './api/ranking.js'
import {
  createWsState,
  handleWsClose,
  handleWsMessage,
} from './api/ws.js'
import { initializeServices, shutdownServices } from './services/startup.js'
import { getLogger } from './utils/logger.js'

const logger = getLogger('main')

const here = path.dirname(fileURLToPath(import.meta.url))
const staticDir = path.resolve(here, '../static')
const indexPath = path.join(staticDir, 'index.html')

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.use(
  '*',
  cors({
    origin: '*', // Allow all origins, or specify specific domains
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['*'],
  }),
)

// Health check endpoint
app.get('/api/health', (c) =>
  c.json({ status: 'healthy', message: 'Trading API is running' }),
)

// API routes
app.route('/api/market', marketDataRoutes)
app.route('/api/orders', orderRoutes)
app.route('/api/account', accountRoutes)
app.route('/api/config', configRoutes)
app.route('/api/ranking', rankingRoutes)
app.route('/api/crypto', cryptoRoutes)

// WebSocket endpoint
app.get(
  '/ws',
  upgradeWebSocket(() => {
    const state = createWsState()
    return {
      onMessage: (event, ws) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data)
        void handleWsMessage(state, ws, data).catch((e) =>
          logger.error(`WebSocket message handling failed: ${e}`),
        )
      },
      onClose: (_event, ws) => handleWsClose(state, ws),
      onError: (_event, ws) => handleWsClose(state, ws),
    }
  }),
)

// Mount static files for the frontend
if (fs.existsSync(staticDir)) {
  app.use('/static/*', serveStatic({ root: path.relative(process.cwd(), staticDir) }))
  app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), staticDir) }))
}

/** Serve the frontend index.html, or a placeholder when not built yet. */
function serveIndex(c: Context) {
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf8'))
  }
  return c.json({ message: 'Frontend not built yet' })
}

// Serve frontend index.html for the root route
app.get('/', (c) => serveIndex(c))

// Catch-all for SPA routing (must be last)
app.get('*', (c) => {
  const fullPath = c.req.path.replace(/^\//, '')
  if (
    fullPath.startsWith('api') ||
    fullPath.startsWith('static') ||
    fullPath.startsWith('docs') ||
    fullPath.startsWith('openapi.json')
  ) {
    return c.json({ detail: 'Not found' }, 404)
  }
  return serveIndex(c)
})

const port = Number(process.env.PORT ?? 5611)

// --- startup ---------------------------------------------------------------

ensureSchema()
seedDatabase()

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  logger.info(`Trading API listening on http://0.0.0.0:${info.port}`)
})

injectWebSocket(server)

// Initialize all services (scheduler, market data tasks, auto trading, etc.)
void initializeServices().catch((e) =>
  logger.error(`Service initialization failed: ${e}`),
)

// --- shutdown --------------------------------------------------------------

let shuttingDown = false
function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`Received ${signal}, shutting down...`)
  shutdownServices()
  server.close(() => process.exit(0))
  // Don't hang forever on lingering sockets
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

export { app }
