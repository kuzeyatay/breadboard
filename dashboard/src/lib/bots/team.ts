// Who answers a turn, and what the answering bot knows about its team.
//
// The model is the one orgo-teammates and rakazo share (both alternatives to
// Grok Bot): Bread is the primary bot — Breadboard's own runtime, Hermes, with
// no persona — and every other bot is a teammate you pull in with @mentions.
//
// - A message that names no bot goes to the chat's own bot (Bread, or the bot
//   whose dedicated chat this is).
// - "@bread" always gets Bread, even inside another bot's chat.
// - "@sage …" anywhere in any chat makes Sage answer that message.
// - Two or more bots named: Bread coordinates. It hands each one its part with
//   Hermes' own `delegate_task` ([persona: bot-<handle>], resolved by
//   /api/hermes/tools/system-prompts) and replies with their answers credited.
//
// Delegation needs no tool of its own: `delegate_task` is on every Breadboard
// session (adapters/hermes.ts), and its persona tag already round-trips through
// Breadboard, which is where the user's bots live.

import { boundPromptContext } from "../hermes/prompt-budget.ts";
import { botsStore } from "./server.ts";
import { BREAD_BOT_HANDLE, botHandle, routeTurn } from "./mentions.ts";
export { botByHandle } from "./mentions.ts";
import { conversationPersonalityPrompt, type BotDefinition } from "./types.ts";

/** Persona-tag prefix that marks a bot rather than an agency-agents specialist. */
export const BOT_PERSONA_PREFIX = "bot-";
// ponytail: roster capped so the persona budget holds; rank by recency if 100-bot rosters get common.
const MAX_ROSTER = 24;
const ROSTER_BUDGET = 2_800;

function rosterSection(bots: readonly BotDefinition[], respondent: BotDefinition | null, tools: boolean): string {
  const lines = [
    "# Your team",
    `Bread (@${BREAD_BOT_HANDLE}) is the primary bot: Breadboard's own assistant with the full tools, memory and skills. A message that names no bot is answered by the chat's own bot, which is Bread unless this is a bot's dedicated chat.`,
    respondent
      ? `You are answering as ${respondent.name}. The rest of the team:`
      : "The other bots on the user's team, each a personality over the same runtime:",
    ...bots
      .filter((bot) => bot.id !== respondent?.id)
      .slice(0, MAX_ROSTER)
      .map((bot) => `- @${botHandle(bot.name)} — ${bot.name}${bot.description ? `: ${bot.description}` : ""}`),
  ];
  if (tools) {
    lines.push(
      `To hand a teammate part of the work, call delegate_task with the goal starting "[persona: ${BOT_PERSONA_PREFIX}<handle>]" (for example "[persona: ${BOT_PERSONA_PREFIX}${botHandle(bots[0]?.name ?? "sage")}] …"). It works with that bot's personality and your tools, and its result comes back to you; pass it on credited to that bot by name. Delegate when the user asks you to, or when a teammate's strength genuinely fits part of the job, never for a quick question you can answer yourself.`,
      // orgo-teammates / rakazo: every bot has the computer, apps and routines; here they are Bread's own.
      "Every bot works with Bread's full toolset: the computer and browser, the user's connected apps, files and the web. A personality changes the voice, never the tools.",
      `A routine belongs to a bot when its prompt starts with that bot's handle: schedule_create with a prompt like "@${botHandle(respondent?.name ?? bots[0]?.name ?? "sage")} …" runs as that bot every time, and a prompt with no handle runs as Bread.`,
    );
  }
  return lines.join("\n");
}

/**
 * A bot's own memories for this request (orgo-teammates' bounded memory
 * section), and how to add to them. Bread has none here: its memory is the
 * account's own.
 */
export function botMemorySection(userId: number, bot: BotDefinition, query: string, tools = true): string {
  let memories: { id: number; text: string }[] = [];
  try { memories = botsStore().recall(userId, bot.id, query, 15); } catch { /* never fail a turn on memory */ }
  const lines = [
    `## What ${bot.name} remembers`,
    ...(memories.length ? memories.map((memory) => `- [${memory.id}] ${memory.text}`) : ["Nothing yet."]),
  ];
  if (tools) lines.push(`These are ${bot.name}'s own memories, separate from the account's. When you learn something durable about the user or your job as ${bot.name}, save it with bot_memory (action "remember", bot "${botHandle(bot.name)}"), not save_memory, which is Bread's; "recall" searches, "forget" drops one by its number.`);
  return boundPromptContext(lines.join("\n"), 1_800);
}

/**
 * The bot answering a message (null for Bread). save_memory uses it to keep a
 * bot's "remember this" in that bot's own memory even when the model reaches
 * for the account tool.
 */
export function turnRespondent(userId: number, conversationPublicId: string, text: string, inRoom = false): BotDefinition | null {
  try {
    const conversationBot = botsStore().forConversation(userId, conversationPublicId);
    return inRoom ? conversationBot : routeTurn(text, botsStore().list(userId), conversationBot).respondent;
  } catch {
    return null;
  }
}

/**
 * The persona slot for a turn: the answering bot's personality (none for
 * Bread), the team roster, and — when the message named several bots — the
 * instruction to coordinate them. `tools` is false on the provider-only
 * pipeline, which cannot delegate.
 */
export function botTurnPersona(input: {
  userId: number;
  conversationPublicId: string;
  text: string;
  specialistPersona?: string;
  tools?: boolean;
  /**
   * A Buzz room member's hidden conversation. Its prompt lists every member as
   * "@handle", so mentions there are the room's business (lib/buzz/mentions.ts),
   * not a request to switch who answers.
   */
  inRoom?: boolean;
}): string {
  const tools = input.tools !== false;
  let bots: BotDefinition[] = [];
  let conversationBot: BotDefinition | null = null;
  try {
    bots = botsStore().list(input.userId);
    conversationBot = botsStore().forConversation(input.userId, input.conversationPublicId);
  } catch {
    // A roster lookup must never fail the turn; Bread answers alone.
  }
  const { respondent, coordinate } = input.inRoom
    ? { respondent: conversationBot, coordinate: [] }
    : routeTurn(input.text, bots, conversationBot);
  const notes: string[] = [];
  if (respondent && respondent.id !== conversationBot?.id) {
    notes.push(`The user @mentioned you, ${respondent.name}, so you answer this message in this chat.`);
  }
  if (coordinate.length) {
    const names = coordinate.map((bot) => bot.name).join(", ");
    notes.push(
      tools
        ? `This message @mentions ${names}. You are Bread, coordinating: give each named bot its part with delegate_task ("[persona: ${BOT_PERSONA_PREFIX}<handle>] …"), in parallel where the parts are independent, then reply with each bot's answer under its name (**Name:** …), adding only what ties them together.`
        : `This message @mentions ${names}. Answer as Bread, and answer each bot's part in turn under its name (**Name:** …), in that bot's voice as described below.`,
    );
  }
  const persona = [
    conversationPersonalityPrompt(respondent, input.specialistPersona),
    respondent ? botMemorySection(input.userId, respondent, input.text, tools) : "",
    notes.join("\n"),
  ].filter(Boolean).join("\n\n");
  // The system prompt reserves 8,000 characters for the persona; the roster is
  // what gives way.
  const team = bots.length
    ? boundPromptContext(rosterSection(bots, respondent, tools), Math.min(ROSTER_BUDGET, 8_000 - persona.length - 2))
    : "";
  return [persona, team].filter(Boolean).join("\n\n");
}
