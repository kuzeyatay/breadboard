import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import {
  parseCalendarReminderRequest,
  planTodayClassReminders,
  type ReminderDeliveryPreference,
} from "@/lib/calendar/reminder-request.ts";
import { endOfDay, startOfDay, todayDate } from "@/lib/calendar/wallclock.ts";
import { telegramFeatureEnabled } from "@/lib/telegram/config.ts";
import { hasBotToken } from "@/lib/telegram/credentials.ts";
import { getTelegramStore } from "@/lib/telegram/instance.ts";
import { whatsAppFeatureEnabled } from "@/lib/whatsapp/config.ts";
import { normalizeWhatsAppIdentifier } from "@/lib/whatsapp/identity.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import {
  resolveTelegramSelfTarget,
  resolveWhatsAppSelfTarget,
} from "@/lib/messaging/self-target.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import { scheduledChatReceiptForUser } from "@/lib/schedules/receipt-server.ts";
import { ScheduleError } from "@/lib/schedules/store.ts";

export const dynamic = "force-dynamic";

type PhoneChannel = Exclude<ReminderDeliveryPreference, null>;

function availablePhoneChannel(
  userId: number,
  preferred: ReminderDeliveryPreference,
): PhoneChannel | null {
  const order: PhoneChannel[] = preferred === "whatsapp"
    ? ["whatsapp", "telegram"]
    : ["telegram", "whatsapp"];

  for (const channel of order) {
    if (channel === "telegram") {
      if (!telegramFeatureEnabled() || !hasBotToken()) continue;
      const store = getTelegramStore();
      const settings = store.settings();
      if (settings.ownerUserId !== userId || !settings.botId) continue;
      const target = resolveTelegramSelfTarget({
        linked: true,
        ownerUserId: settings.ownerUserId,
        chats: store.listChats(userId, 100),
      });
      if (target.ok) return "telegram";
      continue;
    }

    if (!whatsAppFeatureEnabled()) continue;
    const store = getWhatsAppStore();
    const settings = store.settings();
    if (settings.ownerUserId !== userId) continue;
    const target = resolveWhatsAppSelfTarget({
      linkedNumber: settings.linkedNumber,
      linkedName: settings.linkedName,
      chats: store.listChats(userId, 100),
      normalize: normalizeWhatsAppIdentifier,
    });
    if (target.ok) return "whatsapp";
  }
  return null;
}

function deliveryLabel(channel: PhoneChannel | null): string {
  return channel === "telegram"
    ? "Telegram, with Breadboard chat as fallback"
    : channel === "whatsapp"
      ? "WhatsApp, with Breadboard chat as fallback"
      : "Breadboard chat";
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const parsed = parseCalendarReminderRequest(prompt);
    if (!parsed) {
      throw new ScheduleError(
        400,
        "Ask for today's classes and say how long before each class to remind you.",
      );
    }

    const now = new Date();
    const date = todayDate(now);
    const calendarStore = getCalendarStore();
    const calendars = calendarStore.listCalendars(userId);
    const plan = planTodayClassReminders({
      request: parsed,
      calendars,
      occurrences: calendarStore.occurrencesInRange(
        userId,
        startOfDay(date),
        endOfDay(date),
      ),
      now,
    });
    if (plan.reminders.length === 0) {
      throw new ScheduleError(409, "There are no upcoming timed classes on your calendar today.");
    }

    const channel = availablePhoneChannel(userId, parsed.deliveryPreference);
    const batchSlug = `class-reminders:${date}:${parsed.leadMinutes}`;
    const scheduleStore = getScheduledChatJobStore();
    const existing = scheduleStore
      .list(userId)
      .filter((job) => job.prompt_slug === batchSlug && job.enabled === 1);
    const jobs = [];
    const createdIds: number[] = [];
    try {
      for (const reminder of plan.reminders) {
        const duplicate = existing.find((job) =>
          job.prompt === reminder.prompt &&
          (reminder.catchingUp || job.next_run_at === reminder.runAt),
        );
        if (duplicate) {
          jobs.push(duplicate);
          continue;
        }
        const created = scheduleStore.create(userId, {
          prompt: reminder.prompt,
          cron: "0 0 * * *",
          surface: "dashboard_terminal",
          promptSlug: batchSlug,
          model: typeof body.model === "string" ? body.model : undefined,
          reasoningEffort:
            typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined,
          deliveryChannel: channel,
          deliveryMode: "reminder",
          oneShot: true,
          runAt: reminder.runAt,
        }, now);
        createdIds.push(created.id);
        jobs.push(created);
      }
    } catch (error) {
      // A class request is one action. Do not leave half its reminders behind
      // when the schedule limit or validation rejects a later row.
      for (const id of createdIds) scheduleStore.delete(userId, id);
      throw error;
    }

    const first = [...jobs].sort((left, right) =>
      left.next_run_at.localeCompare(right.next_run_at),
    )[0];
    const receipt = scheduledChatReceiptForUser(userId, first.id);
    const catchUpCount = plan.reminders.filter((reminder) => reminder.catchingUp).length;
    const assumption = plan.usedTimedEventFallback
      ? " No event was explicitly labelled as a class, so I used all upcoming timed events."
      : "";
    const catchUp = catchUpCount > 0
      ? ` ${catchUpCount} reminder${catchUpCount === 1 ? "" : "s"} will arrive promptly because the requested lead time has already passed.`
      : "";

    return NextResponse.json({
      receipt,
      reminderCount: jobs.length,
      createdCount: createdIds.length,
      deliveryChannel: channel ?? "chat",
      message: `${jobs.length} class reminder${jobs.length === 1 ? "" : "s"} scheduled via ${deliveryLabel(channel)}.${assumption}${catchUp}`,
    }, { status: createdIds.length > 0 ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
