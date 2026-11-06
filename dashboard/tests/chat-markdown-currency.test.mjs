// Money is not maths.
//
// `remark-math` reads a `$…$` pair as inline math, so an answer containing
// "Helsing at $18B, Hadrian at $7.87B" was parsed as the formula
// "18B, Hadrian at" and rendered in italic serif with both amounts swallowed.
// Renders the real component rather than reasoning about the regex.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-markdown-"),
);
after(() => fs.rmSync(outDirectory, { recursive: true, force: true }));

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ChatMarkdown } from "@/app/components/chat-markdown";\n`,
  "utf8",
);
const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatMarkdown } = require(bundle);

const render = (content) =>
  renderToStaticMarkup(React.createElement(ChatMarkdown, { content }));

const equationsIn = (markup) => Array.from(
  markup.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g),
  (match) => match[1],
);

test("single-line numbered display equations render inside ordinary prose, lists and quotes", () => {
  const formula = String.raw`a=\frac{v^2}{r}\tag{1}`;
  for (const content of [`Before.\n\n$$${formula}$$\n\nAfter.`, `- $$${formula}$$\n\nAfter.`, `> $$${formula}$$\n\nAfter.`]) {
    const markup = render(content);
    assert.doesNotMatch(markup, /katex-error/);
    assert.match(markup, /katex-display/);
    assert.deepEqual(equationsIn(markup), [formula]);
    assert.match(markup, /After\./);
  }
  const code = render('`$$a=b\\tag{1}$$`\n\n```tex\n$$a=b\\tag{1}$$\n```');
  assert.doesNotMatch(code, /katex/);
});

test("number-led functions and fractions do not turn the following explanation into math", () => {
  const markup = render(String.raw`We have converted a differential equation into algebra. Taking the inverse transform of $1/(s+a)$ gives $e^{-at}1(t)$, so this system's impulse response is $h(t)=be^{-at}1(t)$. Here $1(t)$ denotes the unit step: zero before $t=0$, one afterward.`);
  assert.deepEqual(equationsIn(markup), [
    "1/(s+a)", "e^{-at}1(t)", "h(t)=be^{-at}1(t)", "1(t)", "t=0",
  ]);
  assert.match(markup, /denotes the unit step: zero before/);
  assert.doesNotMatch(markup, /katex-error|\$/);
});

test("number-led percentages keep the connecting explanation out of math", () => {
  const markup = render(String.raw`The output has completed \(63.2\%\) of its change; \(36.8\%\) remains. Rise time runs from $10\%$ to $90\%$. The meter costs $50.`);
  assert.deepEqual(equationsIn(markup), [String.raw`63.2\%`, String.raw`36.8\%`, String.raw`10\%`, String.raw`90\%`]);
  assert.doesNotMatch(markup, /katex-error/);
  assert.match(markup, /of its change;/);
  assert.match(markup, /costs \$50/);
});

test("explicit LaTeX delimiters preserve number-led products beside prices", () => {
  const markup = render(String.raw`The meter costs $5. Its corner moves from \(1/(RC)\) to \(1/(2RC)\); compare \(2ab\) with \(3xy\). A second meter costs $50.`);
  assert.deepEqual(equationsIn(markup), ["1/(RC)", "1/(2RC)", "2ab", "3xy"]);
  assert.doesNotMatch(markup, /katex-error/);
  assert.match(markup, /costs \$5/);
  assert.match(markup, /costs \$50/);
  assert.match(markup, /; compare /);
});

test("currency detection cannot borrow operators from explicitly delimited math", () => {
  const markup = render(String.raw`It costs $5; use \(x_1=2\). Another costs $10.`);
  assert.deepEqual(equationsIn(markup), ["x_1=2"]);
  assert.match(markup, /costs \$5/);
  assert.match(markup, /costs \$10/);
  assert.doesNotMatch(markup, /katex-error/);
});

for (const formula of ["1/(s+a)", "1(t)", "1 / (s + a)", "2x", "2 x", "2(x+1)", "3/x"]) {
  test(`number-led algebra renders: ${formula}`, () => {
    assert.deepEqual(equationsIn(render(`Use $${formula}$ here.`)), [formula]);
  });
}

test("parenthesized price descriptions stay prose beside a number-led formula", () => {
  const markup = render("It costs $5 (monthly), or $50 annually; use $1/(s+a)$ here.");
  assert.deepEqual(equationsIn(markup), ["1/(s+a)"]);
  assert.match(markup, /\$5 \(monthly\), or \$50 annually/);
});

for (const prices of ["Prices: $5, $10, and $20.", "Valuations: $18B, $7.87B.", "Range: $5 - $10.", "Compare $5 / $10."]) {
  test(`short price lists and ranges stay prose: ${prices}`, () => {
    const markup = render(prices);
    assert.doesNotMatch(markup, /katex/);
    assert.ok(markup.includes(prices));
  });
}

test("two dollar amounts in one sentence stay money, not a formula", () => {
  const markup = render(
    "Large private valuations (Helsing at $18B, Hadrian at $7.87B) lead the sector.",
  );
  assert.doesNotMatch(markup, /katex/);
  assert.match(markup, /\$18B/);
  assert.match(markup, /\$7\.87B/);
  // The words that used to be swallowed into the formula are still prose.
  assert.match(markup, /Hadrian at/);
});

test("a run of amounts survives intact", () => {
  const markup = render("Galaxy Bot $453M, Apptronik $403M to $935M.");
  assert.doesNotMatch(markup, /katex/);
  for (const amount of ["$453M", "$403M", "$935M"]) {
    assert.ok(markup.includes(amount), `${amount} survives`);
  }
});

test("real inline maths still renders", () => {
  const markup = render(String.raw`Energy is \(E = mc^2\) exactly.`);
  assert.match(markup, /katex/);
});

test("number-led inline maths is not mistaken for currency", () => {
  const markup = render(
    String.raw`The boundaries are distinct, so normally $0<\phi_2-\phi_1<2\pi$.`,
  );
  assert.match(markup, /katex/);
  assert.doesNotMatch(markup, /\$0/);
});

test("an isolated number with two delimiters still renders as maths", () => {
  const markup = render(String.raw`The result is $5$.`);
  assert.match(markup, /katex/);
});

test("currency before number-led maths does not steal its opening delimiter", () => {
  const markup = render(String.raw`It costs $5; the domain is $0<x<1$.`);
  assert.match(markup, /katex/);
  assert.match(markup, /\$5/);
  assert.doesNotMatch(markup, /\$0/);
});

test("display maths still renders", () => {
  const markup = render("Result:\n\n$$\nx^2 + y^2 = z^2\n$$\n");
  assert.match(markup, /katex/);
});

const formulaList = String.raw`- **Net charge:**
  \[
  Q=(N_p-N_e)e
  \]
  Net charge depends on the difference between protons and electrons.

- **Charge conservation:**
  \[
  Q_{\text{before}}=Q_{\text{after}}
  \]
  Charge can move between objects, but its total stays constant.`
  .replace(/(\*\*|\\\])\n/g, "$1  \n");

for (const [name, content] of [
  ["bullet list", formulaList],
  ["Windows line endings", formulaList.replaceAll("\n", "\r\n")],
  ["nested list", "- Charge concepts\n\n" + formulaList.replace(/^/gm, "  ")],
  ["numbered list", formulaList.replace(/^- /gm, "1. ").replace(/^  /gm, "   ")],
  ["quoted list", formulaList.replace(/^/gm, "> ")],
  ["single-line delimiters", formulaList.replace(/\\\[\n  ([^\n]+)\n  \\\]/g, "\\[$1\\]")],
]) {
  test(`display equations keep their explanations outside math in a ${name}`, () => {
    const markup = render(content);
    const equations = Array.from(
      markup.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g),
      (match) => match[1].trim(),
    );
    assert.deepEqual(equations, [
      "Q=(N_p-N_e)e",
      String.raw`Q_{\text{before}}=Q_{\text{after}}`,
    ]);
    assert.equal((markup.match(/class="katex-display"/g) ?? []).length, 2);
    assert.doesNotMatch(markup, /katex-error/);
    assert.match(markup, /<strong>Net charge:<\/strong>/);
    assert.match(markup, /<strong>Charge conservation:<\/strong>/);
    assert.match(markup, /Net charge depends on the difference between protons and electrons\./);
    assert.match(markup, /Charge can move between objects, but its total stays constant\./);
  });
}

test("LaTeX display delimiters in code remain literal", () => {
  const markup = render('Use `\\[Q=0\\]` as an example.\n\n```latex\n\\[\nQ=0\n\\]\n```');
  assert.doesNotMatch(markup, /katex/);
  assert.match(markup, /\\\[Q=0\\\]/);
  assert.match(markup, /\\\[\nQ=0\n\\\]/);
});

test("a dollar inside code is the author's, and is left alone", () => {
  const inline = render('Run `echo "$5"` to print it.');
  assert.doesNotMatch(inline, /\\$5/);
  assert.match(inline, /\$5/);

  const fenced = render('```bash\necho "$42"\n```');
  assert.doesNotMatch(fenced, /\\$42/);
  assert.match(fenced, /\$42/);
});

test("a single amount on its own is untouched", () => {
  const markup = render("It costs $5 today.");
  assert.doesNotMatch(markup, /katex/);
  assert.match(markup, /\$5/);
});

test("a JSON-decoded form feed cannot break a LaTeX fraction", () => {
  const markup = render("Result:\n\n$$\nE = \u000crac{1}{R^2}\n$$\n");
  assert.match(markup, /katex/);
  assert.doesNotMatch(markup, /katex-error/);
  assert.doesNotMatch(markup, /\u000c/);
});

test("a lossy replacement marker before rac is repaired before KaTeX", () => {
  const markup = render("Result:\n\n$$\nE = �rac{h}{\\sqrt{b^2+h^2}}\n$$\n");
  assert.match(markup, /katex/);
  assert.doesNotMatch(markup, /katex-error|�rac/);
});
