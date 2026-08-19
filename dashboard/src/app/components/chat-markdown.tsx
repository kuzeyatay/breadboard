'use client';

import {
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { isSameTabNavigationClick, rememberWorkflowReturnPath } from '@/lib/workflows/navigation';
import ChatImageResults from './chat-image-results';

interface Props {
  content: string;
  compact?: boolean;
  textAnnotations?: readonly ChatTextAnnotation[];
  onTextAnnotationClick?: (annotationId: string, anchor: DOMRect) => void;
}

export interface ChatTextAnnotation {
  id: string;
  start: number;
  end: number;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const languageNames: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  css: 'CSS',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  markdown: 'Markdown',
  md: 'Markdown',
  plaintext: 'Plain text',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  python: 'Python',
  py: 'Python',
  shell: 'Shell',
  sh: 'Shell',
  sql: 'SQL',
  text: 'Plain text',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
};

function getTextContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }

  return '';
}

function getCodeClassName(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const className = getCodeClassName(child);
      if (className) return className;
    }
    return undefined;
  }

  if (!isValidElement<{ className?: string }>(node)) return undefined;
  return typeof node.props.className === 'string' ? node.props.className : undefined;
}

function getLanguageLabel(className?: string): string {
  const language = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase();
  if (!language) return 'Code';
  if (languageNames[language]) return languageNames[language];

  return language
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function writeToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Unable to copy code');
}

type MarkdownPreProps = ComponentProps<'pre'> & { node?: unknown };

// Dispatches fenced blocks before CodeBlock mounts: an ```image-results block
// is the image_search tool's display contract and renders as an image grid,
// not as code. A separate component (not a branch inside CodeBlock) so
// CodeBlock's hooks are never conditionally skipped.
function MarkdownPre({ children, node, ...props }: MarkdownPreProps) {
  const language = getCodeClassName(children)
    ?.match(/(?:^|\s)language-([^\s]+)/)?.[1]
    ?.toLowerCase();
  if (language === 'image-results') {
    return <ChatImageResults code={getTextContent(children)} />;
  }
  return (
    <CodeBlock node={node} {...props}>
      {children}
    </CodeBlock>
  );
}

function CodeBlock({ children, node, ...props }: MarkdownPreProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = getTextContent(children).replace(/\n$/, '');
  const language = getLanguageLabel(getCodeClassName(children));

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  async function copyCode() {
    try {
      await writeToClipboard(code);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  // `node` is supplied by react-markdown and should not be forwarded to the DOM.
  void node;

  return (
    <div className="chat-code-block">
      <div className="chat-code-block-header" data-selection-exclude>
        <span className="chat-code-block-language">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12" />
          </svg>
          <span>{language}</span>
        </span>
        <button
          type="button"
          className="chat-code-copy"
          onClick={copyCode}
          aria-label={copied ? 'Code copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="3" width="11" height="13" rx="2" />
              <path d="M15 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3" />
            </svg>
          )}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

type MarkdownBlockquoteProps = ComponentProps<'blockquote'> & { node?: unknown };

function CopyableBlockquote({
  children,
  className,
  node,
  ...props
}: MarkdownBlockquoteProps) {
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  async function copyField() {
    const value = contentRef.current?.innerText.trim() ?? '';
    if (!value) return;

    try {
      await writeToClipboard(value);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  // `node` is supplied by react-markdown and should not be forwarded to the DOM.
  void node;

  return (
    <blockquote
      {...props}
      className={['chat-copyable-field', className].filter(Boolean).join(' ')}
    >
      <div ref={contentRef} className="chat-copyable-field-content">
        {children}
      </div>
      <button
        type="button"
        className="chat-field-copy"
        onClick={() => void copyField()}
        aria-label={copied ? 'Text copied' : 'Copy this text'}
        title={copied ? 'Copied' : 'Copy text'}
        data-selection-exclude
      >
        {copied ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="3" width="11" height="13" rx="2" />
            <path d="M15 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3" />
          </svg>
        )}
      </button>
    </blockquote>
  );
}

const baseComponents = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const isWorkflowLink = href === '/workflows' || href?.startsWith('/workflows?');
    return (
      <a
        href={href}
        target={isWorkflowLink ? undefined : '_blank'}
        rel={isWorkflowLink ? undefined : 'noreferrer'}
        onClick={isWorkflowLink ? (event) => {
          if (isSameTabNavigationClick(event)) rememberWorkflowReturnPath();
        } : undefined}
      >
        {children}
      </a>
    );
  },
  img: ({ alt, src }: ComponentProps<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ''}
      src={typeof src === 'string' ? src : undefined}
      className="max-w-full rounded-xl border border-gray-800/80 shadow-lg my-3"
      loading="lazy"
    />
  ),
  pre: MarkdownPre,
  blockquote: CopyableBlockquote,
} satisfies Components;

function rehypeTextAnnotations(annotations: readonly ChatTextAnnotation[]) {
  const sorted = [...annotations]
    .filter(
      (annotation) =>
        Number.isSafeInteger(annotation.start) &&
        Number.isSafeInteger(annotation.end) &&
        annotation.start >= 0 &&
        annotation.end > annotation.start,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return () => (tree: HastNode) => {
    let offset = 0;
    const started = new Set<string>();

    function visit(parent: HastNode) {
      if (!parent.children) return;
      const nextChildren: HastNode[] = [];
      for (const child of parent.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          const classNames = Array.isArray(child.properties?.className)
            ? child.properties.className
            : [child.properties?.className];
          const isMath = classNames.some(
            (value) => value === 'math-inline' || value === 'math-display',
          );
          if (!isMath) visit(child);
          nextChildren.push(child);
          continue;
        }

        const nodeStart = offset;
        const nodeEnd = nodeStart + child.value.length;
        offset = nodeEnd;
        const matches = sorted.filter(
          (annotation) => annotation.start < nodeEnd && annotation.end > nodeStart,
        );
        if (matches.length === 0) {
          nextChildren.push(child);
          continue;
        }

        let cursor = 0;
        for (const annotation of matches) {
          const start = Math.max(cursor, annotation.start - nodeStart);
          const end = Math.min(child.value.length, annotation.end - nodeStart);
          if (end <= start) continue;
          if (start > cursor) {
            nextChildren.push({ type: 'text', value: child.value.slice(cursor, start) });
          }
          const isRoot = !started.has(annotation.id);
          started.add(annotation.id);
          nextChildren.push({
            type: 'element',
            tagName: 'mark',
            properties: {
              'data-chat-selection-id': annotation.id,
              ...(isRoot ? { 'data-chat-selection-root': 'true' } : {}),
            },
            children: [{ type: 'text', value: child.value.slice(start, end) }],
          });
          cursor = end;
        }
        if (cursor < child.value.length) {
          nextChildren.push({ type: 'text', value: child.value.slice(cursor) });
        }
      }
      parent.children = nextChildren;
    }

    visit(tree);
  };
}

function chatUrlTransform(url: string, key: string): string {
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

function ChatMarkdown({
  content,
  compact = false,
  textAnnotations = [],
  onTextAnnotationClick,
}: Props) {
  const normalizedContent = useMemo(() => normalizeMathDelimiters(content), [content]);
  const annotatedRehypePlugins = useMemo(
    () =>
      textAnnotations.length > 0
        ? [rehypeTextAnnotations(textAnnotations), ...rehypePlugins]
        : rehypePlugins,
    [textAnnotations],
  );
  const markdownComponents = useMemo<Components>(
    () => ({
      ...baseComponents,
      mark: ({ children, node, ...props }: ComponentProps<'mark'> & { node?: unknown }) => {
        void node;
        const annotationId = String(
          (props as Record<string, unknown>)['data-chat-selection-id'] ?? '',
        );
        return (
          <mark
            {...props}
            className="bb-chat-text-highlight"
            role="button"
            tabIndex={0}
            aria-label="Open answer for highlighted text"
            onClick={(event) => {
              event.stopPropagation();
              if (annotationId) {
                onTextAnnotationClick?.(
                  annotationId,
                  event.currentTarget.getBoundingClientRect(),
                );
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (annotationId) {
                onTextAnnotationClick?.(
                  annotationId,
                  event.currentTarget.getBoundingClientRect(),
                );
              }
            }}
          >
            {children}
          </mark>
        );
      },
    }),
    [onTextAnnotationClick],
  );

  return (
    <div className={compact ? 'chat-markdown compact' : 'chat-markdown'}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={annotatedRehypePlugins}
        components={markdownComponents}
        urlTransform={chatUrlTransform}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

// Annotations are compared by value: the transcripts build the prop as
// `get(id) ?? []`, which is a fresh array on every render, and an identity
// compare would send the whole message back through remark/rehype each time.
// That parse is the most expensive thing a transcript row does — a table-heavy
// answer re-parsed on every scroll frame is a visibly laggy chat.
export function chatTextAnnotationsEqual(
  left: readonly ChatTextAnnotation[] | undefined,
  right: readonly ChatTextAnnotation[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (annotation, index) =>
      annotation.id === b[index].id &&
      annotation.start === b[index].start &&
      annotation.end === b[index].end,
  );
}

export default memo(
  ChatMarkdown,
  (prev, next) =>
    prev.content === next.content &&
    prev.compact === next.compact &&
    prev.onTextAnnotationClick === next.onTextAnnotationClick &&
    chatTextAnnotationsEqual(prev.textAnnotations, next.textAnnotations),
);
