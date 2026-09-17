import assert from "node:assert/strict";
import test from "node:test";
import {
  intersectPdfRects,
  normalizePdfHighlights,
  pdfAssistantDocumentKey,
  pdfDocumentExcerpt,
  pdfViewContext,
} from "../src/lib/pdf-assistant.ts";
import { chatTextSelectionQuestionPrompt } from "../src/lib/chat-text-selection.ts";
import { isPdfAssistantPageContext } from "../src/lib/pdf-assistant-scope.ts";
import {
  parsePdfViewDecision,
  pdfViewDecisionMessages,
} from "../src/lib/pdf-assistant-view-decision.ts";

const selection = {
  id: "highlight:1",
  sourceMessageId: "pdf:abc:page:2",
  mode: "inline",
  start: 0,
  end: 13,
  quote: "selected text",
};
test("PDF identities separate documents and remain stable", () => {
  const url = "/api/documents/paper/source-pdf?clusterSlug=physics";
  assert.equal(pdfAssistantDocumentKey(url), pdfAssistantDocumentKey(url));
  assert.notEqual(
    pdfAssistantDocumentKey(url),
    pdfAssistantDocumentKey(url.replace("physics", "math")),
  );
  assert.notEqual(
    pdfAssistantDocumentKey("/api/artifacts/1/file"),
    pdfAssistantDocumentKey("/api/artifacts/2/file"),
  );
});
test("only terminal PDF document keys can scope a page without a garden", () => {
  const key = pdfAssistantDocumentKey("/api/attachments/document.pdf");
  assert.equal(isPdfAssistantPageContext("dashboard_terminal", key), true);
  for (const [surface, page] of [
    ["quartz_ai", key],
    ["garden_chat", key],
    ["dashboard_terminal", "private/note"],
    ["dashboard_terminal", "pdf:../../secret"],
    ["dashboard_terminal", null],
  ]) {
    assert.equal(isPdfAssistantPageContext(surface, page), false);
  }
});
test("screenshots clip partial, zoomed and offscreen page rectangles", () => {
  assert.deepEqual(
    intersectPdfRects(
      { left: -300, right: 1200, top: -800, bottom: 200 },
      { left: 20, right: 800, top: 40, bottom: 640 },
    ),
    { left: 20, right: 800, top: 40, bottom: 200, width: 780, height: 160 },
  );
  assert.equal(
    intersectPdfRects(
      { left: 0, right: 10, top: 0, bottom: 20 },
      { left: 0, right: 10, top: 20, bottom: 40 },
    ),
    null,
  );
});
test("persisted PDF marks reject malformed text anchors and page coordinates", () => {
  const mark = {
    selection,
    color: "blue",
    rects: [{ page: 2, left: 0.1, top: 0.2, width: 0.3, height: 0.02 }],
    conversationId: "conv_test",
    note: "  Review this equation  ",
  };
  assert.equal(normalizePdfHighlights([mark])[0].conversationId, "conv_test");
  assert.equal(normalizePdfHighlights([mark])[0].note, "Review this equation");
  assert.deepEqual(
    normalizePdfHighlights([
      { ...mark, selection: { ...selection, end: 12 } },
      { ...mark, color: "red" },
      { ...mark, rects: [{ ...mark.rects[0], page: -1 }] },
      { ...mark, rects: [{ ...mark.rects[0], left: 0.99 }] },
      null,
    ]),
    [],
  );
  assert.deepEqual(normalizePdfHighlights({}), []);
});
test("reading context labels visual evidence and treats document contents as data", () => {
  const input = {
    title: "Paper",
    pageCount: 9,
    pageNumber: 4,
    pages: [3, 4],
    text: "Current page prose",
    selection,
  };
  const visual = pdfViewContext({
    ...input,
    capturedAt: "2026-09-06T10:00:00Z",
  });
  assert.match(visual.text, /fresh screenshot/);
  assert.match(visual.text, /"visiblePages":\[3,4\]/);
  assert.match(visual.text, /"highlightedText":"selected text"/);
  assert.match(visual.text, /not instructions/);
  assert.match(pdfViewContext(input).text, /No screenshot is attached/);
  assert.match(
    chatTextSelectionQuestionPrompt("Explain", selection),
    /excerpt from the PDF/,
  );
  assert.doesNotMatch(
    chatTextSelectionQuestionPrompt("Explain", selection),
    /earlier assistant response/,
  );
});
test("document text preserves physical page numbers and bounds long previews", async () => {
  const pdf = {
    numPages: 2,
    getPage: async (page) => ({
      getTextContent: async () => ({
        items: [
          { str: `Page ${page} text`, hasEOL: true },
          { str: "Second line", hasEOL: false },
        ],
      }),
    }),
  };
  assert.match(
    await pdfDocumentExcerpt(pdf),
    /\[PDF page 2\]\nPage 2 text\nSecond line/,
  );
  const long = {
    numPages: 500,
    getPage: async () => ({
      getTextContent: async () => ({ items: [{ str: "x".repeat(60_000) }] }),
    }),
  };
  const text = await pdfDocumentExcerpt(long);
  assert.ok(text.length < 101_000);
  assert.match(text, /attached PDF contains all pages/);
});

test("the assistant's explicit screenshot decision is preserved, with no keyword fallback", () => {
  assert.deepEqual(parsePdfViewDecision('{"captureView":true}'), {
    captureView: true,
  });
  assert.deepEqual(
    parsePdfViewDecision('```json\n{"captureView":false}\n```'),
    { captureView: false },
  );
  for (const raw of [
    '{"captureView":"false"}',
    "{}",
    "null",
    "Take a screenshot",
    "",
  ]) {
    assert.equal(parsePdfViewDecision(raw), null);
  }
  const messages = pdfViewDecisionMessages({
    question: "What does that curve show?",
    title: "Signals",
    pageNumber: 2,
    pageText: "text".repeat(10_000),
    selectedText: "A figure",
    history: [{ role: "assistant", content: "Look at the second plot." }],
  });
  assert.match(messages[0].content, /Decide whether to request a screenshot/);
  assert.match(messages[0].content, /Skip it when/);
  const evidence = JSON.parse(messages[1].content);
  assert.equal(evidence.currentPage, 2);
  assert.equal(evidence.currentPageText.length, 16_000);
  assert.equal(
    evidence.recentConversation[0].content,
    "Look at the second plot.",
  );
});
