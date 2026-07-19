/* Shared rendering for slash-command text in chat transcripts. Command tokens
   inserted from the command hub (e.g. "/summarize-page") are shown in dark
   blue so command invocations stand out from plain messages. */

// Mirrors CLEAN_TOKEN/LEGACY_TOKEN in @/lib/openharness/commands.ts: one or
// more leading "/token" selectors, each followed by whitespace or end of text.
const LEADING_COMMAND_RUN = /^(?:\/[a-z0-9][a-z0-9_.:-]*(?:\s+|$))+/i;

export const COMMAND_TEXT_CLASS = 'font-medium text-[#1e40af]';

export function splitLeadingCommandTokens(
  content: string,
): { command: string; rest: string } | null {
  const match = content.match(LEADING_COMMAND_RUN);
  if (!match) return null;
  return { command: match[0], rest: content.slice(match[0].length) };
}

export function startsWithCommandToken(content: string): boolean {
  return /^\/[a-z0-9]/i.test(content);
}

export function UserMessageText({ content }: { content: string }) {
  const split = splitLeadingCommandTokens(content);
  if (!split) return <p className="whitespace-pre-wrap">{content}</p>;
  return (
    <p className="whitespace-pre-wrap">
      <span className={COMMAND_TEXT_CLASS}>{split.command}</span>
      {split.rest}
    </p>
  );
}
