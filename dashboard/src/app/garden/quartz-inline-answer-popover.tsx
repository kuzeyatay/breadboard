'use client';

import { useEffect, useState, type RefObject } from 'react';
import {
  InlineSelectionAnswerPopover,
  type ChatTextSelectionCandidate,
  type FloatingAnchorRect,
} from '@/app/components/chat-text-selection-ui';
import type { ChatTextAnnotation } from '@/app/components/chat-markdown';
import type { QuartzInlineAnswerUpdate } from '@/lib/quartz-assistant-selection';

/**
 * The Assistant's own selection controller. A page answer is a message in its
 * transcript, so text selected inside the answer opens the same menu and a
 * nested "Ask here" answer, just as in Terminal and the Garden workspace.
 */
export interface QuartzAnswerSelection {
  messageIdFor: (requestId: string) => string | undefined;
  annotations: ReadonlyMap<string, readonly ChatTextAnnotation[]>;
  onSelection: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation: (annotationId: string, anchor: FloatingAnchorRect) => void;
}

const NO_ANNOTATIONS: readonly ChatTextAnnotation[] = [];

interface PageAnswer extends QuartzInlineAnswerUpdate {
  anchor: FloatingAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
}

function pageAnswer(value: unknown): PageAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as PageAnswer;
  if (
    typeof data.requestId !== 'string' || typeof data.highlightId !== 'string' ||
    typeof data.question !== 'string' || typeof data.answer !== 'string' ||
    !['pending', 'streaming', 'complete', 'error'].includes(data.state) ||
    !data.anchor || !['left', 'right', 'top', 'bottom', 'width', 'height'].every(
      key => Number.isFinite(data.anchor[key as keyof FloatingAnchorRect]),
    ) ||
    !Number.isFinite(data.viewportWidth) || data.viewportWidth <= 0 ||
    !Number.isFinite(data.viewportHeight) || data.viewportHeight <= 0
  ) return null;
  return data;
}

/** Page highlights stay in Quartz; their answers use the same UI as chat selections. */
export default function QuartzInlineAnswerPopover({ iframeRef, quartzOrigin, answerSelection }: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  quartzOrigin: string;
  answerSelection?: QuartzAnswerSelection;
}) {
  const [answer, setAnswer] = useState<PageAnswer | null>(null);
  const open = answer !== null;

  useEffect(() => {
    if (!quartzOrigin) return;
    function connect() {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'second-brain:assistant-inline-popover-host' }, quartzOrigin,
      );
    }
    function receive(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== quartzOrigin) return;
      const data = event.data;
      if (data?.type === 'second-brain:assistant-inline-popover-ready') connect();
      if (data?.type !== 'second-brain:assistant-inline-popover') return;
      if (data.open === false) setAnswer(null);
      else {
        const next = pageAnswer(data);
        const frame = iframeRef.current;
        if (!next || !frame) return;
        const rect = frame.getBoundingClientRect();
        const scaleX = frame.clientWidth / next.viewportWidth;
        const scaleY = frame.clientHeight / next.viewportHeight;
        const left = rect.left + frame.clientLeft;
        const top = rect.top + frame.clientTop;
        setAnswer({ ...next, anchor: {
          left: left + next.anchor.left * scaleX,
          right: left + next.anchor.right * scaleX,
          top: top + next.anchor.top * scaleY,
          bottom: top + next.anchor.bottom * scaleY,
          width: next.anchor.width * scaleX,
          height: next.anchor.height * scaleY,
        } });
      }
    }
    function frameLoaded(event: Event) {
      if (event.target !== iframeRef.current) return;
      setAnswer(null);
      connect();
    }
    window.addEventListener('message', receive);
    document.addEventListener('load', frameLoaded, true);
    connect();
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('load', frameLoaded, true);
    };
  }, [iframeRef, quartzOrigin]);

  // Both documents scroll independently. Ask Quartz for a fresh anchor after
  // host layout changes instead of retaining coordinates from an old viewport.
  useEffect(() => {
    if (!open || !quartzOrigin) return;
    const frame = iframeRef.current;
    function refresh() {
      frame?.contentWindow?.postMessage(
        { type: 'second-brain:assistant-inline-popover-host' }, quartzOrigin,
      );
    }
    const observer = new ResizeObserver(refresh);
    if (frame) observer.observe(frame);
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
    };
  }, [open, iframeRef, quartzOrigin]);

  function act(action: 'close' | 'delete' | 'stop' | 'retry', question?: string) {
    if (!answer) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'second-brain:assistant-inline-popover-action', action, question,
      requestId: answer.requestId, highlightId: answer.highlightId,
    }, quartzOrigin);
    if (action !== 'stop') setAnswer(null);
  }
  if (!answer) return null;
  const answerMessageId = answerSelection?.messageIdFor(answer.requestId);
  return <InlineSelectionAnswerPopover
    answerMessageId={answerMessageId}
    annotations={answerMessageId ? answerSelection?.annotations.get(answerMessageId) ?? NO_ANNOTATIONS : undefined}
    onSelection={answerSelection?.onSelection}
    onOpenAnnotation={answerSelection?.onOpenAnnotation}
    key={answer.requestId}
    anchor={answer.anchor}
    notificationSelectionId={answer.requestId}
    question={answer.question}
    answer={answer.answer}
    pending={answer.state === 'pending' || answer.state === 'streaming'}
    responseDurationMs={answer.responseDurationMs}
    onClose={() => act('close')}
    onDelete={() => act('delete')}
    onStop={() => act('stop')}
    onAskAgain={question => act('retry', question)}
  />;
}
