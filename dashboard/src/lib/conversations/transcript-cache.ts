/**
 * Which loaded transcripts a chat page can drop.
 *
 * A Garden used to hold every message of every chat (102 MB for one garden).
 * Now a transcript loads when its chat is opened or hovered, the most recently
 * used few stay warm, and the rest are released back to "not loaded".
 *
 * @param recent loaded chat ids, most recently used first
 * @param pinned ids that must stay loaded (on screen, streaming, saving, running)
 * @param limit  how many loaded transcripts to keep in total
 */
export function transcriptsToRelease(
  recent: readonly number[],
  pinned: ReadonlySet<number>,
  limit: number,
): number[] {
  let kept = 0;
  const released: number[] = [];
  for (const id of recent) {
    if (pinned.has(id)) continue;
    if (kept < limit) kept += 1;
    else released.push(id);
  }
  return released;
}

/** Move `id` to the front of a most-recently-used list. */
export function touchRecent(recent: readonly number[], id: number): number[] {
  return [id, ...recent.filter((other) => other !== id)];
}
