/** Only a terminal, unquoted command is executable. Interior mentions remain text. */
export function parseDictationCommand(transcript: string): { text: string; submit: boolean } {
  let text = transcript.trim();
  let submit = false;
  // Repeated recognition of the command still produces exactly one Enter.
  const command = /(?:^|[\s,.!?;:…])send[\s,.!?;:…]+message[\s,.!?;:…]*$/iu;
  for (;;) {
    const match = command.exec(text);
    if (!match) break;
    text = text.slice(0, match.index).trimEnd();
    submit = true;
  }
  return { text, submit };
}

/** Do not briefly type a command while its last word is still being recognized. */
export function dictationPreview(transcript: string): string {
  const parsed = parseDictationCommand(transcript);
  if (parsed.submit) return parsed.text;
  // Automatic punctuation and repeated spaces may arrive between the two
  // words. Keep the same command grammar for previews and final submission.
  const partial = /(?:^|[\s,.!?;:…])(?:s|se|sen|send(?:[\s,.!?;:…]+(?:m|me|mes|mess|messa|messag)?)?)[\s,.!?;:…]*$/iu.exec(parsed.text);
  return partial ? parsed.text.slice(0, partial.index).trimEnd() : parsed.text;
}
