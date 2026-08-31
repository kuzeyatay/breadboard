import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { holdAgentRuntimeLease } from "@/lib/agent-runtime/wake.ts";
import { isSupervisorControlConfigured } from "@/lib/supervisor-control.ts";

// The wake proxy for messaging gateways. Gateway processes are deliberately
// not given the supervisor control capability, so they cannot start the
// on-demand Hermes service themselves; this loopback route lets them ask the
// dashboard — which does hold supervisor control — to acquire the Hermes lease
// on their behalf. It answers only to a caller presenting one of the gateway
// service tokens, and the only thing it can do is wake Hermes: the gateway
// still cannot reach any other supervisor surface.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;
const MIN_TOKEN_BYTES = 32;
const REASON_PATTERN = /^[a-z0-9-]{1,64}$/;

function configuredGatewayTokens(): Buffer[] {
  const tokens: Buffer[] = [];
  for (const name of [
    "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
    "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
  ] as const) {
    const value = process.env[name]?.trim() ?? "";
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength >= MIN_TOKEN_BYTES) tokens.push(bytes);
  }
  return tokens;
}

function authorized(request: Request, tokens: Buffer[]): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice(7).trim(), "utf8");
  return tokens.some(
    (token) =>
      candidate.byteLength === token.byteLength &&
      timingSafeEqual(candidate, token),
  );
}

async function wakeReason(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return null;
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).join(",") !== "reason") return null;
  return typeof record.reason === "string" && REASON_PATTERN.test(record.reason)
    ? record.reason
    : null;
}

function headers(): HeadersInit {
  return { "Cache-Control": "no-store, max-age=0" };
}

export async function POST(request: Request) {
  const tokens = configuredGatewayTokens();
  // Without a gateway token there is no legitimate caller for this route.
  if (tokens.length === 0) return new NextResponse(null, { status: 404 });
  if (!authorized(request, tokens)) {
    return NextResponse.json(
      { ok: false, code: "unauthorized" },
      { status: 401, headers: headers() },
    );
  }
  const reason = await wakeReason(request);
  if (!reason) {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400, headers: headers() },
    );
  }
  try {
    const supervised = isSupervisorControlConfigured()
      ? await holdAgentRuntimeLease(reason)
      : false;
    return NextResponse.json({ ok: true, supervised }, { headers: headers() });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "wake_failed",
        message:
          error instanceof Error
            ? error.message.slice(0, 2_048)
            : "The agent runtime could not be woken.",
      },
      { status: 503, headers: headers() },
    );
  }
}
