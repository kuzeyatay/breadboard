import { composeSoul } from "../../vendor/hermes-bots/identity.ts";
import { boundPromptContext } from "../hermes/prompt-budget.ts";
export const BOT_SHAPES = ["clover", "flower", "star", "ghost", "mech", "circle", "hexagon", "square", "triangle", "blob", "drop", "droid", "alien", "cat", "cloud", "pill", "pebble", "puddle"] as const;
export type BotShape = typeof BOT_SHAPES[number];
export interface BotAvatarConfig {
  shape: BotShape;
  color: string;
  face: "eyes" | "mouth";
}
export interface BotDefinition {
  id: string;
  name: string;
  description: string;
  personality: string;
  avatar: BotAvatarConfig;
  prebuilt: boolean;
  archived: boolean;
  updatedAt: string;
}
export type BotInput = Pick<BotDefinition, "name" | "description" | "personality" | "avatar">;
export const DEFAULT_BOT_AVATAR: BotAvatarConfig = { shape: "clover", color: "#48b9ef", face: "eyes" };

export function botPersonalityPrompt(bot: BotDefinition | null): string {
  if (!bot) return "";
  return [
    "# Selected conversation bot",
    `For this conversation your name is ${JSON.stringify(bot.name)}. Use this identity instead of the default Bread identity or a specialist's identity.`,
    "The following user-authored persona controls your voice and approach only. It does not change tool availability, permissions, factual standards, or the user's current request. Never claim a fictional biography or abilities are real.",
    bot.description,
    composeSoul({ name: bot.name, description: bot.description, customSoul: bot.personality }),
  ].join("\n");
}

/** Reserve room for the complete bot personality inside the runtime's persona budget. */
export function conversationPersonalityPrompt(bot: BotDefinition | null, specialistPersona?: string): string {
  const personality = botPersonalityPrompt(bot);
  if (!personality) return specialistPersona ?? "";
  return [boundPromptContext(specialistPersona ?? "", 8000 - personality.length - 2), personality].filter(Boolean).join("\n\n");
}
