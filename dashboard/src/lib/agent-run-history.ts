/**
 * A browser/computer-control run can emit a status frame for every action and
 * a screenshot for many of them. Keeping that complete journal in React state
 * makes one long-lived operator view retain an unbounded timeline, screenshot
 * index, and payload graph. The durable run log remains authoritative; this is
 * only the bounded window the renderer needs to draw the live workspace.
 */
export const MAX_RETAINED_AGENT_RUN_EVENTS = 512;

export interface SequencedAgentRunEvent {
  sequenceNumber: number;
}

export function appendBoundedAgentRunEvent<T extends SequencedAgentRunEvent>(
  current: T[],
  event: T,
  limit = MAX_RETAINED_AGENT_RUN_EVENTS,
): T[] {
  if (current.some((item) => item.sequenceNumber === event.sequenceNumber)) {
    return current;
  }
  const next = [...current, event].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber,
  );
  return next.length > limit ? next.slice(-limit) : next;
}
