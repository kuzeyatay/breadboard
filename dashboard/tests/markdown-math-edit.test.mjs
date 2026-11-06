import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const bundle = await build({ entryPoints: [path.resolve(import.meta.dirname, '../src/lib/markdown-math-edit.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { repairMarkdownMathFormatting: repair, wantsMathFormattingOnly: wants } = module.exports;

test('repairs explicit delimiters and preserves ordinary prose and formula contents', () => {
  const before = String.raw`Here \(Z_1=R\) and \(Z_2=1/(j\omega C)\); (ordinary prose) stays.

\[
\frac{\widetilde V_{out}}{\widetilde V_{in}}=\frac{1}{1+j\omega RC}.
\]`;
  const after = String.raw`Here $Z_1=R$ and $Z_2=1/(j\omega C)$; (ordinary prose) stays.

$$
\frac{\widetilde V_{out}}{\widetilde V_{in}}=\frac{1}{1+j\omega RC}.
$$`;
  assert.equal(repair(before), after);
  assert.equal(repair(after), after);
});

test('preserves YAML, code of any fence length, HTML, existing math and escapes', () => {
  const unchanged = [
    '---\ntitle: "Example \\(x\\)"\n---\n',
    '`\\(code\\)` and `` ` \\(code\\) ` ``',
    '````tex\n```\n\\(code\\)\n````',
    '~~~tex\n\\[code\\]\n~~~',
    '    \\(indented code\\)',
    '<!-- \\(comment\\) -->',
    '$$\n\\begin{aligned}a&=b\\\\[6pt]c&=d\\end{aligned}\n$$',
    '$\\text{literal \\( and \\)}$',
    String.raw`Escaped \\(literal\\) and $5 each.`,
    '```tex\n\\(unclosed fence\\)',
  ].join('\n\n');
  assert.equal(repair(unchanged), unchanged);
});

test('display repairs retain list and blockquote containers and CRLF', () => {
  assert.equal(repair(String.raw`- \[x=y\]`), '- $$\n  x=y\n  $$');
  assert.equal(repair(String.raw`> \[x=y\]`), '> $$\n> x=y\n> $$');
  assert.equal(repair('Before\r\n\r\n\\[\r\nx=y\r\n\\]\r\n'), 'Before\r\n\r\n$$\r\nx=y\r\n$$\r\n');
});

test('table repairs preserve magnitude and norm bars without splitting cells', () => {
  const before = String.raw`| Limit | Magnitude |
|---|---|
| \(\omega\to0\) | \(|Z_C|\to\infty\) |
| norm | \(\|x\|\) |`;
  const after = String.raw`| Limit | Magnitude |
|---|---|
| $\omega\to0$ | $\vert Z_C\vert \to\infty$ |
| norm | $\Vert x\Vert $ |`;
  assert.equal(repair(before), after);
  assert.equal(repair(after), after);
});

test('only standalone formatting requests qualify for the deterministic repair', () => {
  for (const instruction of ['fix the latex of this markdown', 'Fix the LaTeX in this markdown', 'please repair math formatting.', 'Normalize LaTeX delimiters']) assert.equal(wants(instruction), true, instruction);
  for (const instruction of ['Fix the math', 'Fix the LaTeX and add a proof', 'Explain LaTeX formatting', 'Do not fix the LaTeX', 'Correct the equation', 'Fix the LaTeX using the previous version']) assert.equal(wants(instruction), false, instruction);
});
