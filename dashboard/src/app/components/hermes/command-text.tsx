/* Shared rendering for slash-command text in chat transcripts. Command tokens
   inserted from the command hub (e.g. "/summarize-page") use the theme's chat
   blue so command invocations stay readable on every surface. URLs typed or
   pasted by the user become blue, clickable links — the plain-text counterpart
   of the autolinking react-markdown already does for assistant answers. */

import { Fragment } from 'react';
import { linkifyChatText } from '@/lib/chat-links';
import { splitMentions } from '@/lib/bots/mentions';

// Mirrors CLEAN_TOKEN/LEGACY_TOKEN in @/lib/hermes/commands.ts: one or
// more leading "/token" selectors, each followed by whitespace or end of text.
const LEADING_COMMAND_RUN = /^(?:\/[a-z0-9][a-z0-9_.:-]*(?:\s+|$))+/i;

export const COMMAND_TEXT_CLASS = 'font-medium text-[var(--chat-link)]';

export const CHAT_LINK_CLASS = 'chat-inline-link';

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

export function LinkifiedText({ content, mentions = false }: { content: string; mentions?: boolean }) {
  return (
    <>
      {linkifyChatText(content).map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={index}
            className={CHAT_LINK_CLASS}
            href={segment.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {segment.value}
          </a>
        ) : mentions ? (
          // A bot @mention is drawn in the same chat blue as a /command.
          <Fragment key={index}>{splitMentions(segment.value).map((part, at) => part.mention
            ? <span key={at} className={COMMAND_TEXT_CLASS} data-bot-mention>{part.value}</span>
            : <Fragment key={at}>{part.value}</Fragment>)}</Fragment>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

export function UserMessageText({ content }: { content: string }) {
  const split = splitLeadingCommandTokens(content);
  if (!split) {
    return (
      <p className="whitespace-pre-wrap">
        <LinkifiedText content={content} mentions />
      </p>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      <span className={COMMAND_TEXT_CLASS}>{split.command}</span>
      <span>
        <LinkifiedText content={split.rest} mentions />
      </span>
    </p>
  );
}
