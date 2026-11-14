// Deliver a chat answer that outlived a messaging transport's inbound wait.
//
// Telegram and WhatsApp wait on a turn for a few minutes, then tell the sender
// it is taking a while. Before this helper existed that was the end of it: the
// answer finished in the durable transcript and never reached the phone. The
// transports now hand the timed-out turn here and keep polling detached from
// their inbound queues, so the answer still arrives late instead of never.

export interface LateReplyMessage {
  clientMessageId: string;
  role: string;
  content: string;
  status: string;
  orderIndex: number;
}

export interface DeliverLateAssistantReplyInput {
  clientMessageId: string;
  listMessages: () => LateReplyMessage[];
  onReply: (content: string) => Promise<void>;
  maxWaitMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export const LATE_REPLY_FAILURE_TEXT =
  "That turn did not finish. Open the chat in Breadboard to see what happened.";

/** How long a late answer is watched for after the inbound wait gave up. */
export const LATE_REPLY_MAX_WAIT_MS = 2 * 60 * 60 * 1_000;

/**
 * Poll the durable transcript until the turn settles, then send its text. The
 * sender was already told the turn is taking a while, so a second timeout here
 * stays silent — the transcript in the app remains the fallback.
 */
export async function deliverLateAssistantReply(
  input: DeliverLateAssistantReplyInput,
): Promise<{ status: "complete" | "failed" | "aborted" | "timeout"; orderIndex?: number }> {
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const pollMs = Math.max(1, input.pollMs ?? 750);
  const deadline = now() + Math.max(1, input.maxWaitMs);
  for (;;) {
    const message = input
      .listMessages()
      .find(
        (candidate) =>
          candidate.role === "assistant" &&
          candidate.clientMessageId === input.clientMessageId,
      );
    if (message && message.status !== "pending") {
      const status =
        message.status === "complete" || message.status === "aborted"
          ? message.status
          : "failed";
      await input.onReply(message.content.trim() || LATE_REPLY_FAILURE_TEXT);
      return { status, orderIndex: message.orderIndex };
    }
    if (now() >= deadline) return { status: "timeout" };
    await sleep(pollMs);
  }
}
