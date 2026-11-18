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
  } catch { /* A relative Breadboard path means nothing on a phone: keep the label. */ }
  if (!/^[a-z][a-z\d+.-]*:/i.test(url)) return label;
  return join([label, plain(label.text === url ? "" : ` (${url})`)]);
}

// Math and stray emphasis are what leak "weird symbols" into a phone chat:
// Telegram renders neither LaTeX nor an unclosed `**`. Math spans are lifted
// out before Markdown parsing (which would eat their backslashes) and come
// back as plain Unicode; leftover `**` pairs become bold, lone ones vanish.
const MATH_OPEN = String.fromCharCode(0xe000);
const MATH_CLOSE = String.fromCharCode(0xe001);
const MATH_SPAN = new RegExp(`${MATH_OPEN}([^${MATH_CLOSE}]*)${MATH_CLOSE}`, "g");

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", propto: "∝", infty: "∞", partial: "∂", nabla: "∇",
  int: "∫", iint: "∬", oint: "∮", sum: "∑", prod: "∏", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", leftrightarrow: "↔", implies: "⇒", iff: "⇔",
  mapsto: "↦", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", emptyset: "∅",
  forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", angle: "∠", circ: "∘", degree: "°",
  ldots: "…", cdots: "⋯", dots: "…", hbar: "ħ", ell: "ℓ", star: "⋆", perp: "⊥", parallel: "∥",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", prime: "′",
  quad: " ", qquad: "  ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ", "%": "%", "$": "$",
  "{": "{", "}": "}", "&": "&", "#": "#", "_": "_", "|": "‖",
};
const SUPERSCRIPT: Record<string, string> = Object.fromEntries(
  [..."0123456789+-=()niT"].map((c, i) => [c, [..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵀ"][i]]),
);
const SUBSCRIPT: Record<string, string> = Object.fromEntries(
  [..."0123456789+-=()aeoxijknmtprs"].map((c, i) => [c, [..."₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓᵢⱼₖₙₘₜₚᵣₛ"][i]]),
);

function script(body: string, table: Record<string, string>, marker: string): string {
  const chars = [...body];
  if (chars.length && chars.every((c) => table[c])) return chars.map((c) => table[c]).join("");
  return /^[\p{L}\p{N}]+$/u.test(body) ? `${marker}${body}` : `${marker}(${body})`;
}

const group = (inner: string) => (/^[\p{L}\p{N}.√]+$/u.test(inner) || /^\(.*\)$/.test(inner) ? inner : `(${inner})`);

/** Render a LaTeX fragment as readable Unicode (x², √x, a/b, α ≤ β). */
export function latexToText(latex: string): string {
  let text = latex
    .replace(/\\(?:begin|end)\{[^{}]*\}/g, " ")
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/&/g, " ");
  // Innermost-first: each pass resolves the groups that contain no braces.
  for (let pass = 0; pass < 12; pass += 1) {
    const before = text;
    text = text
      .replace(/\\(?:mathrm|mathbf|mathit|mathsf|mathcal|mathbb|boldsymbol|text|textbf|textit|textrm|operatorname|mbox|vec|hat|bar|overline|tilde|dot)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) => `${group(a.trim())}/${group(b.trim())}`)
      // Brace-less shorthand: \frac12, \frac1n, \frac{a}b, \frac a{b}.
      .replace(/\\[dt]?frac\s*(?:\{([^{}]*)\}|([A-Za-z0-9]))\s*(?:\{([^{}]*)\}|([A-Za-z0-9]))/g,
        (_, a1?: string, a2?: string, b1?: string, b2?: string) =>
          `${group((a1 ?? a2 ?? "").trim())}/${group((b1 ?? b2 ?? "").trim())}`)
      .replace(/\\sqrt\s*\[([^{}\]]*)\]\s*\{([^{}]*)\}/g, (_, n: string, x: string) => `${script(n, SUPERSCRIPT, "^")}√${group(x.trim())}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, x: string) => `√${group(x.trim())}`)
      .replace(/\^\s*\{([^{}]*)\}/g, (_, x: string) => script(x.trim(), SUPERSCRIPT, "^"))
      .replace(/_\s*\{([^{}]*)\}/g, (_, x: string) => script(x.trim(), SUBSCRIPT, "_"));
    // Bare grouping braces go last, or `\frac{1}{\sqrt{x}}` would lose its own.
    if (text === before) text = text.replace(/(?<!\\)\{([^{}]*)\}/g, "$1");
    if (text === before) break;
  }
  return text
    .replace(/\\([a-zA-Z]+|.)/g, (whole, name: string) => LATEX_SYMBOLS[name] ?? (/^[a-zA-Z]+$/.test(name) ? name : whole))
    .replace(/\^([\p{L}\p{N}+-])(?![A-Za-z0-9])/gu, (_, x: string) => script(x, SUPERSCRIPT, "^"))
    .replace(/_([\p{L}\p{N}])(?![A-Za-z0-9])/gu, (_, x: string) => script(x, SUBSCRIPT, "_"))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Lift math out of prose (never out of code) so the Markdown lexer cannot mangle it. */
function liftMath(markdown: string): string {
  return markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/).map((part, index) => index % 2 ? part : part
    .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a?: string, b?: string) =>
      `\n\n${MATH_OPEN}${latexToText(a ?? b ?? "")}${MATH_CLOSE}\n\n`)
    .replace(/\\\((.+?)\\\)/g, (_, a: string) => `${MATH_OPEN}${latexToText(a)}${MATH_CLOSE}`)
    // Pandoc's rule keeps prices literal: no space just inside either dollar,
    // and no digit straight after the closing one ("$5 and $10" is money).
    .replace(/(^|[^\\$\w])\$(?=[^\s$])([^$\n]+?)(?<=[^\s\\])\$(?![\d$])/g, (whole, lead: string, body: string) =>
      /[\\^_=]|^[a-zA-Z]$/.test(body) ? `${lead}${MATH_OPEN}${latexToText(body)}${MATH_CLOSE}` : whole),
  ).join("");
}

/** Plain text from the lexer: restore math, turn surviving `**x**` into bold, drop stray `**`. */
function prose(text: string): TelegramText {
  const restored = text.replace(MATH_SPAN, "$1");
  return join(restored.split(/\*\*([^*\n]+?)\*\*/).map((part, index) =>
    index % 2 ? styled(plain(part), "bold") : plain(part.replace(/\*\*+/g, ""))));
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
      // Images are sent as real photos by the caller (`telegramImageUrls`).
      case "image": return plain("");
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
      case "text": return token.tokens ? children() : prose(decodeText(token.text));
      default: return "tokens" in token ? children() : plain(token.raw);
    }
  }));
}

/** Parse ordinary assistant Markdown locally; never ask Telegram to parse it. */
export function formatTelegramText(markdown: string): TelegramText {
  const result = trim(render(Lexer.lex(liftMath(markdown), { gfm: true })));
  result.entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return result;
}

/** Web images the answer embeds; the sender delivers them as photos. */
export function telegramImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "image" && /^https?:\/\//i.test(token.href)) urls.push(decodeText(token.href));
      if ("tokens" in token && token.tokens) walk(token.tokens);
      if (token.type === "list") for (const item of token.items) walk(item.tokens ?? []);
    }
  };
  walk(Lexer.lex(markdown, { gfm: true }));
  return [...new Set(urls)].slice(0, 10);
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
