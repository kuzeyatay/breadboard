import "server-only";

import { ApiError } from "../hermes/route-core.ts";
import { getScheduledChatJobStore } from "./instance.ts";
import { presentScheduledChatJob } from "./store.ts";
import {
  scheduledChatReceiptFromJob,
  type ScheduledChatReceipt,
} from "./types.ts";

/**
 * Resolve a browser-provided id back through the authenticated schedule store.
 * The client never gets to invent the title or timing persisted in a receipt.
 */
export function scheduledChatReceiptForUser(
  userId: number,
  value: unknown,
): ScheduledChatReceipt | undefined {
  if (value === undefined || value === null) return undefined;
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(
      400,
      "invalid_schedule_receipt",
      "The schedule receipt is invalid.",
    );
  }
  const row = getScheduledChatJobStore().get(userId, id);
  if (!row) {
    throw new ApiError(
      404,
      "schedule_receipt_not_found",
      "That scheduled task no longer exists.",
    );
  }
  return scheduledChatReceiptFromJob(presentScheduledChatJob(row));
}
