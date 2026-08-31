/**
 * Text shown in the ordinary assistant response body.
 *
 * Hermes keeps public, pre-tool narration separate from the durable answer so
 * the final response can replace it cleanly. While that answer is still empty,
 * present the narration as ordinary response text instead of a second progress
 * panel. A durable answer always wins as soon as it arrives.
 */
export function assistantVisibleContent(
  content: string,
  progressNotes?: string[],
): string {
  if (content.trim()) return content;
  return (progressNotes ?? [])
    .map((note) => note.trim())
    .filter(Boolean)
    .join("\n\n");
}
