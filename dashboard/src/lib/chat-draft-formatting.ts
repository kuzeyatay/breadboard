export interface DraftRange {
  start: number;
  end: number;
}

export interface DraftEdit extends DraftRange {
  replacement: string;
  selection: DraftRange;
}

export const DRAFT_TEXT_STYLES = [
  { id: "text", label: "Text" },
  { id: "heading1", label: "Heading 1" },
  { id: "heading2", label: "Heading 2" },
  { id: "heading3", label: "Heading 3" },
  { id: "numbered", label: "Numbered list" },
  { id: "bulleted", label: "Bulleted list" },
] as const;

export type DraftTextStyle = (typeof DRAFT_TEXT_STYLES)[number]["id"];
export type DraftEmphasis = "**" | "*";

export function hasDraftFormatting(value: string) {
  return /^(?: {0,3})(?:#{1,3}|[-+*]|\d{1,9}[.)])[\t ]+\S/m.test(value) ||
    /\*\S[\s\S]*?\S\*|\*\S\*|\]\(<https?:\/\//i.test(value);
}

function textRange(value: string, { start, end }: DraftRange): DraftRange {
  const selected = value.slice(start, end);
  return {
    start: start + selected.length - selected.trimStart().length,
    end: start + selected.trimEnd().length,
  };
}

function emphasisRange(value: string, selection: DraftRange, mark: DraftEmphasis) {
  const range = textRange(value, selection);
  const selected = value.slice(range.start, range.end);
  const matches = (count: number) => mark === "**" ? count >= 2 : count % 2 === 1;
  const leading = /^\*+/.exec(selected)?.[0].length ?? 0;
  const trailing = /\*+$/.exec(selected)?.[0].length ?? 0;
  if (selected.length > leading + trailing && matches(leading) && matches(trailing)) {
    return range;
  }
  const before = /\*+$/.exec(value.slice(0, range.start))?.[0].length ?? 0;
  const after = /^\*+/.exec(value.slice(range.end))?.[0].length ?? 0;
  if (!matches(before) || !matches(after)) return null;
  return { start: range.start - mark.length, end: range.end + mark.length };
}

function emphasisSpans(value: string, selection: DraftRange) {
  const spans: DraftRange[] = [];
  let offset = selection.start;
  for (const part of value.slice(selection.start, selection.end).split(/(\n(?:[\t ]*\n)+)/)) {
    const end = offset + part.length;
    if (part.trim()) spans.push(textRange(value, { start: offset, end }));
    offset = end;
  }
  return spans;
}

export function draftHasEmphasis(value: string, selection: DraftRange, mark: DraftEmphasis) {
  const spans = emphasisSpans(value, selection);
  return spans.length > 0 && spans.every(span => emphasisRange(value, span, mark) !== null);
}

function editEmphasisSpan(value: string, range: DraftRange, mark: DraftEmphasis, marked: DraftRange | null): DraftEdit {
  if (marked) {
    const replacement = value.slice(marked.start + mark.length, marked.end - mark.length);
    return {
      ...marked,
      replacement,
      selection: {
        start: Math.max(marked.start, range.start - mark.length),
        end: Math.min(marked.start + replacement.length, range.end - mark.length),
      },
    };
  }
  return {
    ...range,
    replacement: mark + value.slice(range.start, range.end) + mark,
    selection: { start: range.start + mark.length, end: range.end + mark.length },
  };
}

export function editDraftEmphasis(value: string, selection: DraftRange, mark: DraftEmphasis): DraftEdit {
  const spans = emphasisSpans(value, selection);
  const marked = spans.map(span => emphasisRange(value, span, mark));
  if (spans.length === 1) return editEmphasisSpan(value, spans[0], mark, marked[0]);
  const remove = marked.every(Boolean);
  const edits = spans.flatMap((span, index) => {
    if (!remove && marked[index]) return [];
    return [editEmphasisSpan(value, span, mark, marked[index])];
  });
  const start = Math.min(selection.start, edits[0]?.start ?? selection.start);
  const end = Math.max(selection.end, edits.at(-1)?.end ?? selection.end);
  let cursor = start;
  const replacement = edits.map(edit => {
    const text = value.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
    return text;
  }).join("") + value.slice(cursor, end);
  return { start, end, replacement, selection: { start, end: start + replacement.length } };
}

const BLOCK_PREFIX = /^( {0,3})(#{1,6}|[-+*]|\d{1,9}[.)])[\t ]+/;

function draftLines(value: string, selection: DraftRange) {
  const start = selection.start === 0 ? 0 : value.lastIndexOf("\n", selection.start - 1) + 1;
  const lineBreak = value.indexOf("\n", Math.max(selection.start, selection.end - 1));
  const end = lineBreak === -1 ? value.length : lineBreak;
  return { start, end, lines: value.slice(start, end).split("\n") };
}

function lineStyle(line: string): DraftTextStyle | null {
  const prefix = BLOCK_PREFIX.exec(line)?.[2];
  if (!prefix) return "text";
  if (prefix === "#") return "heading1";
  if (prefix === "##") return "heading2";
  if (prefix === "###") return "heading3";
  if (/^\d/.test(prefix)) return "numbered";
  return prefix.startsWith("#") ? null : "bulleted";
}

export function draftTextStyle(value: string, selection: DraftRange): DraftTextStyle | null {
  const styles = draftLines(value, selection).lines.filter(line => line.trim()).map(lineStyle);
  return styles.every(style => style === styles[0]) ? styles[0] ?? null : null;
}

const STYLE_MARKERS = { text: "", heading1: "# ", heading2: "## ", heading3: "### ", bulleted: "- " };

export function editDraftTextStyle(value: string, selection: DraftRange, style: DraftTextStyle): DraftEdit {
  const { start, end, lines } = draftLines(value, selection);
  let listNumber = 0;
  const replacement = lines.map(line => {
    if (!line.trim()) return line;
    const marker = style === "numbered" ? `${++listNumber}. ` : STYLE_MARKERS[style];
    return marker + line.replace(BLOCK_PREFIX, "$1");
  }).join("\n");
  return { start, end, replacement, selection: { start, end: start + replacement.length } };
}

export function editDraftLink(value: string, selection: DraftRange, href: string): DraftEdit {
  const range = textRange(value, selection);
  const label = value.slice(range.start, range.end).replace(/\s*\n\s*/g, " ").replace(/[\\[\]]/g, "\\$&");
  const replacement = `[${label}](<${href}>)`;
  return {
    ...range,
    replacement,
    selection: { start: range.start, end: range.start + replacement.length },
  };
}
