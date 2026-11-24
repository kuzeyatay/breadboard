// `bot_manage` — Bread makes, changes and removes the user's bots from plain
// requests ("make me a chess coach", "make Sage stricter", "give Rook a red
// avatar"). The model chooses every field; anything it leaves out gets a
// sensible default here, so one word from the user is enough. Scoped like
// bot_memory: only the session user's own roster.

import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { botsStore } from "@/lib/bots/server.ts";
import { BotStoreError } from "@/lib/bots/store.ts";
import { BREAD_BOT_HANDLE, botByHandle, botHandle } from "@/lib/bots/mentions.ts";
import { WORK_RULES } from "@/lib/bots/presets.ts";
import { BOT_SHAPES, type BotDefinition } from "@/lib/bots/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "bot_manage";
const COLORS = ["#48b9ef", "#f3c849", "#4cdb83", "#809bd4", "#ac7bea", "#ef7a6b", "#f29e4c", "#5fd3c6"];
// A one-line persona makes a bot that only chats; ask the model for the job.
const MIN_PERSONALITY = 200;
const THIN_PERSONALITY = `Write a fuller personality (at least ${MIN_PERSONALITY} characters): "You are <name>, the user's <role>." then what it works from, its method, what it delivers (with tool names), its quality bar, and which teammate it hands off to.`;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);

/** Every bot is a working teammate: the team's rules end its personality. */
function withWorkRules(personality: string): string {
  return personality.includes(WORK_RULES) ? personality : `${personality} ${WORK_RULES}`;
}

/** Fill what the model left out; a name hash keeps the same bot's look stable. */
export function completeBotInput(args: Record<string, unknown>, current?: BotDefinition): Record<string, unknown> {
  const name = text(args.name) || current?.name || "";
  const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const avatar = args.avatar && typeof args.avatar === "object" ? args.avatar as Record<string, unknown> : {};
  const base = current?.avatar;
  const personality = text(args.personality);
  return {
    name,
    description: text(args.description) ?? current?.description ?? "",
    personality: personality ? withWorkRules(personality) : current?.personality ?? "",
    avatar: {
      shape: BOT_SHAPES.includes(avatar.shape as never) ? avatar.shape : base?.shape ?? BOT_SHAPES[hash % BOT_SHAPES.length],
      color: typeof avatar.color === "string" && /^#[0-9a-f]{6}$/i.test(avatar.color) ? avatar.color : base?.color ?? COLORS[hash % COLORS.length],
      face: avatar.face === "mouth" || avatar.face === "eyes" ? avatar.face : base?.face ?? (hash % 2 ? "mouth" : "eyes"),
    },
    effort: args.effort === undefined ? current?.effort ?? null : args.effort,
  };
}

function summary(bot: BotDefinition) {
  return { name: bot.name, handle: botHandle(bot.name), description: bot.description, avatar: bot.avatar, effort: bot.effort };
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "bot_manage_capability_denied", "Managing bots is not authorized for this turn.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session || !session.user_id || session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id) {
      throw new ApiError(403, "bot_manage_session_scope_mismatch", "Bot management session scope is invalid.");
    }
    const userId = session.user_id;
    const body = await readJsonBody(request, 32 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
    const store = botsStore();
    const roster = store.list(userId);
    const action = args.action ?? "create";

    // A clashing handle would make @mentions ambiguous: the model picks another name.
    const claim = (name: unknown, self?: BotDefinition) => {
      const handle = botHandle(String(name ?? ""));
      const holder = botByHandle(roster, handle);
      if (!handle || handle === BREAD_BOT_HANDLE || (holder && holder.id !== self?.id)) {
        throw new ApiError(409, "bot_manage_name_taken", `@${handle || "?"} is already taken on this team; choose a different name.`);
      }
    };
    const target = () => {
      const handle = String(args.bot ?? "").trim().replace(/^@/, "").toLowerCase();
      if (handle === BREAD_BOT_HANDLE) throw new ApiError(400, "bot_manage_bread", "Bread is Breadboard itself and cannot be changed or removed here.");
      const bot = botByHandle(roster, handle);
      if (!bot) throw new ApiError(404, "bot_manage_unknown_bot", `No bot is mentioned as @${handle || "?"} on this team. The team: ${roster.map((b) => `@${botHandle(b.name)}`).join(", ")}.`);
      return bot;
    };

    if (action === "create") {
      const input = completeBotInput(args);
      claim(input.name);
      if (String(text(args.personality) ?? "").length < MIN_PERSONALITY) throw new ApiError(400, "bot_manage_thin_personality", THIN_PERSONALITY);
      const bot = store.save(userId, input);
      // Starting knowledge from the request ("for my calculus exam on 12 Jan").
      const memories = (Array.isArray(args.memories) ? args.memories : []).slice(0, 10)
        .map((memory) => text(memory)).filter((memory): memory is string => Boolean(memory));
      for (const memory of memories) store.remember(userId, bot.id, memory);
      const handle = botHandle(bot.name);
      return NextResponse.json({ ok: true, data: {
        created: { ...summary(bot), memories: memories.length },
        note: `Tell the user ${bot.name} is ready: they can @${handle} in any chat or open its chat from the Bots panel. If the job is recurring (a daily brief, a weekly review, watching a page), offer or set a routine with schedule_create and a prompt starting "@${handle}".`,
      } });
    }
    if (action === "update") {
      const current = target();
      if (text(args.name)) claim(args.name, current);
      const personality = text(args.personality);
      if (personality !== undefined && personality.length < MIN_PERSONALITY) throw new ApiError(400, "bot_manage_thin_personality", THIN_PERSONALITY);
      const bot = store.save(userId, completeBotInput(args, current), current.id);
      return NextResponse.json({ ok: true, data: { updated: summary(bot) } });
    }
    if (action === "remove") {
      const bot = target();
      // Archived, not deleted: its chats and memories stay, and it leaves the roster.
      store.archive(userId, bot.id);
      return NextResponse.json({ ok: true, data: { removed: bot.name } });
    }
    throw new ApiError(400, "bot_manage_action", 'action must be "create", "update" or "remove".');
  } catch (error) {
    if (error instanceof BotStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
