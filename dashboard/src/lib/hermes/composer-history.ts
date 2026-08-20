/**
 * Arrow-key recall of the messages already sent, the way a shell does it.
 *
 * The composer is a terminal in every other respect, and the thing a terminal
 * gives you for free is the last thing you typed: press Up and it is back in
 * the field, ready to be edited and sent again. Chat boxes usually make you
 * scroll up, select the message and copy it. This module is the small amount
 * of reasoning that turns an arrow key into that gesture — kept out of the
 * component because the interesting part is the walk, not the wiring.
 *
 * Two rules carry all of it. The arrows only recall from the *edge* of the
 * draft — Up from the first line, Down from the last — so inside a message
 * being written they still move the caret, which is what they are for. And the
 * draft you were writing when you started walking is held aside: walking back
 * down past the newest message hands it back rather than leaving you with an
 * empty field and a lost sentence.
 */

/** Where in the walk the composer currently is; `null` means "still on the draft". */
export type ComposerHistoryIndex = number | null;

export type ComposerHistoryDirection = 'older' | 'newer';

export type ComposerHistoryMove = {
  /** `null` once the walk is back on the draft the person started from. */
  index: ComposerHistoryIndex;
  /** What the field should now hold. */
  text: string;
};

/**
 * The walkable list, oldest first, from everything the person sent in this
 * conversation.
 *
 * Blank messages are dropped because there is nothing to recall in one, and a
 * message identical to the one before it is dropped because pressing Up twice
 * and landing on the same text reads as a key that did not register. This is
 * the same rule a shell applies to its own history for the same reason.
 */
export function composerHistory(entries: readonly string[]): string[] {
  const history: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    if (history[history.length - 1] === entry) continue;
    history.push(entry);
  }
  return history;
}

/** No newline before the caret: the caret is on the draft's first line. */
export function caretOnFirstLine(value: string, caret: number): boolean {
  return !value.slice(0, caret).includes('\n');
}

/** No newline after the caret: the caret is on the draft's last line. */
export function caretOnLastLine(value: string, caret: number): boolean {
  return !value.slice(caret).includes('\n');
}

/**
 * One step of the walk, or `null` when there is nowhere to go — an empty
 * history, the oldest message already recalled, or Down pressed while the
 * field still holds the draft. `null` is the signal to leave the key alone and
 * let it move the caret, so the arrows never feel dead at the ends of the walk.
 *
 * `draft` is the text the walk started from; it is what a step past the newest
 * message returns to.
 */
export function composerHistoryMove(
  history: readonly string[],
  index: ComposerHistoryIndex,
  direction: ComposerHistoryDirection,
  draft: string,
): ComposerHistoryMove | null {
  if (history.length === 0) return null;

  if (direction === 'older') {
    const next = index === null ? history.length - 1 : index - 1;
    if (next < 0) return null;
    return { index: next, text: history[next] };
  }

  if (index === null) return null;
  const next = index + 1;
  if (next >= history.length) return { index: null, text: draft };
  return { index: next, text: history[next] };
}
