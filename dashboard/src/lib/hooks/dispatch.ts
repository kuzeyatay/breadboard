// Turning an accepted webhook delivery into an action: either a native
// workflow run (ENGINE agent's runWorkflowById) or a programmatic chat turn
// (the same recipe app/api's own runScheduledChatJob uses — see
// src/lib/schedules/runner.ts). Called fire-and-forget from the receive
// route: the webhook response must not block on a chat turn or workflow run,
// so dispatchHook never throws — every failure path is caught and logged.

import { createConversation } from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { startSessionEventPump } from "@/lib/hermes/event-stream.ts";
import { requireEnabled } from "@/lib/hermes/route-core.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "@/lib/hermes/session-service.ts";
import type { HookRow } from "./store.ts";

const MAX_PAYLOAD_CHARS = 8_000;

function formatPayloadForChat(payload: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2) ?? "null";
  } catch {
    json = String(payload);
  }
  const truncated = json.length > MAX_PAYLOAD_CHARS;
  const body = truncated ? `${json.slice(0, MAX_PAYLOAD_CHARS)}\n… (truncated)` : json;
  return `\n\nHook event payload:\n\`\`\`json\n${body}\n\`\`\``;
}

function hookConversationTitle(hook: HookRow): string {
  return `Hook: ${hook.name}`.slice(0, 120);
}

/**
 * Run the hook's chat instructions as a brand-new chat, mirroring
 * runScheduledChatJob (src/lib/schedules/runner.ts): create a conversation,
 * attach the event pump before dispatch, then send the prompt through the
 * same authenticated pipeline the browser uses. There is no user present to
 * answer a permission prompt, so "awaiting_permission" and clarification
 * outcomes are logged rather than retried.
 *
 * A hook bound to a garden runs in that garden, on the garden surface and with
 * the garden's context, exactly as a garden-scoped schedule does. Access is
 * re-checked on every firing rather than trusted from creation time: a garden
 * can be deleted or unshared while a hook keeps receiving events.
 */
async function dispatchChatHook(hook: HookRow, payload: unknown): Promise<void> {
  requireEnabled();

  const gardenSlug = hook.garden_slug?.trim() || null;
  let garden: { clusterId: number; slug: string } | null = null;
  if (gardenSlug) {
    try {
      garden = authorizeGardenAccess(hook.user_id, gardenSlug);
    } catch {
      console.warn(
        `[hooks] hook ${hook.id} names garden "${gardenSlug}", which is no longer readable; the event is dropped.`,
      );
      return;
    }
  }
  const surface = garden ? ("garden_chat" as const) : ("dashboard_terminal" as const);

  const conversation = createConversation({
    userId: hook.user_id,
    title: hookConversationTitle(hook),
    surface,
    scopeKind: garden ? "garden" : "global",
    defaultGardenId: garden?.clusterId ?? null,
    hookId: hook.id,
  });

  const runtime = await resolveConversationRuntime({
    conversation,
    surface,
    activeGardenSlug: garden?.slug ?? null,
    activePageSlug: null,
  });
  startSessionEventPump(runtime);

  const text = `${hook.chat_instructions ?? ""}${formatPayloadForChat(payload)}`;

  const result = await startConversationTurn({
    conversation,
    clientMessageId: `hook-${hook.id}-${Date.now()}`,
    text,
    surface,
    ...(garden ? { surfaceContext: { activeGardenSlug: garden.slug } } : {}),
  });

  if (result.accepted) return;
  if ("blocked" in result) {
    console.warn(
      `[hooks] hook ${hook.id} needs a permission decision to proceed; no user is present to answer it.`,
    );
    return;
  }
  if ("clarified" in result) {
    console.warn(`[hooks] hook ${hook.id} turn was not accepted: ${result.message}`);
    return;
  }
  console.warn(`[hooks] hook ${hook.id} turn was not accepted by the runtime.`);
}

/**
 * Run the hook's target workflow. Imported lazily inside the function body
 * (not a top-level import) so a hooks-only test file that never touches
 * workflow dispatch does not have to satisfy the ENGINE agent's module graph.
 */
async function dispatchWorkflowHook(hook: HookRow, payload: unknown): Promise<void> {
  if (!hook.workflow_id) {
    console.warn(`[hooks] hook ${hook.id} is in workflow mode but has no workflow_id.`);
    return;
  }
  const { runWorkflowById } = await import("@/lib/workflows/native-execution");
  await runWorkflowById({
    workflowId: hook.workflow_id,
    input: payload,
    triggerKind: "webhook",
    userId: hook.user_id,
  });
}

/** Fire-and-forget entry point. Never throws — every failure is caught and logged. */
export function dispatchHook(hook: HookRow, payload: unknown): void {
  const run = hook.mode === "workflow" ? dispatchWorkflowHook(hook, payload) : dispatchChatHook(hook, payload);
  run.catch((error) => {
    console.error(`[hooks] dispatch failed for hook ${hook.id} (${hook.mode})`, error);
  });
}
