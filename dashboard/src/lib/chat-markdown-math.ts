/**
 * Code spans and fenced blocks, which no prose transform may touch.
 *
 * A dollar inside `console.log("$5")` is one the author typed, and rewriting it
 * would put a backslash on the reader's screen.
 */
const CODE_REGIONS = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g;

/** Apply a prose transform to everything except code. */
export function outsideCode(content: string, transform: (prose: string) => string): string {
  let result = "";
  let index = 0;
  for (const match of content.matchAll(CODE_REGIONS)) {
    result += transform(content.slice(index, match.index)) + match[0];
    index = match.index + match[0].length;
  }
  return result + transform(content.slice(index));
}

/**
 * A dollar sign that opens a price rather than a formula.
 *
 * `remark-math` reads a `$...$` pair as inline math, so "Helsing at $18B,
 * Hadrian at $7.87B" parsed as the formula "18B, Hadrian at" and rendered in
 * italic serif with both amounts swallowed. A dollar followed by a digit is
 * usually money, but it can also open valid number-led maths such as
 * `$0 < x < 1$`. Those pairs are identified before the remaining currency
 * dollars are escaped.
 */
const CURRENCY_DOLLAR = /(?<![\\$])\$(?=\d)/g;

function opensNumberLedMath(content: string, openingIndex: number): boolean {
  const tail = content.slice(openingIndex + 1);
  const closingMatch = /(?<![\\$])\$(?!\$)/u.exec(tail);
  if (!closingMatch) return false;

  const candidate = tail.slice(0, closingMatch.index);
  if (!candidate || candidate.includes('\n')) return false;

  // A matched `$5$` is unambiguously delimited math; prose currency has no
  // trailing dollar. For longer expressions, require actual math syntax so
  // separate prices such as "$18B, Hadrian at $7.87B" are not paired up.
  if (/^\s*\d+(?:[.,]\d+)?\s*$/u.test(candidate)) return true;
  if (
    /\\(?:[A-Za-z]+|%)|[_^=<>]/u.test(candidate) ||
    /\d\s*[+*/-]\s*\d/u.test(candidate)
  ) return true;

  // Functions, fractions and implicit products need no TeX command or
  // comparison: $1(t)$, $1/(s+a)$ and $2x$ are all valid inline math. Escaping
  // their opener pairs the remaining dollars around the following prose.
  // Require only algebra tokens here so price descriptions such as
  // "$5 (monthly), or $50 annually" still stay outside math.
  return (
    /^[\dA-Za-z\s()+*/.,!|\-]*[\dA-Za-z)!|]$/u.test(candidate.trim()) &&
    !/[A-Za-z]{2,}/u.test(candidate)
  );
}

export function normalizeMathDelimiters(content: string): string {
  return outsideCode(content, (prose) => {
    const displayNormalized = prose
      .replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_match, bracketMath: string | undefined, dollarMath: string | undefined, offset: number, source: string) => {
        const math = bracketMath ?? dollarMath ?? '';
        // Existing block delimiters already carry their list indentation and
        // blockquote prefixes. Trimming the body drops that context and lets a
        // closing $$ open a new math block around the following explanation.
        if (/^[\t ]*\r?\n/u.test(math) && /\n[\t >]*$/u.test(math)) {
          return `$$${math}$$`;
        }

        // One-line display equations need new lines, with the same Markdown
        // container prefix as their opening delimiter (including list markers).
        const linePrefix = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
        const continuation = linePrefix.replace(
          /(?:[-+*]|\d+[.)])[\t ]+$/u,
          (marker) => ' '.repeat(marker.length),
        );
        const prefix = /^[\t >]*$/u.test(continuation) ? continuation : '';
        return `$$\n${prefix}${math.trim()}\n${prefix}$$`;
      });
    const escapeCurrency = (text: string) => text.replace(
      CURRENCY_DOLLAR,
      (dollar, offset: number, source: string) => opensNumberLedMath(source, offset) ? dollar : `\\${dollar}`,
    );
    // Explicit LaTeX delimiters already identify math. Keep them outside the
    // price heuristic, including when the formula begins with a number and
    // implicit products such as 1/(RC). Each surrounding prose segment is
    // separate, so a price cannot borrow an operator from the formula.
    let result = '';
    let index = 0;
    for (const match of displayNormalized.matchAll(/\\\(([\s\S]*?)\\\)/g)) {
      result += escapeCurrency(displayNormalized.slice(index, match.index)) + `$${match[1].trim()}$`;
      index = match.index + match[0].length;
    }
    return result + escapeCurrency(displayNormalized.slice(index));
  });
}

