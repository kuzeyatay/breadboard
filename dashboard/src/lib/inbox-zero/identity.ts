// The Inbox Zero agent's chat identity: the slash command that activates it and
// the parsing of a message into an instruction for the mailbox.
//
// Mirrors the other runtime agents so every one is reached the same way — pick
// it in the palette, then say what you want done with your email.

export const INBOX_ZERO_COMMAND = "/agents:inbox-zero";
export const INBOX_ZERO_AGENT_ID = "inbox-zero";
export const INBOX_ZERO_AGENT_NAME = "Inbox Zero";

/** Accepted spellings of the command. `/agents:email` reads the way people ask. */
const COMMAND_TOKENS = new Set(["agents:inbox-zero", "agents:inboxzero", "agents:email"]);

/**
 * The instruction carried by an `/agents:inbox-zero …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own — the palette inserts the token first and the person is still
 * writing, so the caller waits rather than starting an empty run.
 *
 * Other slash tokens stacked in front are preserved in the returned instruction
 * so the capability resolver still sees them and can refuse the combination in
 * the words every surface uses.
 */
export function taskFromInboxZeroCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (COMMAND_TOKENS.has(match[1].toLowerCase())) {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function inboxZeroUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${INBOX_ZERO_COMMAND} ${trimmed}` : INBOX_ZERO_COMMAND;
}

/**
 * The message actually sent to Inbox Zero's assistant.
 *
 * When the user has turned mailbox actions off, the restriction is stated to the
 * assistant rather than enforced by filtering its tools — Breadboard is a client
 * of that API, not its owner, and pretending otherwise would be a security
 * boundary that is really a suggestion. It is what it looks like: an instruction
 * the assistant follows, sitting on top of Inbox Zero's own confirmation step,
 * which is the boundary that actually holds.
 */
export function instruction(task: string, allowActions: boolean): string {
  if (allowActions) return task;
  return [
    "Read-only mode: report and draft only. Do not archive, delete, label, mark as read, snooze, unsubscribe, send, or reply, and do not create or change any rule. If the request needs one of those, say what you would do and stop.",
    "",
    task,
  ].join("\n");
}

/**
 * Does this sentence read as email work?
 *
 * Used by the Super Agent's routing rule and by nothing that grants authority:
 * a false positive costs a delegation the user can see and cancel, a false
 * negative costs nothing but the shortcut. Kept deliberately literal — this is
 * a hint for a model that already has the request in front of it, not a
 * classifier standing between the user and an answer.
 */
export function readsAsEmailWork(value: string): boolean {
  return /\b(e-?mails?|inbox(es)?|mailbox(es)?|gmail|outlook|unread|unsubscribe|newsletter|archive(d|s)?|draft(s|ed|ing)?\s+(a\s+)?(reply|response|message)|repl(y|ies|ying)|forward(ed|ing)?\s+(it|the\s+(mail|message|email))|cc'?d?|bcc|threads?\s+(from|with)|spam|labell?(ed|ing)?)\b/i.test(
    value,
  );
}
