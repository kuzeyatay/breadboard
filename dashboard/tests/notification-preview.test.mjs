import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, 'node_modules', '.cache');
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, 'notification-preview-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const bundle = path.join(directory, 'bundle.cjs');
await esbuild.build({
  entryPoints: [path.join(root, 'src/app/components/notification-preview.tsx')],
  bundle: true, outfile: bundle, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
});
const require = module.createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const NotificationPreview = require(bundle).default;
const render = content => renderToStaticMarkup(React.createElement(NotificationPreview, { content }));
const equations = markup => Array.from(markup.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g), match => match[1]);

test('notification previews render the screenshot formulas without stripping subscripts', () => {
  const markup = render(String.raw`These slides explain why a tiny gate–drain capacitance \(C_{gd}\) reduces bandwidth. Here, \(R_S\) and \(r_o\) are not in parallel. Collect the \(v_{\text{out}}\) terms.`);
  assert.deepEqual(equations(markup), [String.raw`C_{gd}`, 'R_S', 'r_o', String.raw`v_{\text{out}}`]);
  assert.doesNotMatch(markup, /katex-error|\\\(|\\\)/);
});

test('dollar and display equations render while prose stays outside math', () => {
  const formula = String.raw`v_{\text{out}}\frac{1+sC_Lr_o}{g_mr_o+1}=v_{\text{in}}\tag{1}`;
  const markup = render(`Before $C_{gd}$.\n\n\\[${formula}\\]\n\nAfter the equation.\n\n$$x^2$$`);
  assert.deepEqual(equations(markup), ['C_{gd}', formula, 'x^2']);
  assert.doesNotMatch(markup, /katex-error|<pre|<div/);
  assert.match(markup, /After the equation/);
});

test('truncation keeps a formula crossing the preview boundary whole', () => {
  const formula = String.raw`\frac{v_{\text{out}}}{v_{\text{in}}}`;
  const markup = render(`${'A '.repeat(175)}\\(${formula}\\) hidden tail`);
  assert.deepEqual(equations(markup), [formula]);
  assert.doesNotMatch(markup, /katex-error|hidden tail/);
  assert.match(markup, /…/);
});

test('formulas too large for a preview are omitted rather than partially rendered', () => {
  const markup = render(`Result: $${'x+'.repeat(2_001)}x$`);
  assert.deepEqual(equations(markup), []);
  assert.match(markup, /Result: …/);
});

test('previews flatten formatting and links without adding controls or fetching images', () => {
  const markup = render('# **Answer**\n\n- [Read this](https://example.com) and ![the diagram](https://example.com/image.png).\n- ~~Old~~ `r_o`\n\n<script>alert(1)</script>');
  assert.match(markup, /Answer Read this and the diagram\. Old r_o/);
  assert.doesNotMatch(markup, /<(?:a|img|button|script|h1|ul|li|strong|del)\b|alert\(1\)/);
});

test('prices and code stay literal next to real math', () => {
  const markup = render('Costs $5 or $10. Use `\\(r_o\\)` or `$x_1$` in code, and \\(R_S\\) in prose.');
  assert.deepEqual(equations(markup), ['R_S']);
  assert.match(markup, /Costs \$5 or \$10/);
  assert.match(markup, /\\\(r_o\\\)/);
  assert.match(markup, /\$x_1\$/);
});

test('invalid math cannot break a notification card', () => {
  const markup = render(String.raw`Before \(\notARealCommand{x}\) after.`);
  assert.match(markup, /Before/);
  assert.match(markup, /after\./);
});
