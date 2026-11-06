'use client';

import {
  isValidElement,
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { parseGodsEyeResult } from '@/lib/gods-eye/view';
import { isSameTabNavigationClick, rememberWorkflowReturnPath } from '@/lib/workflows/navigation';
import ChatImageResults from './chat-image-results';
import ChatMarkdownImage from './chat-markdown-image';
import { ArtifactLinkContext } from './hermes/artifact-link-context';
import { remarkLimitImageResults } from '@/lib/hermes/image-results';
import ChatWeatherResults from './chat-weather-results';
import type { ChatHighlightColor } from '@/lib/chat-highlights';
import { allowMarkTextSelection, resolveChatTextSelectionAnchor } from '@/lib/chat-text-selection';
import { repairDamagedLatex } from '@/lib/markdown-safety';
import { chatMarkdownHref } from '@/lib/chat-markdown-links';
import { remarkChatDetails } from '@/lib/chat-markdown-details';
import { normalizeMathDelimiters, outsideCode } from '@/lib/chat-markdown-math';
import { containLongChatMarkdown } from '@/lib/chat-markdown-containment';

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
  kind?: 'answer' | 'highlight' | 'chat';
  color?: ChatHighlightColor;
  note?: string;
  /** A selection spanning steered segments shows its note only at the start. */
  noteContinuation?: boolean;
  quote?: string;
  wholeMessage?: true;
  prefix?: string;
  suffix?: string;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Remove HTML break tags from GFM table cells without enabling raw HTML.
 *
 * Models commonly use `<br>` to force two lines into one Markdown cell. Raw
 * HTML is intentionally disabled, so the tag used to be shown as text. Tables
 * now own wrapping in CSS; turning the tag into a space preserves both pieces
 * of content and lets the browser choose the line break that fits the screen.
 */
function normalizeTableCellBreaks(content: string): string {
  const lines = content.split('\n');
  const codeLines = new Set<number>();
  let activeFence: { marker: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (activeFence) {
      codeLines.add(index);
      if (fence?.[0] === activeFence.marker && fence.length >= activeFence.length) {
        activeFence = null;
      }
    } else if (fence) {
      codeLines.add(index);
      activeFence = { marker: fence[0], length: fence.length };
    } else if (/^(?: {4}|\t)/u.test(lines[index])) {
      codeLines.add(index);
    }
  }

  const delimiterRow = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const tableRow = /^\s*\|?.*\|.*\|?\s*$/;
  const removeBreaks = (line: string) =>
    outsideCode(line, (prose) => prose.replace(/<br\s*\/?>/gi, ' '));

  for (let delimiterIndex = 1; delimiterIndex < lines.length; delimiterIndex += 1) {
    if (
      codeLines.has(delimiterIndex) ||
      codeLines.has(delimiterIndex - 1) ||
      !delimiterRow.test(lines[delimiterIndex]) ||
      !tableRow.test(lines[delimiterIndex - 1])
    ) {
      continue;
    }

    lines[delimiterIndex - 1] = removeBreaks(lines[delimiterIndex - 1]);
    for (let rowIndex = delimiterIndex + 1; rowIndex < lines.length; rowIndex += 1) {
      if (codeLines.has(rowIndex) || !tableRow.test(lines[rowIndex])) break;
      lines[rowIndex] = removeBreaks(lines[rowIndex]);
    }
  }

  return lines.join('\n');
}

const remarkPlugins = [remarkGfm, remarkMath, remarkChatDetails, remarkLimitImageResults];
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

function getLanguageLabel(className?: string): string | null {
  const language = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase();
  if (!language) return null;
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

// Dispatches structured display contracts before CodeBlock mounts. Separate
// components (not branches inside CodeBlock) keep CodeBlock's hooks from ever
// being conditionally skipped.
function MarkdownPre({ children, node, ...props }: MarkdownPreProps) {
  const language = getCodeClassName(children)
    ?.match(/(?:^|\s)language-([^\s]+)/)?.[1]
    ?.toLowerCase();
  if (language === 'image-results') {
    return <ChatImageResults code={getTextContent(children)} />;
  }
  if (language === 'weather-results') {
    return <ChatWeatherResults code={getTextContent(children)} />;
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

  const copyControl = (
    <button
      type="button"
      className="chat-code-copy"
      data-selection-exclude
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
  );

  return (
    <div
      className={language ? 'chat-code-block' : 'chat-code-block chat-code-block-unlabelled'}
    >
      {language ? (
        <div className="chat-code-block-header" data-selection-exclude>
          <span className="chat-code-block-language">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12" />
            </svg>
            <span>{language}</span>
          </span>
          {copyControl}
        </div>
      ) : (
        copyControl
      )}
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

type MarkdownTableProps = ComponentProps<'table'> & { node?: unknown };

function MarkdownTable({ node, ...props }: MarkdownTableProps) {
  // Keep the table semantic. The frame is a styling boundary, while the table
  // and its cells are responsible for fitting and wrapping inside the message.
  void node;

  return (
    <div className="chat-table-frame">
      <table {...props} />
    </div>
  );
}

const baseComponents = {
  a: function MarkdownLink({ children, href }: { children?: ReactNode; href?: string }) {
    const openArtifactLink = useContext(ArtifactLinkContext);
    if (!href) return <span>{children}</span>;
    const isWorkflowLink = href === '/workflows' || href?.startsWith('/workflows?');
    const sameTab = isWorkflowLink || href.startsWith('#');
    return (
      <a
        href={href}
        target={sameTab ? undefined : '_blank'}
        rel={sameTab ? undefined : 'noreferrer noopener'}
        onClick={(event) => {
          if (!isSameTabNavigationClick(event)) return;
          if (openArtifactLink?.(href)) event.preventDefault();
          else if (isWorkflowLink) rememberWorkflowReturnPath();
        }}
      >
        {children}
      </a>
    );
  },
  img: ChatMarkdownImage,
  pre: MarkdownPre,
  blockquote: CopyableBlockquote,
  table: MarkdownTable,
} satisfies Components;

function annotationNodeClasses(node: HastNode): unknown[] {
  const className = node.properties?.className;
  return Array.isArray(className) ? className : [className];
}

function annotationNodeHasClass(node: HastNode, ...names: string[]): boolean {
  return annotationNodeClasses(node).some((value) => names.includes(String(value)));
}

function hastText(node: HastNode): string {
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : '';
  return (node.children ?? []).map(hastText).join('');
}

/**
 * Text a node contributes to the annotation offset map when it must not be
 * descended into, or `null` for ordinary nodes. Math is opaque because KaTeX
 * replaces it wholesale and the rendered DOM carries no usable text offsets;
 * the whole formula becomes one run written the way the Markdown spelled it
 * (`$…$`, `$$…$$`), matching `chat-text-selection-ui`'s DOM-side map.
 */
function annotationOpaqueText(node: HastNode): string | null {
  if (node.type !== 'element') return null;
  if (annotationNodeHasClass(node, 'language-image-results', 'language-weather-results')) {
    return '';
  }
  if (node.tagName === 'pre') {
    const children = (node.children ?? []).filter(
      (child) => child.type !== 'text' || String(child.value).trim(),
    );
    const code = children[0];
    if (
      children.length === 1 &&
      code?.type === 'element' &&
      code.tagName === 'code' &&
      annotationNodeHasClass(code, 'language-math', 'math-display', 'math-inline')
    ) {
      return `$$${hastText(code)}$$`;
    }
    return null;
  }
  if (node.tagName === 'code') {
    if (annotationNodeHasClass(node, 'math-display')) return `$$${hastText(node)}$$`;
    if (annotationNodeHasClass(node, 'math-inline', 'language-math')) {
      return `$${hastText(node)}$`;
    }
  }
  return null;
}

function annotationPlainText(tree: HastNode): string {
  let text = '';
  function visit(node: HastNode) {
    if (node.type === 'text' && typeof node.value === 'string') {
      text += node.value;
      return;
    }
    const opaque = annotationOpaqueText(node);
    if (opaque !== null) {
      text += opaque;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return text;
}

const annotationBlockContainers = new Set([
  'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'details',
]);

function rehypeTextAnnotations(annotations: readonly ChatTextAnnotation[]) {
  const valid = [...annotations].filter(
    (annotation) =>
      Number.isSafeInteger(annotation.start) &&
      Number.isSafeInteger(annotation.end) &&
      annotation.start >= 0 &&
      annotation.end > annotation.start,
  );

  return () => (tree: HastNode) => {
    const text = annotationPlainText(tree);
    const sorted = valid
      .flatMap((annotation) => {
        // Reply quotes the original Markdown, while highlights use rendered
        // text offsets. The whole-message marker covers that entire text map.
        if (annotation.wholeMessage) return [{ ...annotation, start: 0, end: text.length }];
        if (!annotation.quote) return [annotation];
        const span = resolveChatTextSelectionAnchor(text, {
          start: annotation.start,
          end: annotation.end,
          quote: annotation.quote,
          prefix: annotation.prefix,
          suffix: annotation.suffix,
        });
        return span ? [{ ...annotation, ...span }] : [];
      })
      .sort((left, right) =>
        ({ answer: 0, chat: 1, highlight: 2 }[left.kind ?? 'answer'] -
          { answer: 0, chat: 1, highlight: 2 }[right.kind ?? 'answer']) ||
        left.start - right.start || left.end - right.end);
    let offset = 0;
    const started = new Set<string>();

    function markElement(annotation: ChatTextAnnotation, children: HastNode[]): HastNode {
      const isRoot = !started.has(annotation.id);
      started.add(annotation.id);
      return {
        type: 'element',
        tagName: 'mark',
        properties: {
          'data-chat-selection-id': annotation.id,
          'data-chat-selection-kind': annotation.kind ?? 'answer',
          ...(annotation.kind === 'highlight'
            ? {
                'data-chat-highlight-color': annotation.color ?? 'blue',
                ...(annotation.note
                  ? { 'data-chat-note': annotation.noteContinuation ? 'continuation' : 'true' }
                  : {}),
              }
            : {}),
          ...(isRoot ? { 'data-chat-selection-root': 'true' } : {}),
        },
        children,
      };
    }

    function visit(parent: HastNode) {
      if (!parent.children) return;
      const nextChildren: HastNode[] = [];
      for (const child of parent.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          const opaque = annotationOpaqueText(child);
          if (opaque === null) {
            visit(child);
            nextChildren.push(child);
            continue;
          }
          // Opaque runs (math) cannot be split: any overlap paints the whole
          // widget. rehype-katex later swaps the formula in place inside the mark.
          const nodeStart = offset;
          const nodeEnd = nodeStart + opaque.length;
          offset = nodeEnd;
          const match = opaque
            ? sorted.find((annotation) => annotation.start < nodeEnd && annotation.end > nodeStart)
            : undefined;
          nextChildren.push(match ? markElement(match, [child]) : child);
          continue;
        }

        const nodeStart = offset;
        const nodeEnd = nodeStart + child.value.length;
        offset = nodeEnd;
        // Markdown inserts newlines between blocks. Wrapping those invisible
        // separators in a padded mark creates stray bars (and extra line boxes).
        // Keep them in the text/offset map, but leave them unpainted. Inline
        // spaces and whitespace inside code still belong to the highlight.
        if (
          !child.value.trim() &&
          (parent.type === 'root' ||
            (annotationBlockContainers.has(parent.tagName ?? '') && /[\r\n]/u.test(child.value)))
        ) {
          nextChildren.push(child);
          continue;
        }
        const matches = sorted.filter(
          (annotation) => annotation.start < nodeEnd && annotation.end > nodeStart,
        );
        if (matches.length === 0) {
          nextChildren.push(child);
          continue;
        }

        // A question can cover part of an existing colored highlight. Split
        // at each boundary so its link wins there without erasing saved notes
        // or nesting interactive marks.
        const boundaries = [...new Set([0, child.value.length, ...matches.flatMap(annotation => [
          Math.max(0, annotation.start - nodeStart),
          Math.min(child.value!.length, annotation.end - nodeStart),
        ])])].sort((left, right) => left - right);
        for (let index = 1; index < boundaries.length; index += 1) {
          const start = boundaries[index - 1], end = boundaries[index];
          const annotation = matches.find(item => item.start < nodeStart + end && item.end > nodeStart + start);
          const text: HastNode = { type: 'text', value: child.value.slice(start, end) };
          nextChildren.push(annotation ? markElement(annotation, [text]) : text);
        }
      }
      parent.children = nextChildren;
    }

    visit(tree);
  };
}

function chatUrlTransform(url: string, key: string): string {
  if (key === 'href') return chatMarkdownHref(url) ?? '';
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

// The note bubble is a hover tooltip on the underlined text: it shows the note
// text and nothing else. It is portalled to the body and fixed-positioned so
// the transcript's overflow clipping and virtualised rows cannot cut it off.
const NOTE_BUBBLE_GAP = 8;
const NOTE_BUBBLE_MAX_WIDTH = 416;
const NOTE_BUBBLE_VIEWPORT_INSET = 12;

type NoteBubbleAnchor = {
  id: string;
  rect: DOMRect;
};

function NoteBubble({
  id,
  text,
  anchor,
}: {
  id: string;
  text: string;
  anchor: DOMRect;
}) {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const maxWidth = Math.min(
    NOTE_BUBBLE_MAX_WIDTH,
    viewportWidth - NOTE_BUBBLE_VIEWPORT_INSET * 2,
  );
  const left = Math.max(
    NOTE_BUBBLE_VIEWPORT_INSET,
    Math.min(anchor.left, viewportWidth - maxWidth - NOTE_BUBBLE_VIEWPORT_INSET),
  );
  // Prefer below the text; flip above when the anchor sits near the bottom edge.
  const spaceBelow = viewportHeight - anchor.bottom;
  const flip = spaceBelow < 160 && anchor.top > spaceBelow;
  const style = flip
    ? { left, bottom: viewportHeight - anchor.top + NOTE_BUBBLE_GAP, maxWidth }
    : { left, top: anchor.bottom + NOTE_BUBBLE_GAP, maxWidth };
  const tailOffset = Math.max(10, Math.min(anchor.left - left + 6, maxWidth - 20));
  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="bb-chat-note"
      data-placement={flip ? 'above' : 'below'}
      data-selection-exclude
      style={{ ...style, ['--bb-chat-note-tail' as string]: `${tailOffset}px` }}
    >
      {text}
    </div>,
    document.body,
  );
}

function ChatMarkdown({
  content,
  compact = false,
  textAnnotations = [],
  onTextAnnotationClick,
}: Props) {
  const noteIdPrefix = useId();
  const annotationClickRef = useRef(onTextAnnotationClick);
  useLayoutEffect(() => { annotationClickRef.current = onTextAnnotationClick; }, [onTextAnnotationClick]);
  const notesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const { id, note, noteContinuation } of textAnnotations) {
      if (note && !noteContinuation) map.set(id, note);
    }
    return map;
  }, [textAnnotations]);
  const [noteAnchor, setNoteAnchor] = useState<NoteBubbleAnchor | null>(null);
  const activeNote = noteAnchor ? notesById.get(noteAnchor.id) : undefined;

  // A fixed bubble would drift away from its text while the transcript
  // scrolls, so any scroll or resize simply dismisses it until the next hover.
  useEffect(() => {
    if (!noteAnchor) return;
    const dismiss = () => setNoteAnchor(null);
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', dismiss, { passive: true });
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true });
      window.removeEventListener('resize', dismiss);
    };
  }, [noteAnchor]);
  // Agent control metadata is useful to its inline card but is never prose.
  // Parse it at the shared Markdown boundary as a fallback for synthesized or
  // legacy messages that lost their dedicated run-card descriptor.
  const normalizedContent = useMemo(
    () =>
      normalizeMathDelimiters(
        normalizeTableCellBreaks(
          repairDamagedLatex(parseGodsEyeResult(content).content),
        ),
      ),
    [content],
  );
  const annotatedRehypePlugins = useMemo(
    () =>
      textAnnotations.length > 0
        ? [rehypeTextAnnotations(textAnnotations), ...rehypePlugins]
        : rehypePlugins,
    [textAnnotations],
  );
  const markdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (markdownRef.current) return containLongChatMarkdown(markdownRef.current);
  }, [normalizedContent, annotatedRehypePlugins]);
  const markdownComponents = useMemo<Components>(
    () => ({
      ...baseComponents,
      mark: ({ children, node, ...props }: ComponentProps<'mark'> & { node?: unknown }) => {
        void node;
        const annotationId = String(
          (props as Record<string, unknown>)['data-chat-selection-id'] ?? '',
        );
        const annotationKind =
          (props as Record<string, unknown>)['data-chat-selection-kind'] === 'highlight'
            ? 'highlight'
            : (props as Record<string, unknown>)['data-chat-selection-kind'] === 'chat'
            ? 'chat'
            : 'answer';
        const hasNote = Boolean((props as Record<string, unknown>)['data-chat-note']);
        const showNote = (element: HTMLElement) => {
          if (hasNote && annotationId) {
            setNoteAnchor({ id: annotationId, rect: element.getBoundingClientRect() });
          }
        };
        const hideNote = () => {
          if (hasNote) setNoteAnchor(null);
        };
        const open = (element: HTMLElement) => {
          if (!annotationId) return;
          hideNote();
          annotationClickRef.current?.(annotationId, element.getBoundingClientRect());
        };
        return (
          <mark
            {...props}
            className="bb-chat-text-highlight"
            role="button"
            tabIndex={0}
            aria-describedby={hasNote ? `${noteIdPrefix}-${annotationId}` : undefined}
            aria-label={
              hasNote
                ? 'Edit note on selected text'
                : annotationKind === 'highlight'
                ? 'Open highlight options'
                : annotationKind === 'chat'
                ? 'Open question in chat'
                : 'Open answer for highlighted text'
            }
            onMouseEnter={(event) => showNote(event.currentTarget)}
            onMouseLeave={hideNote}
            onFocus={(event) => showNote(event.currentTarget)}
            onBlur={hideNote}
            onPointerDown={(event) => { if (event.button === 0) allowMarkTextSelection(event.currentTarget); }}
            onClick={(event) => {
              // A drag beginning inside a saved passage still selects text.
              if (window.getSelection()?.isCollapsed === false) return;
              event.stopPropagation();
              open(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                hideNote();
                return;
              }
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              open(event.currentTarget);
            }}
          >
            {children}
          </mark>
        );
      },
    }),
    [noteIdPrefix],
  );

  return (
    <div ref={markdownRef} className={compact ? 'chat-markdown compact' : 'chat-markdown'}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={annotatedRehypePlugins}
        components={markdownComponents}
        urlTransform={chatUrlTransform}
      >
        {normalizedContent}
      </ReactMarkdown>
      {noteAnchor && activeNote ? (
        <NoteBubble
          id={`${noteIdPrefix}-${noteAnchor.id}`}
          text={activeNote}
          anchor={noteAnchor.rect}
        />
      ) : null}
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
      annotation.end === b[index].end &&
      annotation.kind === b[index].kind &&
      annotation.color === b[index].color &&
      annotation.note === b[index].note &&
      annotation.noteContinuation === b[index].noteContinuation &&
      annotation.quote === b[index].quote &&
      annotation.wholeMessage === b[index].wholeMessage &&
      annotation.prefix === b[index].prefix &&
      annotation.suffix === b[index].suffix,
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
