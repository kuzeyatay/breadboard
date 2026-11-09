import type { VoiceMessage } from './voice-conversation.ts';

type HostMessage = VoiceMessage & {
  internalAgentContinuation?: boolean;
  delegatedAgentRun?: boolean;
  modelChange?: unknown;
  textSelection?: { mode?: string };
};
type PublicActivity = { kind: string; label: string; status: string };

/** Internal worker briefs and results belong to the runtime. Voice follows the
 * same public answer as chat, with occasional public activity labels. Never
 * narrate a reasoning detail, tool argument or private continuation prompt. */
export function voiceHostMessages(
  messages: readonly HostMessage[],
  activities: readonly PublicActivity[] = [],
  busy = false,
): VoiceMessage[] {
  const workerTurns = new Set(messages.filter(message => message.delegatedAgentRun && message.clientMessageId).map(message => message.clientMessageId));
  const visible = messages.filter(message => !message.internalAgentContinuation &&
    !(message.clientMessageId && workerTurns.has(message.clientMessageId)) &&
    !message.delegatedAgentRun && !message.modelChange && message.textSelection?.mode !== 'inline');
  if (!busy) return visible;
  const activity = activities.findLast(item => item.status === 'running' &&
    !['reasoning', 'answer', 'permission'].includes(item.kind));
  const label = activity?.label.trim();
  if (!label || label.length > 140 || /^(thinking|working|processing|loading)[.!…]*$/i.test(label)) return visible;
  const last = visible.findLastIndex(message => message.role === 'assistant');
  if (last < 0) return visible;
  return visible.map((message, index) => index !== last ? message : {
    ...message, progressNotes: [...(message.progressNotes ?? []), label],
  });
}
