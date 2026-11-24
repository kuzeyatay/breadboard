/* Shared rendering for slash-command text in chat transcripts. Command tokens
   inserted from the command hub (e.g. "/summarize-page") use the theme's chat
   blue so command invocations stay readable on every surface. User messages
   support draft formatting and turn bare web addresses into clickable links. */

import { Children, Fragment, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hasDraftFormatting } from '@/lib/chat-draft-formatting';
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

function mentionedText(text: string) {
  return splitMentions(text).map((part, at) => part.mention
    ? <span key={at} className={COMMAND_TEXT_CLASS} data-bot-mention>{part.value}</span>
    : <Fragment key={at}>{part.value}</Fragment>);
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
          <Fragment key={index}>{mentionedText(segment.value)}</Fragment>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

function decorateMentions(children: ReactNode) {
  return Children.map(children, child => typeof child === 'string' ? mentionedText(child) : child);
}

const draftMarkdownComponents: Components = {
  a: ({ href, children }) => <a className={CHAT_LINK_CLASS} href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
  p: ({ children }) => <p className="whitespace-pre-wrap">{decorateMentions(children)}</p>,
  h1: ({ children }) => <h1 className="text-lg font-semibold">{decorateMentions(children)}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold">{decorateMentions(children)}</h2>,
  h3: ({ children }) => <h3 className="font-semibold">{decorateMentions(children)}</h3>,
  li: ({ children }) => <li>{decorateMentions(children)}</li>,
  strong: ({ children }) => <strong>{decorateMentions(children)}</strong>,
  em: ({ children }) => <em>{decorateMentions(children)}</em>,
};

export function UserMessageText({ content }: { content: string }) {
  const split = splitLeadingCommandTokens(content);
  const body = split?.rest ?? content;
  if (hasDraftFormatting(body)) {
    return (
      <div className="chat-markdown compact wrap-anywhere">
        {split && <span className={COMMAND_TEXT_CLASS}>{split.command}</span>}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={draftMarkdownComponents}
          disallowedElements={['img', 'input']} unwrapDisallowed>
          {body}
        </ReactMarkdown>
      </div>
    );
  }
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
