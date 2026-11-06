"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Root, RootContent, PhrasingContent } from "mdast";
import { normalizeMathDelimiters } from "@/lib/chat-markdown-math";

/** Flatten the parsed preview, keeping equations intact and links non-interactive
 * because the entire notification card is already a button. */
function remarkNotificationPreview({ maxLength = 360 }: { maxLength?: number } = {}) {
  return (tree: Root) => {
    const children: PhrasingContent[] = [];
    let remaining = maxLength;
    let truncated = false;

    function text(value: string) {
      const normalized = value.replace(/\s+/g, " ");
      if (!normalized) return;
      if (normalized.length > remaining) truncated = true;
      const preview = normalized.slice(0, remaining);
      if (preview) children.push({ type: "text", value: preview });
      remaining -= preview.length;
    }

    function visit(node: Root | RootContent) {
      if (node.type === "math" || node.type === "inlineMath") {
        if (remaining <= 0 || node.value.length > 4_000) {
          truncated = true;
          remaining = 0;
          return;
        }
        // Truncate after parsing, never inside TeX commands or delimiters.
        children.push({
          type: "inlineMath", value: node.value,
          data: {
            hName: "span",
            hProperties: { className: [node.type === "math" ? "math-display" : "math-inline"] },
            hChildren: [{ type: "text", value: node.value }],
          },
        });
        remaining = Math.max(0, remaining - node.value.length);
        if (node.type === "math" && remaining > 0) text(" ");
      } else if (node.type === "text" || node.type === "inlineCode" || node.type === "code") {
        text(node.value);
        if (node.type === "code" && remaining > 0) text(" ");
      } else if (node.type === "image" || node.type === "imageReference") {
        text(node.alt || "");
      } else if (node.type === "break" || node.type === "thematicBreak") {
        text(" ");
      } else if ("children" in node) {
        for (const child of node.children) {
          visit(child);
          if (truncated) break;
        }
        if (["paragraph", "heading", "tableCell"].includes(node.type) && remaining > 0) text(" ");
      }
    }

    visit(tree);
    if (truncated) children.push({ type: "text", value: "…" });
    tree.children = [{ type: "paragraph", children }];
  };
}

const remarkPlugins = [remarkGfm, remarkMath, remarkNotificationPreview];
const expandedRemarkPlugins = [remarkGfm, remarkMath, () => remarkNotificationPreview({ maxLength: Infinity })];
const rehypePlugins = [rehypeKatex];
const components = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> };

export default memo(function NotificationPreview({ content, className, expanded = false }: { content: string; className?: string; expanded?: boolean }) {
  return <p className={className}>
    <ReactMarkdown remarkPlugins={expanded ? expandedRemarkPlugins : remarkPlugins} rehypePlugins={rehypePlugins} components={components} skipHtml>
      {normalizeMathDelimiters(content)}
    </ReactMarkdown>
  </p>;
});
