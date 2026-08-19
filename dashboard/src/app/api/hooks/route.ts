import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import db from "@/lib/db.ts";
import {
  createHook,
  getHookByIdForUser,
  listHooksForUser,
  updateHook,
  type HookRow,
} from "@/lib/hooks/store.ts";
import {
  createTelegramSubscription,
  type TelegramSubscriptionResult,
} from "@/lib/sim/triggers/providers/telegram";
import { buildWebhookTriggerUrl } from "@/lib/sim/triggers/webhook-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function presentHook(hook: HookRow) {
  let providerConfig: Record<string, unknown> = {};
  try {
    providerConfig = JSON.parse(hook.provider_config || "{}");
  } catch {
    providerConfig = {};
  }
  // Secrets never leave the server: strip anything that reads like a token,
  // secret, or key before this row is sent to the browser.
  const redacted = Object.fromEntries(
    Object.entries(providerConfig).filter(
      ([key]) => !/token|secret|key/i.test(key),
    ),
  );

  return {
    id: hook.id,
    name: hook.name,
    provider: hook.provider,
    mode: hook.mode,
    workflowId: hook.workflow_id,
    chatInstructions: hook.chat_instructions,
    providerConfig: redacted,
    enabled: hook.enabled === 1,
    gardenSlug: hook.garden_slug ?? null,
    createdAt: hook.created_at,
    lastFiredAt: hook.last_fired_at,
    fireCount: hook.fire_count,
    url: buildWebhookTriggerUrl(hook.id),
  };
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    // A garden asks only for its own hooks; the Terminal asks for all of them.
    const gardenSlug = new URL(request.url).searchParams.get("gardenSlug");
    const hooks = listHooksForUser(userId, db, { gardenSlug }).map(presentHook);
    return NextResponse.json({ hooks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    const providerConfig = (body.providerConfig as Record<string, unknown> | undefined) ?? {};

    const hook = createHook(
      userId,
      {
        name: typeof body.name === "string" ? body.name : "",
        provider: typeof body.provider === "string" ? body.provider : "",
        mode: body.mode === "workflow" ? "workflow" : "chat",
        workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
        chatInstructions: typeof body.chatInstructions === "string" ? body.chatInstructions : null,
        providerConfig,
        enabled: body.enabled !== false,
        gardenSlug: typeof body.gardenSlug === "string" ? body.gardenSlug : null,
      },
      db,
    );

    // Telegram is the one provider Breadboard registers proactively: a bot
    // token is useless to the user until Telegram is told where to deliver
    // updates. The other providers (GitHub, Stripe, Slack, Linear, GitLab)
    // are configured by pasting Breadboard's URL into their own dashboards —
    // there is nothing for Breadboard to call on create.
    let telegramWarning: string | undefined;
    if (hook.provider === "telegram") {
      const botToken = providerConfig.botToken as string | undefined;
      if (botToken) {
        const secretToken = crypto.randomUUID().replaceAll("-", "");
        const result: TelegramSubscriptionResult = await createTelegramSubscription(
          botToken,
          buildWebhookTriggerUrl(hook.id),
          secretToken,
        );
        if (result.ok) {
          updateHook(
            hook.id,
            userId,
            { providerConfig: { ...providerConfig, secretToken } },
            db,
          );
        } else {
          telegramWarning = result.error;
        }
      }
    }

    const stored = getHookByIdForUser(hook.id, userId, db) ?? hook;
    return NextResponse.json({ hook: presentHook(stored), telegramWarning }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
