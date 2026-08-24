// Who a message wakes.
//
// Kept apart from `agent-bridge.ts` because that module reaches the database
// and the model, and this rule is the one piece of Buzz that most needs to be
// exercised directly: it decides how many agents answer a line, and getting it
// wrong turns a room into four copies of the same conversation.

import type { BuzzMember } from "./store.ts";

/**
 * The `@handle` tokens in a message body.
 *
 * An email address must not read as a mention, which is why a `@` has to be at
 * the start or follow a non-word character — `ada@example.com` names nobody.
 */
export function mentionedHandles(body: string): string[] {
  const handles: string[] = [];
  const pattern = /(^|[^\w@.])@([a-z0-9][a-z0-9-]{0,39})/gi;
  let match = pattern.exec(body);
  while (match) {
    handles.push(match[2].toLowerCase());
    match = pattern.exec(body);
  }
  return handles;
}

/**
 * Which members answer a message.
 *
 * Only agents are returned: mentioning a colleague notifies them, it does not
 * put words in their mouth. `always` members speak on every message; everyone
 * else waits to be named, which is the default a member joins with because a
 * room with four always-on agents answers every line four times.
 *
 * With one exception, and it is the rule that makes a default always-on member
 * bearable: naming an agent hands that message to it alone. Bread is seated in
 * every room on `always`, so without this every "@researcher what did the
 * survey say" got two answers — the specialist's, and the generalist's guess
 * at the same question over the top of it. Addressing somebody by name in a
 * room full of people means you want that person to answer, and nothing here
 * should have to explain itself twice.
 */
export function resolveResponders(
  members: readonly BuzzMember[],
  body: string,
): BuzzMember[] {
  const mentioned = new Set(mentionedHandles(body));
  const speakable = members.filter(
    (member) =>
      member.kind === "agent" && !member.muted && member.respondTo !== "never",
  );
  // Only handles belonging to an agent that could actually speak count as
  // addressing someone: naming a colleague, or an agent set to `never`, must
  // not silence the room's always-on member and leave the message unanswered.
  const addressed = speakable.filter((member) => mentioned.has(member.handle));
  if (addressed.length > 0) return addressed;
  return speakable.filter((member) => member.respondTo === "always");
}
