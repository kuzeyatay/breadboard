import { Lexer, type Token, type Tokens } from "marked";

export interface TelegramTextEntity {
  type: "bold" | "italic" | "strikethrough" | "code" | "pre" | "text_link" | "blockquote";
  /** Telegram and JavaScript both measure these in UTF-16 code units. */
  offset: number;
  length: number;
  url?: string;
  language?: string;
}

export interface TelegramText {
  text: string;
  entities: TelegramTextEntity[];
}

export const TELEGRAM_MESSAGE_LIMIT = 3_800;

const plain = (text: string): TelegramText => ({ text, entities: [] });

function join(parts: TelegramText[]): TelegramText {
  const result = plain("");
  for (const part of parts) {
    const offset = result.text.length;
    result.text += part.text;
    result.entities.push(...part.entities.map((entity) => ({ ...entity, offset: offset + entity.offset })));
  }
  return result;
}

/** Slice text and rebase any intersecting formatting, including across chunks. */
function slice(message: TelegramText, start: number, end: number): TelegramText {
  return {
    text: message.text.slice(start, end),
    entities: message.entities.flatMap((entity) => {
      const from = Math.max(start, entity.offset);
      const to = Math.min(end, entity.offset + entity.length);
      return to > from ? [{ ...entity, offset: from - start, length: to - from }] : [];
    }),
  };
}

function trim(message: TelegramText): TelegramText {
  let start = message.text.length - message.text.trimStart().length;
  let end = message.text.trimEnd().length;
  for (const entity of message.entities) {
    if (entity.type !== "code" && entity.type !== "pre") continue;
    start = Math.min(start, entity.offset);
    end = Math.max(end, entity.offset + entity.length);
  }
  return slice(message, start, end);
}

function styled(message: TelegramText, type: TelegramTextEntity["type"], extra: Partial<TelegramTextEntity> = {}): TelegramText {
  // Code cannot overlap other entities, and block quotes cannot nest. Keep
  // these spans intact while applying the enclosing emphasis around them.
  const excluded = message.entities.filter((entity) =>
    entity.type === "code" || entity.type === "pre" || (type === "blockquote" && entity.type === "blockquote"),
  ).sort((a, b) => a.offset - b.offset);
  const entities = [...message.entities];
  let start = 0;
  for (const entity of [...excluded, { offset: message.text.length, length: 0 }]) {
    if (entity.offset > start) entities.push({ ...extra, type, offset: start, length: entity.offset - start });
    start = Math.max(start, entity.offset + entity.length);
  }
  return { text: message.text, entities };
}

function decodeText(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? whole;
    const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : whole;
  });
}

function link(label: TelegramText, href: string): TelegramText {
  const url = decodeText(href);
  try {
    if (["http:", "https:", "mailto:", "tel:", "tg:"].includes(new URL(url).protocol) && !/[<>\s]/.test(url)) {
      // A code-formatted link label is still a link; Telegram forbids code
      // nested inside links, so retain the destination and drop that styling.
      return styled({ ...label, entities: label.entities.filter((entity) => entity.type !== "code") }, "text_link", { url });
    }
  } catch { /* Relative Breadboard links remain readable as text. */ }
  return join([label, plain(label.text === url ? "" : ` (${url})`)]);
}

function render(tokens: Token[], listDepth = 0): TelegramText {
  return join(tokens.map((token): TelegramText => {
    const children = () => render("tokens" in token ? token.tokens ?? [] : [], listDepth);
    switch (token.type) {
      case "space": case "def": case "checkbox": return plain("");
      case "paragraph": return join([children(), plain("\n\n")]);
      case "heading": return join([styled(children(), "bold"), plain("\n\n")]);
      case "strong": return styled(children(), "bold");
      case "em": return styled(children(), "italic");
      case "del": return styled(children(), "strikethrough");
      case "codespan": return styled(plain(token.text), "code");
      case "code": return join([
        styled(plain(token.text), "pre", token.lang ? { language: token.lang.split(/\s/)[0] } : {}),
        plain("\n\n"),
      ]);
      case "br": return plain("\n");
      case "hr": return plain("────\n\n");
      case "blockquote": return join([styled(trim(children()), "blockquote"), plain("\n\n")]);
      case "link": return link(children(), token.href);
      case "image": return link(children().text ? children() : plain("Image"), token.href);
      case "list": return join([
        plain(listDepth ? "\n" : ""),
        ...token.items.map((item: Tokens.ListItem, index: number) => join([
          plain("  ".repeat(listDepth) + (item.task ? (item.checked ? "☑ " : "☐ ") : token.ordered ? `${Number(token.start) + index}. ` : "• ")),
          trim(render(item.tokens ?? [], listDepth + 1)), plain("\n"),
        ])), plain("\n"),
      ]);
      case "table": {
        // Narrow field/value rows stay readable on a phone, unlike a raw pipe grid.
        const headers = token.header.map((cell: { tokens: Token[] }) => render(cell.tokens));
        if (!token.rows.length) return join(headers.flatMap((header: TelegramText) => [header, plain("\n")]));
        return join(token.rows.flatMap((row: Array<{ tokens: Token[] }>) => [
          ...row.flatMap((cell, index) => [headers[index], plain(": "), render(cell.tokens), plain("\n")]),
          plain("\n"),
        ]));
      }
      // Raw HTML is literal text, never parsed by Telegram. This also preserves
      // guardrail placeholders such as <EMAIL_ADDRESS> and mathematical < signs.
      case "html": return plain(token.raw);
      case "escape": return plain(token.text);
      case "text": return token.tokens ? children() : plain(decodeText(token.text));
      default: return "tokens" in token ? children() : plain(token.raw);
    }
  }));
}

/** Parse ordinary assistant Markdown locally; never ask Telegram to parse it. */
export function formatTelegramText(markdown: string): TelegramText {
  const result = trim(render(Lexer.lex(markdown, { gfm: true })));
  result.entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return result;
}

export function splitTelegramText(message: TelegramText, limit = TELEGRAM_MESSAGE_LIMIT): TelegramText[] {
  if (!Number.isInteger(limit) || limit < 2 || limit > TELEGRAM_MESSAGE_LIMIT) throw new RangeError("Invalid Telegram chunk limit");
  const chunks: TelegramText[] = [];
  for (let start = 0; start < message.text.length;) {
    let end = Math.min(start + limit, message.text.length);
    if (end < message.text.length) {
      // Prefer a paragraph, line or word break while retaining the exact text.
      const window = message.text.slice(start, end);
      for (const separator of ["\n\n", "\n", " "]) {
        const boundary = window.lastIndexOf(separator);
        if (boundary >= limit / 2) { end = start + boundary + separator.length; break; }
      }
      if (/[\uD800-\uDBFF]/u.test(message.text[end - 1]) && /[\uDC00-\uDFFF]/u.test(message.text[end])) end -= 1;
    }
    const chunk = slice(message, start, end);
    if (chunk.text.trim()) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

/** Plain-text callers share the same Unicode-safe chunking. */
export function splitForTelegram(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  return splitTelegramText(plain(text.trim()), limit).map((chunk) => chunk.text);
}
