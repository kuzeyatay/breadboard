// Breadboard-owned hook triggers other than "chat completed": a chat starting,
// a prompt being sent, a tool starting or finishing. They mirror Codex's
// SessionStart, UserPromptSubmit, PreToolUse and PostToolUse events, with one
// difference stated plainly: these fire as notifications after the app has
// already acted, so a hook observes the event and cannot block or rewrite it.

import "server-only";

import db from "@/lib/db.ts";
import { hookMatcherMatches, type LifecycleHookProvider } from "./natural-language.ts";
import {
  listEnabledChatCompletionHooks,
  recordDelivery,
  recordHookFire,
  type HookRow,
} from "./store.ts";

/**
 * Hand one event to every hook whose matcher accepts it, exactly once per
 * delivery key. Shared with the chat-completed trigger.
 */
export function deliverLifecycleEvent(
  hooks: HookRow[],
  input: { deliveryKey: string; matchText: string; payload: unknown },
): void {
  for (const hook of hooks) {
    let matcher: unknown;
    try {
      matcher = JSON.parse(hook.provider_config || "{}").matcher;
    } catch {
      matcher = undefined;
    }
    if (!hookMatcherMatches(matcher, input.matchText)) continue;
    if (!recordDelivery(hook.id, input.deliveryKey, db)) continue;
    recordHookFire(hook.id, db);
    void import("./dispatch.ts")
      .then(({ dispatchHook }) => dispatchHook(hook, input.payload))
      .catch((error) => {
        console.error(`[hooks] lifecycle dispatch failed for hook ${hook.id}`, error);
      });
  }
}

interface LifecycleConversationRow {
  public_id: string;
  user_id: number;
  title: string;
  surface: string;
  temporary: number;
  hook_id: string | null;
  garden_slug: string | null;
}

/**
 * Fire the hooks for one lifecycle event in one conversation. Never throws:
 * hooks are automation around a chat and must not be able to fail it.
 *
 * A conversation a hook itself started is skipped, as is a temporary chat. The
 * first is the recursion guard — a hook that starts a chat must not be able to
 * trigger itself through that chat's own prompts and tools.
 */
export function fireLifecycleHooks(input: {
  event: Exclude<LifecycleHookProvider, "chat_completed">;
  conversationId: number;
  /** Unique per occurrence, e.g. a tool call id. */
  occurrenceId: string;
  /** What the hook's matcher is tested against: a tool name, or prompt text. */
  matchText: string;
  detail?: Record<string, unknown>;
}): void {
  try {
    const conversation = db
      .prepare(
        `SELECT c.public_id, c.user_id, c.title, c.surface, c.temporary, c.hook_id,
                clusters.slug AS garden_slug
         FROM conversations c
         LEFT JOIN clusters ON clusters.id = c.default_garden_id
         WHERE c.id = ?`,
      )
      .get(input.conversationId) as LifecycleConversationRow | undefined;
    if (!conversation || conversation.temporary === 1 || conversation.hook_id) return;

    const hooks = listEnabledChatCompletionHooks(
      conversation.user_id,
      conversation.garden_slug,
      db,
      input.event,
    );
    if (hooks.length === 0) return;

    deliverLifecycleEvent(hooks, {
      deliveryKey: `${input.event}:${input.occurrenceId}`,
      matchText: input.matchText,
      payload: {
        event: input.event.replace("_", "."),
        firedAt: new Date().toISOString(),
        conversation: {
          id: conversation.public_id,
          title: conversation.title,
          surface: conversation.surface,
          gardenSlug: conversation.garden_slug,
        },
        ...input.detail,
      },
    });
  } catch (error) {
    console.error(`[hooks] failed to evaluate ${input.event} hooks`, error);
  }
}
