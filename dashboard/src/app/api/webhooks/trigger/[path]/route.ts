// External entry point for real inbound webhooks ("Hooks"). No session auth
// on this route by design: it is the public callback URL an external service
// (GitHub, Stripe, Telegram, ...) posts to, and Next's proxy.ts matcher list
// does not include /api/* — this route is exempt from the login redirect the
// same way every other /api handler is, so path secrecy (a 21-char random id)
// plus the provider's own signature/token verification IS the auth.
//
// Deliberately linear and short: read the raw body first (HMAC needs the
// exact bytes, before any JSON re-serialization could change them), look up
// the hook, verify, filter, dedupe, then hand off to dispatch.ts without
// awaiting it — the external caller gets its 200 back immediately rather than
// waiting on a chat turn or workflow run.

import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db.ts";
import { getHookById, recordDelivery, recordHookFire } from "@/lib/hooks/store.ts";
import { dispatchHook } from "@/lib/hooks/dispatch.ts";
import { getProviderHandler } from "@/lib/sim/triggers/providers/registry";
import { parseHookBody } from "@/lib/sim/triggers/providers/body";
import { createWebhookIdempotencyKey } from "@/lib/sim/triggers/idempotency";
import type {
  AuthContext,
  EventFilterContext,
  EventMatchContext,
  FormatInputContext,
} from "@/lib/sim/triggers/providers/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function headersToRecord(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/** Reachability/setup probe: 200 when the path names a live, enabled hook. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const hook = getHookById(path, db);
  if (!hook || hook.enabled !== 1) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const requestId = crypto.randomUUID();

  const hook = getHookById(path, db);
  if (!hook || hook.enabled !== 1) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const rawBody = await request.text();
  const handler = getProviderHandler(hook.provider);
  let providerConfig: Record<string, unknown>;
  try {
    providerConfig = JSON.parse(hook.provider_config || "{}");
  } catch {
    providerConfig = {};
  }

  const body = parseHookBody(rawBody, request.headers.get("content-type") || "");

  // Slack's url_verification handshake must be answered before signature
  // verification (the handshake POST carries no signature at all).
  if (handler.handleChallenge) {
    const challenge = await handler.handleChallenge(body, request, requestId, path, rawBody);
    if (challenge) return challenge;
  }

  if (body === null) {
    return new NextResponse("Invalid payload format", { status: 400 });
  }

  const webhookRecord: Record<string, unknown> = { id: hook.id, provider: hook.provider };
  const workflowRecord: Record<string, unknown> = { id: hook.workflow_id ?? "" };

  const authCtx: AuthContext = {
    webhook: webhookRecord,
    workflow: workflowRecord,
    request,
    rawBody,
    requestId,
    providerConfig,
  };
  const authError = await handler.verifyAuth?.(authCtx);
  if (authError) return authError;

  const matchCtx: EventMatchContext = {
    webhook: webhookRecord,
    workflow: workflowRecord,
    body,
    request,
    requestId,
    providerConfig,
  };
  const matchResult = await handler.matchEvent?.(matchCtx);
  if (matchResult instanceof NextResponse) return matchResult;
  if (matchResult === false) {
    return NextResponse.json({ message: "Event skipped" });
  }

  const filterCtx: EventFilterContext = { webhook: webhookRecord, body, requestId, providerConfig };
  if (handler.shouldSkipEvent?.(filterCtx)) {
    return NextResponse.json({ message: "Event skipped" });
  }

  const headers = headersToRecord(request);
  handler.enrichHeaders?.(filterCtx, headers);

  const idempotencyKey = createWebhookIdempotencyKey(hook.id, headers, () =>
    handler.extractIdempotencyId ? handler.extractIdempotencyId(body) : null,
  );
  const isNewDelivery = recordDelivery(hook.id, idempotencyKey, db);
  if (!isNewDelivery) {
    return NextResponse.json({ message: "Duplicate delivery, skipped" });
  }

  let payload: unknown = body;
  if (handler.formatInput) {
    const formatCtx: FormatInputContext = {
      webhook: webhookRecord,
      workflow: { id: hook.workflow_id ?? "", userId: String(hook.user_id) },
      body,
      headers,
      requestId,
    };
    const formatted = await handler.formatInput(formatCtx);
    if (formatted.skip) {
      return NextResponse.json({ message: formatted.skip.message });
    }
    payload = formatted.input;
  }

  recordHookFire(hook.id, db);
  // Fire-and-forget: the external caller must not wait on a chat turn or a
  // workflow run. Failures are caught and logged inside dispatchHook itself.
  dispatchHook(hook, payload);

  return handler.formatSuccessResponse?.(providerConfig) ?? NextResponse.json({ message: "Webhook processed" });
}
