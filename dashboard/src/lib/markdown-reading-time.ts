import { Lexer, walkTokens } from "marked";

/** Estimate the whole document at Quartz's default 200 words per minute. */
export function markdownReadingMinutes(markdown: string): number | null {
  // Metadata, link destinations, and Markdown delimiters aren't reading text.
  const source = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, "");
  const text: string[] = [];
  walkTokens(Lexer.lex(source), (token) => {
    if (
      (token.type === "text" && !token.tokens) ||
      token.type === "code" ||
      token.type === "codespan" ||
      token.type === "escape"
    ) {
      text.push(token.text);
    }
  });

  // Count CJK characters individually, as Quartz's reading-time package does.
  const words = text.join(" ").match(
    /[\u3040-\u309f\u4e00-\u9fff\uac00-\ud7a3]|[^\s\u3040-\u309f\u4e00-\u9fff\uac00-\ud7a3]+/gu,
  )?.length ?? 0;
  return words > 0 ? Math.ceil(words / 200) : null;
}
