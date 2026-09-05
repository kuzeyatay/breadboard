import "server-only";

import { ApiError } from "../hermes/route-core.ts";
import { describeLeadTime } from "../calendar/reminder-request.ts";
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
  const store = getScheduledChatJobStore();
  const row = store.get(userId, id);
  if (!row) {
    throw new ApiError(
      404,
      "schedule_receipt_not_found",
      "That scheduled task no longer exists.",
    );
  }
  if (row.prompt_slug?.startsWith("class-reminders:")) {
    const batch = store
      .list(userId)
      .filter((candidate) => candidate.prompt_slug === row.prompt_slug);
    const next = [...batch]
      .filter((candidate) => candidate.enabled === 1)
      .sort((left, right) => left.next_run_at.localeCompare(right.next_run_at))[0] ?? row;
    const lead = Number(row.prompt_slug.split(":").at(-1));
    const channel = row.delivery_channel === "telegram"
      ? "Telegram with chat fallback"
      : row.delivery_channel === "whatsapp"
        ? "WhatsApp with chat fallback"
        : "Breadboard chat";
    return {
      id: row.id,
      title: `${batch.length} class reminder${batch.length === 1 ? "" : "s"} for today`,
      cronDescription: `${describeLeadTime(lead)} before each · ${channel}`,
      oneShot: true,
      nextRunAt: next.next_run_at,
      batchCount: batch.length,
    };
  }
  return scheduledChatReceiptFromJob(presentScheduledChatJob(row));
}
