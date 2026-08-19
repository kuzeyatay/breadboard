// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/webhook-url.ts, adapted for Breadboard.
// Pruned to the one pure helper the triggers-report calls out: everything
// else in sim's file is editor-state (zustand store reads, blocks registry)
// that has no equivalent here.

/** Read NEXTAUTH_URL/VERCEL_URL the way the rest of the dashboard already does. */
function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function buildWebhookTriggerUrl(path: string): string {
  return `${getBaseUrl()}/api/webhooks/trigger/${path}`
}
