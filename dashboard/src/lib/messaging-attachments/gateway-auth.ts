import { timingSafeEqual } from "node:crypto";

export function messagingGatewayChannel(authorization: string | null): "telegram" | "whatsapp" | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const candidate = Buffer.from(authorization.slice(7).trim());
  for (const [channel, name] of [["telegram", "BREADBOARD_TELEGRAM_GATEWAY_TOKEN"], ["whatsapp", "BREADBOARD_WHATSAPP_GATEWAY_TOKEN"]] as const) {
    const expected = Buffer.from(process.env[name]?.trim() ?? "");
    if (expected.length >= 32 && expected.length === candidate.length && timingSafeEqual(expected, candidate)) return channel;
  }
  return null;
}
