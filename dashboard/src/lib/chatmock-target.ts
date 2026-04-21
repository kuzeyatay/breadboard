export const CHATMOCK_TARGET_COOKIE = "sb_chatmock_target";

export const CHATMOCK_TARGETS = ["localhost", "host"] as const;

export type ChatmockTarget = (typeof CHATMOCK_TARGETS)[number];

export const DEFAULT_CHATMOCK_TARGET: ChatmockTarget = "localhost";

export function normalizeChatmockTarget(value: unknown): ChatmockTarget {
  return value === "host" ? "host" : DEFAULT_CHATMOCK_TARGET;
}
