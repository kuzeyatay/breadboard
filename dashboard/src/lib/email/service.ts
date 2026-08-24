// The poll loop, and the settings operations behind it.
//
// Mail is polled rather than held open with IMAP IDLE. IDLE would deliver a
// few minutes sooner and would need reconnection, keepalive and re-selection
// logic to survive a laptop closing its lid — which is most of what makes a
// mail client complicated. Nobody is watching for an emailed reply the way
// they watch a chat, so the trade is a good one.

import { emailFeatureEnabled, emailTimings } from "./config.ts";
import { hasAccount, readAccount } from "./credentials.ts";
import { fetchUnread, type ImapMessage } from "./imap.ts";
import { routeEmailMessage } from "./inbound.ts";
import { sendMail } from "./smtp.ts";
import { pruneSeen, readSettings, saveSettings } from "./store.ts";

export interface EmailPollResult {
  fetched: number;
  answered: number;
  ignored: number;
  errors: string[];
}

interface ServiceGlobals {
  __breadboardEmailPoller?: ReturnType<typeof setInterval>;
  __breadboardEmailPolling?: boolean;
}

const globals = globalThis as typeof globalThis & ServiceGlobals;

/**
 * One pass: read what is unread, answer what should be answered.
 *
 * Never throws. A mailbox that is unreachable this cycle is recorded and
 * retried next cycle; there is nobody to hand an exception to.
 */
export async function pollEmailOnce(): Promise<EmailPollResult> {
  const result: EmailPollResult = { fetched: 0, answered: 0, ignored: 0, errors: [] };
  if (!emailFeatureEnabled()) return result;

  const account = readAccount();
  const settings = readSettings();
  if (!account || settings.ownerUserId === null) return result;

  let messages: ImapMessage[];
  try {
    messages = await fetchUnread({
      host: account.imapHost,
      port: account.imapPort,
      user: account.user,
      password: account.password,
      secure: account.imapSecure,
      allowSelfSigned: account.allowSelfSigned,
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    saveSettings({ lastPollAt: new Date().toISOString(), lastError: error });
    result.errors.push(error);
    return result;
  }

  result.fetched = messages.length;

  for (const message of messages) {
    try {
      const outcome = await routeEmailMessage(message, {
        settings,
        ownerAddress: account.address,
      });
      if (outcome.status === "ignored") {
        result.ignored += 1;
        continue;
      }
      await sendMail(
        {
          host: account.smtpHost,
          port: account.smtpPort,
          user: account.user,
          password: account.password,
          secure: account.smtpSecure,
          allowSelfSigned: account.allowSelfSigned,
        },
        {
          from: account.address,
          fromName: account.displayName || undefined,
          to: message.from,
          subject: outcome.subject,
          text: outcome.reply,
          inReplyTo: message.messageId,
          references: message.messageId,
        },
      );
      result.answered += 1;
    } catch (cause) {
      // One message that could not be answered must not stop the others; the
      // turn it started still exists in the app either way.
      result.errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  saveSettings({
    lastPollAt: new Date().toISOString(),
    lastError: result.errors[0] ?? null,
  });
  pruneSeen();
  return result;
}

/** Start the process-wide poll. Safe to call repeatedly (dev hot reloads). */
export function startEmailPoller(): void {
  if (globals.__breadboardEmailPoller) return;
  if (!emailFeatureEnabled()) return;

  const tick = async () => {
    if (globals.__breadboardEmailPolling) return;
    globals.__breadboardEmailPolling = true;
    try {
      await pollEmailOnce();
    } catch {
      // pollEmailOnce records its own failures; the next tick retries.
    } finally {
      globals.__breadboardEmailPolling = false;
    }
  };

  const timer = setInterval(tick, emailTimings().pollIntervalMs);
  timer.unref?.();
  globals.__breadboardEmailPoller = timer;
}

export function stopEmailPoller(): void {
  if (globals.__breadboardEmailPoller) {
    clearInterval(globals.__breadboardEmailPoller);
    globals.__breadboardEmailPoller = undefined;
  }
}

export interface EmailStatus {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  address: string | null;
  ownerUserId: number | null;
  allowedSenders: string[];
  autostart: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  pollIntervalMs: number;
}

export function emailStatus(): EmailStatus {
  const settings = readSettings();
  return {
    enabled: emailFeatureEnabled(),
    configured: hasAccount(),
    running: Boolean(globals.__breadboardEmailPoller),
    address: settings.address,
    ownerUserId: settings.ownerUserId,
    allowedSenders: settings.allowedSenders,
    autostart: settings.autostart,
    lastPollAt: settings.lastPollAt,
    lastError: settings.lastError,
    pollIntervalMs: emailTimings().pollIntervalMs,
  };
}

/**
 * Start the poller on boot when the user asked for it.
 *
 * Off unless explicitly enabled: an app that starts reading a mailbox and
 * answering strangers because it was installed is not one anybody asked for.
 */
export function autostartEmailPoller(): void {
  const settings = readSettings();
  if (!settings.autostart || settings.ownerUserId === null || !hasAccount()) return;
  startEmailPoller();
}
