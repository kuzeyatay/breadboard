// Whether Breadboard may text the owner on Telegram, unprompted, when work
// running while they are away needs them. On by default (Settings → Telegram).

import { telegramFeatureEnabled } from "./config.ts";
import { hasBotToken } from "./credentials.ts";
import { getTelegramStore } from "./instance.ts";

export function telegramAttentionAlertsOn(userId: number): boolean {
  if (!telegramFeatureEnabled() || !hasBotToken()) return false;
  const settings = getTelegramStore().settings();
  return settings.ownerUserId === userId && settings.attentionAlerts;
}
