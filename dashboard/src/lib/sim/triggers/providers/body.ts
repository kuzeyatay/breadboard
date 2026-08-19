// Pruned from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/processor.ts
// (parseWebhookBody), adapted for Breadboard. Sim's version also enforces a
// byte-size cap while streaming the request body; Breadboard's receive route
// reads the body with `request.text()` (Next.js already caps request size at
// the platform level), so only the content-type branching is kept here.

/**
 * Parse a raw webhook body string per its content-type. Returns `null` on a
 * parse failure so the caller can answer 400 rather than crash.
 */
export function parseHookBody(rawBody: string, contentType: string): unknown {
  if (!rawBody) return {}

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      // Slack's slash-command and interactivity payloads sometimes arrive as a
      // single `payload` field carrying JSON (see slack.ts's formatInput).
      const payloadString = formData.get('payload')
      if (payloadString) return JSON.parse(payloadString)
      return Object.fromEntries(formData.entries())
    }
    return JSON.parse(rawBody)
  } catch {
    return null
  }
}
