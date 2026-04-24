'use client';

import { memo, useMemo, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

interface Props {
  content: string;
  compact?: boolean;
}

function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
const components = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ alt, src }: ComponentProps<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ''}
      src={typeof src === 'string' ? src : undefined}
      className="max-w-full rounded-xl border border-gray-800/80 shadow-lg my-3"
      loading="lazy"
    />
  ),
} satisfies Components;

function chatUrlTransform(url: string, key: string): string {
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

function ChatMarkdown({ content, compact = false }: Props) {
  const normalizedContent = useMemo(() => normalizeMathDelimiters(content), [content]);

  return (
    <div className={compact ? 'chat-markdown compact' : 'chat-markdown'}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={chatUrlTransform}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
