"use client";

// A message body, rendered the way Buzz renders one.
//
// Two things make this more than "run it through Markdown":
//
//  1. `message-markdown` is the scope the vendored stylesheet hangs its whole
//     message typography on — paragraph rhythm, list spacing, code chips, link
//     colour. Without that class a body gets browser defaults, which is what
//     makes a transcript look flat next to the real app.
//
//  2. Mentions are chips, not plain words. In a room the `@handle` is what
//     decides who answers, so it has to be visibly a reference rather than
//     text that happens to start with an at-sign.

import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/app/buzz/lib/cn";
import { inlineChipIconClasses, MENTION_CHIP_BASE_CLASSES } from "@/app/buzz/ui/mentionChip";

/** Marks a mention so the `a` renderer can turn it into a chip. */
const MENTION_PROTOCOL = "buzz-mention:";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

/**
 * Rewrites `@handle` inside text into link nodes carrying a private protocol.
 *
 * Done on the syntax tree rather than on the raw string so a handle inside a
 * code span or a URL is left alone — the tree already knows which text is
 * prose, and a regex over the source does not.
 */
function remarkMentions(handles: ReadonlySet<string>) {
  const pattern = /(^|[^\w@.])@([a-z0-9][a-z0-9-]{0,39})/gi;

  const splitText = (node: MdastNode): MdastNode[] => {
    const value = node.value ?? "";
    const out: MdastNode[] = [];
    let lastIndex = 0;
    pattern.lastIndex = 0;

    let match = pattern.exec(value);
    while (match) {
      const handle = match[2].toLowerCase();
      if (handles.has(handle)) {
        const start = match.index + match[1].length;
        if (start > lastIndex) {
          out.push({ type: "text", value: value.slice(lastIndex, start) });
        }
        out.push({
          type: "link",
          url: `${MENTION_PROTOCOL}${handle}`,
          children: [{ type: "text", value: `@${handle}` }],
        });
        lastIndex = start + handle.length + 1;
      }
      match = pattern.exec(value);
    }

    if (out.length === 0) return [node];
    if (lastIndex < value.length) {
      out.push({ type: "text", value: value.slice(lastIndex) });
    }
    return out;
  };

  const walk = (node: MdastNode): void => {
    if (!node.children) return;
    const next: MdastNode[] = [];
    for (const child of node.children) {
      // Code keeps its literal text; a handle in a snippet is not a mention.
      if (child.type === "text") next.push(...splitText(child));
      else if (child.type !== "inlineCode" && child.type !== "code") {
        walk(child);
        next.push(child);
      } else next.push(child);
    }
    node.children = next;
  };

  // unified takes a plugin — a function that returns the transformer — so this
  // returns the outer function rather than the transformer itself. Handing it
  // the transformer directly makes unified call it with no tree.
  return function attach() {
    return (tree: MdastNode) => {
      walk(tree);
    };
  };
}

export function MessageMarkdown({
  body,
  members,
  className,
}: {
  body: string;
  /** Handles that exist in this room, and whether each is an agent. */
  members: ReadonlyArray<{ handle: string; kind: "human" | "agent" }>;
  className?: string;
}) {
  const handles = new Set(members.map((member) => member.handle.toLowerCase()));
  const agentHandles = new Set(
    members.filter((m) => m.kind === "agent").map((m) => m.handle.toLowerCase()),
  );

  return (
    <div className={cn("message-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions(handles)]}
        // react-markdown blanks any href whose protocol it does not recognise,
        // which is the right default and would otherwise strip the marker the
        // mention chips are keyed on. Everything else still goes through the
        // stock sanitiser.
        urlTransform={(url) =>
          url.startsWith(MENTION_PROTOCOL) ? url : defaultUrlTransform(url)
        }
        components={{
          a({ href, children }) {
            if (typeof href === "string" && href.startsWith(MENTION_PROTOCOL)) {
              const handle = href.slice(MENTION_PROTOCOL.length);
              return (
                <span
                  className={cn(
                    MENTION_CHIP_BASE_CLASSES,
                    inlineChipIconClasses(
                      agentHandles.has(handle) ? "agent" : "human",
                    ),
                  )}
                  data-mention-handle={handle}
                >
                  {children as ReactNode}
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children as ReactNode}
              </a>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
