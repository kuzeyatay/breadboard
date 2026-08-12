// Office Math Markup (OMML) rendered as LaTeX.
//
// A formula in a Word document is not text. It is a tree: `x²` is a superscript
// element with a base and an exponent, and stripping the tags leaves `x2`,
// which is a different number. Every equation in every valuation model, every
// engineering report and every damages calculation went through the old
// extractor as that kind of wreckage — silently, because `x2` is a perfectly
// plausible string.
//
// LaTeX is the target because it is what the rest of Breadboard already speaks:
// the chat renders `$…$` through KaTeX, the garden's formula pipeline is built
// on it, and a model asked to reason about an equation reasons better about
// `\frac{a}{b}` than about `ab`.
//
// This covers the constructs Word's equation editor actually produces. Anything
// unrecognised falls back to its text content rather than vanishing, so an
// exotic equation degrades to the old behaviour instead of disappearing.

import { attribute, childNamed, childrenNamed, textContent, type XmlNode } from "./xml.ts";

/** Operators Word stores as a character but LaTeX names. */
const OPERATORS: Record<string, string> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
  "⋁": "\\bigvee",
  "⋀": "\\bigwedge",
};

/** Characters that mean something else in LaTeX source. */
const ESCAPES: Record<string, string> = {
  "\\": "\\backslash ",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "%": "\\%",
  "#": "\\#",
  _: "\\_",
  "^": "\\^{}",
  "~": "\\sim ",
};

/** Symbols that are already mathematical and should stay as commands. */
const SYMBOLS: Record<string, string> = {
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
  "≈": "\\approx ",
  "±": "\\pm ",
  "×": "\\times ",
  "÷": "\\div ",
  "→": "\\to ",
  "∞": "\\infty ",
  "√": "\\sqrt",
  "∂": "\\partial ",
  "∆": "\\Delta ",
  "α": "\\alpha ",
  "β": "\\beta ",
  "γ": "\\gamma ",
  "δ": "\\delta ",
  "ε": "\\epsilon ",
  "θ": "\\theta ",
  "λ": "\\lambda ",
  "μ": "\\mu ",
  "π": "\\pi ",
  "ρ": "\\rho ",
  "σ": "\\sigma ",
  "τ": "\\tau ",
  "φ": "\\phi ",
  "ω": "\\omega ",
  "Ω": "\\Omega ",
  "Σ": "\\Sigma ",
  "Π": "\\Pi ",
};

function escapeMathText(value: string): string {
  let out = "";
  for (const character of value) {
    out += SYMBOLS[character] ?? ESCAPES[character] ?? character;
  }
  return out;
}

function group(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "{}";
  // A single character (or a single command) needs no braces, and reads better
  // without them.
  if (trimmed.length === 1 || /^\\[a-zA-Z]+$/.test(trimmed)) return trimmed;
  return `{${trimmed}}`;
}

function operator(character: string): string {
  return OPERATORS[character] ?? escapeMathText(character);
}

/** Convert the children of a node, concatenated. */
function convertChildren(node: XmlNode): string {
  return node.children.map(convertNode).join("");
}

/** The `m:e` argument of a construct, converted. */
function argument(node: XmlNode, local = "e"): string {
  const child = childNamed(node, local);
  return child ? convertChildren(child) : "";
}

function convertNode(node: XmlNode): string {
  switch (node.local) {
    // A run: the leaf that actually holds characters.
    case "r":
      return escapeMathText(textContent(node));
    case "t":
      return escapeMathText(textContent(node));

    // Fraction. `linFrac` is the a/b form Word writes for inline fractions.
    case "f": {
      const numerator = argument(node, "num");
      const denominator = argument(node, "den");
      const type = attribute(childNamed(childNamed(node, "fPr") ?? node, "type") ?? node, "val");
      if (type === "lin") return `${group(numerator)}/${group(denominator)}`;
      if (type === "noBar") return `\\binom${group(numerator)}${group(denominator)}`;
      return `\\frac${group(numerator)}${group(denominator)}`;
    }

    case "sSup":
      return `${group(argument(node))}^${group(argument(node, "sup"))}`;
    case "sSub":
      return `${group(argument(node))}_${group(argument(node, "sub"))}`;
    case "sSubSup":
      return `${group(argument(node))}_${group(argument(node, "sub"))}^${group(
        argument(node, "sup"),
      )}`;
    case "sPre":
      return `{}_${group(argument(node, "sub"))}^${group(argument(node, "sup"))}${group(
        argument(node),
      )}`;

    // Radical: a degree makes it an nth root.
    case "rad": {
      const degree = argument(node, "deg").trim();
      const radicand = argument(node);
      return degree ? `\\sqrt[${degree}]${group(radicand)}` : `\\sqrt${group(radicand)}`;
    }

    // N-ary operator — sums, products, integrals — with its limits.
    case "nary": {
      const properties = childNamed(node, "naryPr");
      const character = properties
        ? attribute(childNamed(properties, "chr") ?? properties, "val") ?? "∫"
        : "∫";
      const hideSub = properties
        ? attribute(childNamed(properties, "subHide") ?? properties, "val") === "1"
        : false;
      const hideSup = properties
        ? attribute(childNamed(properties, "supHide") ?? properties, "val") === "1"
        : false;
      const lower = hideSub ? "" : argument(node, "sub").trim();
      const upper = hideSup ? "" : argument(node, "sup").trim();
      const body = argument(node);
      return `${operator(character)}${lower ? `_${group(lower)}` : ""}${
        upper ? `^${group(upper)}` : ""
      } ${body}`;
    }

    // Delimiters: Word records the actual brackets used.
    case "d": {
      const properties = childNamed(node, "dPr");
      const open = properties
        ? attribute(childNamed(properties, "begChr") ?? properties, "val") ?? "("
        : "(";
      const close = properties
        ? attribute(childNamed(properties, "endChr") ?? properties, "val") ?? ")"
        : ")";
      const parts = childrenNamed(node, "e").map(convertChildren);
      const inner = parts.join(" , ");
      const left = open === "{" ? "\\{" : open;
      const right = close === "}" ? "\\}" : close;
      return `\\left${left || "."}${inner}\\right${right || "."}`;
    }

    // A named function: sin, log, lim.
    case "func": {
      const name = argument(node, "fName").trim();
      const body = argument(node);
      const known = /^(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min|det|gcd)$/i.test(
        name.replace(/\\/g, ""),
      );
      return `${known ? `\\${name.replace(/\\/g, "").toLowerCase()}` : name} ${body}`;
    }

    case "limLow":
      return `${group(argument(node))}_${group(argument(node, "lim"))}`;
    case "limUpp":
      return `${group(argument(node))}^${group(argument(node, "lim"))}`;

    case "bar": {
      const position = attribute(
        childNamed(childNamed(node, "barPr") ?? node, "pos") ?? node,
        "val",
      );
      return position === "bot"
        ? `\\underline${group(argument(node))}`
        : `\\overline${group(argument(node))}`;
    }

    case "acc": {
      const properties = childNamed(node, "accPr");
      const character = properties
        ? attribute(childNamed(properties, "chr") ?? properties, "val") ?? "̂"
        : "̂";
      const accent =
        character === "→" ? "\\vec" : character === "̃" ? "\\tilde" : character === "̄" ? "\\bar" : "\\hat";
      return `${accent}${group(argument(node))}`;
    }

    case "groupChr":
      return `\\overbrace${group(argument(node))}`;

    // Matrices, and the equation arrays Word writes for aligned systems.
    case "m": {
      const rows = childrenNamed(node, "mr").map((row) =>
        childrenNamed(row, "e").map(convertChildren).join(" & "),
      );
      return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
    }
    case "eqArr": {
      const rows = childrenNamed(node, "e").map(convertChildren);
      return `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`;
    }

    // Properties describe how to draw; they hold no content.
    case "fPr":
    case "dPr":
    case "naryPr":
    case "radPr":
    case "sSupPr":
    case "sSubPr":
    case "sSubSupPr":
    case "barPr":
    case "accPr":
    case "funcPr":
    case "mPr":
    case "rPr":
    case "ctrlPr":
    case "argPr":
      return "";

    default:
      return convertChildren(node);
  }
}

/**
 * One `m:oMath` element as LaTeX. Returns "" when the element holds nothing,
 * so a caller can drop it rather than emit empty delimiters.
 */
export function ommlToLatex(node: XmlNode): string {
  const latex = convertChildren(node).replace(/\s+/g, " ").trim();
  return latex;
}

/** True when a converted formula is worth showing rather than noise. */
export function isMeaningfulFormula(latex: string): boolean {
  return latex.replace(/[\s{}]/g, "").length > 0;
}
