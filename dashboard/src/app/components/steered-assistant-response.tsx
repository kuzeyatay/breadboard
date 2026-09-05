"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatTextAnnotation } from "./chat-markdown";
import {
  chatSelectableText,
  SelectableAssistantMarkdown,
  type ChatTextSelectionCandidate,
  type FloatingAnchorRect,
} from "./chat-text-selection-ui";
import CollapsibleUserMessage from "./chat/collapsible-user-message";
import { UserMessageText } from "./hermes/command-text";
import { resolveChatTextSelectionAnchor } from "@/lib/chat-text-selection";
import {
  splitSteeredResponse,
  type CourseCorrectionBoundary,
} from "@/lib/steered-response";

export default function SteeredAssistantResponse({
  content,
  corrections,
  sourceMessageId,
  annotations,
  onSelection,
  onOpenAnnotation,
}: {
  content: string;
  corrections: readonly CourseCorrectionBoundary[];
  sourceMessageId: string;
  annotations: readonly ChatTextAnnotation[];
  onSelection: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation: (annotationId: string, anchor: FloatingAnchorRect) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => splitSteeredResponse(content, corrections), [content, corrections]);
  const [segmentTexts, setSegmentTexts] = useState<string[]>([]);

  // Markdown offsets differ from rendered text offsets. Measure the same text
  // the selection handler sees, excluding the interleaved user bubbles.
  useLayoutEffect(() => {
    const texts = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-chat-selectable-message]") ?? [],
      chatSelectableText,
    );
    setSegmentTexts((current) =>
      current.length === texts.length && current.every((text, index) => text === texts[index])
        ? current
        : texts,
    );
  }, [segments]);

  const annotationsBySegment = useMemo(() => {
    const text = segmentTexts.join("");
    // Resolve against the whole response first so a repeated phrase is painted
    // only where it was selected, even on opposite sides of a correction.
    const resolved = annotations.flatMap((annotation) => {
      const span = annotation.quote
        ? resolveChatTextSelectionAnchor(text, { ...annotation, quote: annotation.quote })
        : annotation;
      return span ? [{ ...annotation, ...span }] : [];
    });
    let offset = 0;
    return segmentTexts.map((segmentText) => {
      const start = offset;
      offset += segmentText.length;
      return resolved.flatMap((annotation) => {
        const localStart = Math.max(0, annotation.start - start);
        const localEnd = Math.min(segmentText.length, annotation.end - start);
        if (localEnd <= localStart) return [];
        return [{
          ...annotation,
          start: localStart,
          end: localEnd,
          quote: segmentText.slice(localStart, localEnd),
          prefix: segmentText.slice(Math.max(0, localStart - 160), localStart),
          suffix: segmentText.slice(localEnd, localEnd + 160),
        }];
      });
    });
  }, [annotations, segmentTexts]);

  let assistantIndex = 0;
  return (
    <div ref={rootRef} className="space-y-4">
      {segments.map((segment) =>
        segment.kind === "assistant" ? (
          <SelectableAssistantMarkdown
            key={segment.key}
            content={segment.content}
            sourceMessageId={sourceMessageId}
            annotations={annotationsBySegment[assistantIndex++] ?? []}
            onSelection={onSelection}
            onOpenAnnotation={onOpenAnnotation}
            selectionScopeRef={rootRef}
          />
        ) : (
          <div key={segment.key} data-selection-exclude className="group flex justify-end py-1">
            <div className="w-fit max-w-[75%]">
              <div className="neu-chat-message neu-chat-message-user rounded-[22px] px-4 py-2.5 text-sm leading-6">
                <CollapsibleUserMessage messageKey={`steer:${segment.key}`}>
                  <UserMessageText content={segment.content} />
                </CollapsibleUserMessage>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
