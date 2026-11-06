/**
 * ChatGPT voice: ChatGPT's own voice conversation, copied into Breadboard's
 * chat as it happens. These are the two pure halves of that copy: what
 * ChatGPT is told about the chat so far, and how the spoken messages become
 * the chat's user/answer pairs.
 */

export const CHATGPT_VOICE_CONTEXT_CHARACTERS = 12_000;

/** The chat so far, newest kept when it is long. */
export function chatgptVoiceContext(
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
  maxCharacters = CHATGPT_VOICE_CONTEXT_CHARACTERS,
): string {
  const lines: string[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = messages[index]!.content.trim();
    if (!text) continue;
    const line = `${messages[index]!.role === 'user' ? 'Me' : 'Assistant'}: ${text}`;
    if (used + line.length > maxCharacters) {
      if (!lines.length) lines.unshift(`…${line.slice(-(maxCharacters - 1))}`);
      break;
    }
    lines.unshift(line);
    used += line.length + 2;
  }
  return lines.join('\n\n');
}

export interface SpokenMessage { id: string; role: 'user' | 'assistant'; text: string }
export interface SpokenExchange { clientMessageId: string; user: string; assistant: string }

/** What ChatGPT said before anything was asked: its greeting. */
export const CHATGPT_VOICE_OPENING = '(Started a ChatGPT voice conversation)';
export const CHATGPT_VOICE_UNANSWERED = '_(The voice conversation ended before ChatGPT answered.)_';

/**
 * Pair spoken messages into exchanges. What the person said waits in
 * `pending` until ChatGPT's answer arrives; `final` closes the conversation,
 * so a question left unanswered is still kept.
 */
export function pairSpokenMessages(
  pending: readonly SpokenMessage[],
  messages: readonly SpokenMessage[],
  final = false,
): { exchanges: SpokenExchange[]; pending: SpokenMessage[] } {
  const exchanges: SpokenExchange[] = [];
  let waiting = [...pending];
  for (const message of messages) {
    if (message.role === 'user') {
      waiting.push(message);
      continue;
    }
    exchanges.push({
      clientMessageId: `chatgpt-voice-${(waiting[0] ?? message).id}`.slice(0, 128),
      user: waiting.map(said => said.text).join('\n\n') || CHATGPT_VOICE_OPENING,
      assistant: message.text,
    });
    waiting = [];
  }
  if (final && waiting.length) {
    exchanges.push({
      clientMessageId: `chatgpt-voice-${waiting[0]!.id}`.slice(0, 128),
      user: waiting.map(said => said.text).join('\n\n'),
      assistant: CHATGPT_VOICE_UNANSWERED,
    });
    waiting = [];
  }
  return { exchanges, pending: waiting };
}
