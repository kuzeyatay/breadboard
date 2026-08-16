// Sending review questions out over WhatsApp or Telegram, and turning the reply
// back into an FSRS grade.
//
// This is the half that makes the feature worth having: a garden that only asks
// when you visit it is still something you have to remember to do. The channel is
// a single per-user choice made on the profile page — see ./types.ts — and the
// message goes to the most recent one-to-one thread on that channel, which is the
// thread the person actually reads.
//
// Grading accepts two shapes. A bare 1-4 (or again/hard/good/easy) is taken at
// face value, which keeps the loop usable when the provider is down and lets
// someone self-grade honestly. Anything else is graded against the card's stored
// answer by the model, which also returns a one-line correction — the part that
// makes a missed question worth something.

import { getReviewStore } from "./instance.ts";
import { REVIEW_GRADES, type ReviewChannel, type ReviewGradeValue } from "./types.ts";
import type { ReviewStore } from "./store.ts";

export interface ChannelTarget {
  chatId: string;
  send: (text: string) => Promise<void>;
}

/**
 * The thread a review goes to: the most recently active one-to-one chat.
 *
 * Group chats are excluded outright. A review question is addressed to one
 * person and expects a reply that gets graded; posting that into a group would
 * both leak the material and attribute a stranger's reply to the owner's card.
 */
export async function resolveChannelTarget(
  userId: number,
  channel: ReviewChannel,
): Promise<ChannelTarget | null> {
  if (channel === "telegram") {
    const [{ getTelegramStore }, { readBotToken }, { sendMessage }] = await Promise.all([
      import("../telegram/instance.ts"),
      import("../telegram/credentials.ts"),
      import("../telegram/client.ts"),
    ]);
    const token = readBotToken();
    if (!token) return null;
    const chat = getTelegramStore()
      .listChats(userId, 25)
      .find((row) => row.is_group === 0);
    if (!chat) return null;
    return {
      chatId: chat.chat_id,
      send: (text: string) => sendMessage(token, chat.chat_id, text),
    };
  }

  if (channel === "whatsapp") {
    const [{ getWhatsAppStore }, { getWhatsAppBridge }] = await Promise.all([
      import("../whatsapp/instance.ts"),
      import("../whatsapp/bridge.ts"),
    ]);
    const chat = getWhatsAppStore()
      .listChats(userId, 25)
      .find((row) => row.is_group === 0);
    if (!chat) return null;
    const bridge = getWhatsAppBridge();
    return {
      chatId: chat.chat_id,
      send: (text: string) => bridge.sendMessage(chat.chat_id, text),
    };
  }

  return null;
}

export function formatQuestion(input: { question: string; gardenSlug: string }): string {
  return (
    `📚 ${input.gardenSlug}\n\n` +
    `${input.question}\n\n` +
    `Reply with your answer, or 1-4 to self-grade ` +
    `(1 again · 2 hard · 3 good · 4 easy).`
  );
}

export interface SendResult {
  sent: number;
  reason?: "channel_off" | "no_target" | "no_due" | "budget_spent" | "awaiting_answer";
}

/**
 * Send at most one question to a user.
 *
 * One, not a batch, because a chat may hold only one open delivery — a reply is
 * matched to a question by chat, so two outstanding questions could not be told
 * apart. The day's remaining questions arrive as each is answered, which also
 * makes the whole thing self-limiting: someone who stops replying stops being
 * asked, instead of accumulating a wall of unanswered messages.
 */
export async function sendNextReview(options: {
  store?: ReviewStore;
  userId: number;
  now?: Date;
  localDate?: string;
}): Promise<SendResult> {
  const store = options.store ?? getReviewStore();
  const now = options.now ?? new Date();
  const settings = store.userSettings(options.userId);
  if (settings.channel === "off") return { sent: 0, reason: "channel_off" };

  // Cheapest check first: this runs every 30 seconds per user, and an indexed
  // range scan is far less work than reading the bot token off disk and
  // querying the chat list. A card with a question already open is still due,
  // so testing this first cannot mask the open-delivery guard below.
  const due = store.due(options.userId, { limit: 1, now });
  if (due.length === 0) return { sent: 0, reason: "no_due" };

  const target = await resolveChannelTarget(options.userId, settings.channel);
  if (!target) return { sent: 0, reason: "no_target" };

  // A question already waiting in this thread is not replaced. Doing so would
  // expire a card the person may still be composing an answer to.
  if (store.openDeliveryForChat(target.chatId)) {
    return { sent: 0, reason: "awaiting_answer" };
  }

  const localDate = options.localDate ?? toLocalDate(now);
  if (store.claimDailyBudget(options.userId, localDate, 1) === 0) {
    return { sent: 0, reason: "budget_spent" };
  }

  const card = due[0];
  try {
    await target.send(formatQuestion({ question: card.question, gardenSlug: card.garden_slug }));
  } catch {
    // A failed send leaves the card due so the next tick retries it. The budget
    // claim is not refunded: a provider that fails repeatedly should not be
    // hammered for the whole daily allowance in one minute.
    return { sent: 0, reason: "no_target" };
  }
  store.openDelivery({
    cardId: card.id,
    userId: options.userId,
    channel: settings.channel,
    chatId: target.chatId,
    question: card.question,
  });
  return { sent: 1 };
}

export function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const EXPLICIT_GRADES: Record<string, ReviewGradeValue> = {
  "1": REVIEW_GRADES.again,
  "2": REVIEW_GRADES.hard,
  "3": REVIEW_GRADES.good,
  "4": REVIEW_GRADES.easy,
  again: REVIEW_GRADES.again,
  hard: REVIEW_GRADES.hard,
  good: REVIEW_GRADES.good,
  easy: REVIEW_GRADES.easy,
};

/** A reply that is only a grade, e.g. "3" or "good". */
export function explicitGrade(text: string): ReviewGradeValue | null {
  return EXPLICIT_GRADES[text.trim().toLowerCase()] ?? null;
}

/** Admissions of not knowing are graded `again` without troubling a model. */
const GAVE_UP = /^(idk|i don'?t know|dunno|no idea|skip|pass|\?+)$/i;

export interface GradeOutcome {
  rating: ReviewGradeValue;
  feedback: string;
}

async function modelGrade(input: {
  question: string;
  reference: string;
  answer: string;
}): Promise<GradeOutcome | null> {
  const { createChatmockClient } = await import("../knowledge.ts");
  const client = createChatmockClient();
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You grade one spaced-repetition answer. Compare the learner's answer " +
          "to the reference. Judge substance, not wording: synonyms, different " +
          "notation, and a terser explanation are all fine. Rate 1 (wrong or " +
          "absent), 2 (right idea, significant gaps), 3 (substantially correct), " +
          "4 (correct and complete). Then write ONE short sentence of feedback: " +
          "if they missed something, say specifically what. Reply as JSON: " +
          '{"rating": 3, "feedback": "..."}. No prose outside the JSON.',
      },
      {
        role: "user",
        content:
          `QUESTION: ${input.question}\n\n` +
          `REFERENCE: ${input.reference.slice(0, 1500)}\n\n` +
          `LEARNER ANSWER: ${input.answer.slice(0, 1500)}`,
      },
    ],
  });
  const content = response.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const rating = Math.trunc(Number((parsed as { rating?: unknown })?.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) return null;
  const feedback = (parsed as { feedback?: unknown })?.feedback;
  return {
    rating: rating as ReviewGradeValue,
    feedback: typeof feedback === "string" ? feedback.trim() : "",
  };
}

const GRADE_LABEL: Record<number, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

export interface InboundReviewResult {
  handled: true;
  reply: string;
}

/**
 * Grade an inbound message if it answers an open review question.
 *
 * Returns null when the chat has no question outstanding, which is the signal to
 * the channel routers that this is an ordinary message and should open a normal
 * Breadboard conversation instead.
 */
export async function handleInboundReview(options: {
  store?: ReviewStore;
  chatId: string;
  text: string;
  now?: Date;
}): Promise<InboundReviewResult | null> {
  const store = options.store ?? getReviewStore();
  const delivery = store.openDeliveryForChat(options.chatId);
  if (!delivery) return null;

  const card = store.card(delivery.card_id);
  if (!card) {
    // The garden was deleted under the open question; close it out quietly
    // rather than stranding the chat with a question nothing can grade.
    store.closeDelivery(delivery.id, { answerText: options.text, rating: REVIEW_GRADES.again });
    return null;
  }

  const text = options.text.trim();
  let outcome: GradeOutcome | null = null;

  const explicit = explicitGrade(text);
  if (explicit !== null) {
    outcome = { rating: explicit, feedback: "" };
  } else if (GAVE_UP.test(text)) {
    outcome = { rating: REVIEW_GRADES.again, feedback: "" };
  } else {
    try {
      outcome = await modelGrade({
        question: delivery.question,
        reference: card.answer,
        answer: text,
      });
    } catch {
      outcome = null;
    }
  }

  // An ungradeable answer must not silently vanish: it is recorded as `hard`,
  // which reschedules it soon rather than either burying it or treating a
  // provider outage as though the learner had failed.
  const rating = outcome?.rating ?? REVIEW_GRADES.hard;
  const settings = store.userSettings(delivery.user_id);
  const result = store.grade(card.id, rating, {
    desiredRetention: settings.desiredRetention,
    now: options.now,
  });
  store.closeDelivery(delivery.id, { answerText: text, rating });

  const nextDue = result ? describeDue(new Date(result.card.due), options.now ?? new Date()) : "";
  const lines = [`${GRADE_LABEL[rating] ?? "Noted"} — next in ${nextDue}.`];
  if (outcome?.feedback) lines.push("", outcome.feedback);
  if (!outcome) {
    lines.push("", "I could not grade that automatically, so it comes back soon.");
  }
  lines.push("", `From: ${card.page_title}`);
  return { handled: true, reply: lines.join("\n") };
}

export function describeDue(due: Date, now: Date): string {
  const ms = Math.max(0, due.getTime() - now.getTime());
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
}
