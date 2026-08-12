import assert from 'node:assert/strict';
import test from 'node:test';

import katex from 'katex';

import {
  closeDanglingDisplayMath,
  fixLeftRight,
  guardTrailingDelimiterFormula,
  netBraceDepth,
  normalizeDocParseMarkdown,
  repairDisplayBlock,
  unwrapWholeAnswerFence,
} from '../src/lib/vlm-ocr/normalize.ts';
import {
  cleanRepeatedSubstrings,
  hasTailRepetition,
} from '../src/lib/vlm-ocr/repetition.ts';
import {
  decodeHtmlEntities,
  ensureRenderableMath,
  expandTableGrid,
  gridToGfmTable,
  htmlCellText,
  htmlTablesToMarkdown,
  parseHtmlTableRows,
  repairMath,
  shiftHeadings,
  toBreadboardMarkdown,
} from '../src/lib/vlm-ocr/quartz-safe.ts';
import {
  DEFAULT_VLM_OCR_TASK,
  VLM_OCR_TASK_PROMPTS,
  isVlmOcrTask,
  vlmOcrPrompt,
} from '../src/lib/vlm-ocr/prompts.ts';

// ── Official prompts ────────────────────────────────────────────────────────

test('the document-parsing prompt is upstream HunyuanOCR wording, verbatim', () => {
  assert.equal(
    VLM_OCR_TASK_PROMPTS.doc_parse,
    '提取文档图片中正文的所有信息用markdown格式表示，其中页眉、页脚部分忽略，表格用html格式表达，文档中公式用latex格式表示，按照阅读顺序组织进行解析。',
  );
  assert.equal(DEFAULT_VLM_OCR_TASK, 'doc_parse');
  assert.equal(vlmOcrPrompt(), VLM_OCR_TASK_PROMPTS.doc_parse);
  // An unknown task falls back rather than sending a made-up instruction.
  assert.equal(vlmOcrPrompt('nonsense'), VLM_OCR_TASK_PROMPTS.doc_parse);
  assert.equal(isVlmOcrTask('table'), true);
  assert.equal(isVlmOcrTask('translate'), false);
});

// ── Repetition guards ───────────────────────────────────────────────────────

test('greedy-decoding repetition is detected and trimmed', () => {
  assert.equal(hasTailRepetition('abc' + 'xy'.repeat(10)), true);
  assert.equal(hasTailRepetition('a normal sentence of prose'), false);

  const looped = 'x'.repeat(2000) + '- item\n'.repeat(20);
  const cleaned = cleanRepeatedSubstrings(looped);
  assert.ok(cleaned.length < looped.length);
  assert.ok(cleaned.endsWith('- item\n'));
});

// ── doc_parse normalization ─────────────────────────────────────────────────

test('layout coordinate tokens are stripped but point sets in math survive', () => {
  const input = [
    '数据来源于高德地图驾车导航数据(39,337),(512,900)',
    '',
    '(147,90),(925,415)',
    '',
    'The set $\\{(2,4),(3,3)\\}$ stays intact.',
  ].join('\n');

  const output = normalizeDocParseMarkdown(input);
  assert.ok(output.includes('数据来源于高德地图驾车导航数据'));
  assert.ok(!output.includes('(39,337)'));
  assert.ok(!output.includes('(147,90)'));
  assert.ok(output.includes('$\\{(2,4),(3,3)\\}$'));
});

test('a table caption is lifted out of the table element', () => {
  const output = normalizeDocParseMarkdown(
    '<table><caption>Table 1: Results</caption><tr><td>a</td></tr></table>',
  );
  assert.ok(output.startsWith('Table 1: Results'));
  assert.ok(!/<caption/i.test(output));
});

test('unbalanced \\left / \\right is rebalanced', () => {
  assert.equal(fixLeftRight('\\left( x').fixes, 1);
  assert.ok(fixLeftRight('\\left( x').content.includes('\\right.'));
  assert.equal(fixLeftRight('\\left( x \\right)').fixes, 0);
});

test('display blocks lose a leading bare & and surplus closing braces', () => {
  assert.equal(repairDisplayBlock(' & x = 1').content.trim(), 'x = 1');
  assert.equal(repairDisplayBlock('x = 1}').content, 'x = 1');
  assert.equal(netBraceDepth('\\{ a'), 0, 'escaped braces are not counted');
});

test('a fence wrapping the whole answer is removed, a real code block is not', () => {
  assert.equal(unwrapWholeAnswerFence('```markdown\n# Title\n```'), '# Title');
  const withCode = '```python\nprint(1)\n```\n\nText\n\n```js\n1\n```';
  assert.equal(unwrapWholeAnswerFence(withCode), withCode);
});

// ── HTML tables → GFM ───────────────────────────────────────────────────────

test('entities and inline markup are decoded out of table cells', () => {
  assert.equal(decodeHtmlEntities('a &amp; b &#65; &#x42;'), 'a & b A B');
  assert.equal(htmlCellText('<b>x</b><br>y'), 'x y');
  assert.equal(htmlCellText('a | b'), 'a \\| b');
  // A pipe inside math is left alone: `\|` means something in LaTeX.
  assert.equal(htmlCellText('$\\|x\\|$'), '$\\|x\\|$');
});

test('a simple HTML table becomes a GFM table', () => {
  const { text, converted, dropped } = htmlTablesToMarkdown(
    '<table><tr><th>Name</th><th>Value</th></tr><tr><td>g</td><td>9.81</td></tr></table>',
  );
  assert.equal(converted, 1);
  assert.equal(dropped, 0);
  assert.ok(!/<table/i.test(text));
  assert.ok(text.includes('| Name | Value |'));
  assert.ok(text.includes('| --- | --- |'));
  assert.ok(text.includes('| g | 9.81 |'));
});

test('colspan and rowspan expand into a rectangular grid', () => {
  const rows = parseHtmlTableRows(
    '<table><tr><td colspan="2">Wide</td></tr><tr><td rowspan="2">Tall</td><td>b</td></tr><tr><td>c</td></tr></table>',
  );
  const grid = expandTableGrid(rows);
  assert.deepEqual(grid, [
    ['Wide', ''],
    ['Tall', 'b'],
    ['', 'c'],
  ]);
  const table = gridToGfmTable(grid);
  assert.equal(
    table,
    ['| Wide |  |', '| --- | --- |', '| Tall | b |', '|  | c |'].join('\n'),
  );
});

test('an unclosed table still yields a table rather than swallowing the page', () => {
  const { text, converted } = htmlTablesToMarkdown(
    '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td>',
  );
  assert.equal(converted, 1);
  assert.ok(text.includes('| a | b |'));
  assert.ok(text.includes('| c | d |'));
});

test('math inside a table cell survives the conversion so KaTeX can render it', () => {
  const { text } = htmlTablesToMarkdown(
    '<table><tr><td>Energy</td><td>$E = mc^2$</td></tr></table>',
  );
  assert.ok(text.includes('$E = mc^2$'));

  // The same, but through the full pass, where the document-level mask and the
  // cell-level mask are both live at once.
  const { markdown } = toBreadboardMarkdown(
    '<table><tr><th>Symbol</th><th>Value</th></tr><tr><td>$\\alpha$</td><td>1</td></tr></table>',
  );
  assert.ok(markdown.includes('| $\\alpha$ | 1 |'), markdown);
});

test('an unclosed display block is closed instead of leaking as literal text', () => {
  assert.equal(closeDanglingDisplayMath('$$ x = 1'), '$$ x = 1\n$$');
  assert.equal(closeDanglingDisplayMath('$$ x = 1 $$'), '$$ x = 1 $$');

  // A page truncated mid-formula by the token budget.
  const { markdown } = toBreadboardMarkdown('Intro text.\n\n$$ \\frac{a}{b');
  assert.ok(markdown.includes('$$'));
  assert.ok(!/\$\$[^$]*$/.test(markdown.replace(/\$\$[\s\S]*?\$\$/g, '')));
});

test('a repaired \\right. survives the write-time trailing-punctuation strip', () => {
  // normalizeQuartzMarkdown strips a trailing "." from math; an unanchored
  // \right. would become a bare \right and stop rendering.
  assert.equal(
    guardTrailingDelimiterFormula('\\left( x \\right.'),
    '\\left( x \\right.{}',
  );
  assert.equal(guardTrailingDelimiterFormula('x = 1.'), 'x = 1.');

  const { markdown } = toBreadboardMarkdown('$$ \\left( x + y');
  assert.ok(markdown.includes('\\right.{}'), markdown);
  assert.equal(
    rendersInKatex(markdown.replace(/^[\s\S]*\$\$|\$\$[\s\S]*$/g, '').trim()),
    true,
  );
});

// ── Math has to actually render ─────────────────────────────────────────────

function rendersInKatex(formula, displayMode = true) {
  try {
    katex.renderToString(formula, { displayMode, throwOnError: true, strict: false });
    return true;
  } catch {
    return false;
  }
}

test('formulas KaTeX rejects are repaired rather than left to error', () => {
  const broken = '\\left( \\frac{a}{b}';
  assert.equal(rendersInKatex(broken), false);
  const repaired = repairMath(broken, true);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.repaired, true);
  assert.equal(rendersInKatex(repaired.formula), true);
});

test('LaTeX-only commands KaTeX does not know are dropped, not shown as errors', () => {
  const withLabel = 'x = 1 \\label{eq:one}';
  const repaired = repairMath(withLabel, true);
  assert.equal(repaired.ok, true);
  assert.equal(rendersInKatex(repaired.formula), true);
});

test('an unrepairable formula is demoted to code, never a red KaTeX error', () => {
  const markdown = '$$\n\\thiscommanddoesnotexist{x}{y}{z\n$$';
  const result = ensureRenderableMath(markdown);
  assert.equal(result.demoted, 1);
  assert.ok(result.markdown.includes('```latex'));
  assert.ok(!result.markdown.includes('$$'));
});

test('every math span left in the output renders in KaTeX', () => {
  const ocrOutput = [
    '# Kinematics',
    '',
    'The position is given by',
    '',
    '$$ \\left( v_0 t + \\frac{1}{2} a t^2 \\label{eq:pos}',
    '',
    'where $\\left[ x$ is displacement.',
    '',
    '<table><tr><th>Symbol</th><th>Meaning</th></tr><tr><td>$a$</td><td>acceleration</td></tr></table>',
  ].join('\n');

  const { markdown } = toBreadboardMarkdown(ocrOutput);

  const display = [...markdown.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
  const withoutDisplay = markdown.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  const inline = [...withoutDisplay.matchAll(/(?:^|[^\\$])\$([^\n$]+?)\$/g)].map(
    (m) => m[1],
  );

  assert.ok(display.length + inline.length > 0, 'expected math in the output');
  for (const formula of display) {
    assert.equal(rendersInKatex(formula, true), true, `display: ${formula}`);
  }
  for (const formula of inline) {
    assert.equal(rendersInKatex(formula, false), true, `inline: ${formula}`);
  }
});

// ── Renderer safety ─────────────────────────────────────────────────────────

test('no raw HTML survives, so chat and export renderers see the same content', () => {
  const { markdown } = toBreadboardMarkdown(
    '<table><tr><td>kept</td></tr></table>\n\nA threshold of <limit> applies, and a <b>bold claim</b>.',
  );
  assert.ok(!markdown.includes('<'), markdown);
  assert.ok(markdown.includes('&lt;limit&gt;') || markdown.includes('&lt;limit>'));
  assert.ok(markdown.includes('bold claim'));
  assert.ok(markdown.includes('| kept |'));
});

test('Obsidian comment and wikilink syntax cannot delete or relink content', () => {
  // Quartz strips `%%…%%` from the raw source before parsing.
  const { markdown } = toBreadboardMarkdown(
    'Yield was 50%% of target. See [[Chapter 4]] for details.',
  );
  assert.ok(!/%%/.test(markdown));
  assert.ok(!/\[\[/.test(markdown));
  assert.ok(markdown.includes('Chapter 4'));
});

test('code fences and math are never touched by the escaping passes', () => {
  const input = [
    '```html',
    '<table><tr><td>literal</td></tr></table>',
    '```',
    '',
    'Inline $a < b$ comparison.',
  ].join('\n');
  const { markdown } = toBreadboardMarkdown(input);
  assert.ok(markdown.includes('<table><tr><td>literal</td></tr></table>'));
  assert.ok(markdown.includes('$a < b$'));
});

test('OCR headings are pushed below the page heading', () => {
  assert.equal(shiftHeadings('# Title\n## Sub', 2), '### Title\n#### Sub');
  assert.equal(shiftHeadings('###### Deep', 2), '###### Deep', 'clamped at h6');
  assert.equal(
    shiftHeadings('```\n# not a heading\n```', 2),
    '```\n# not a heading\n```',
  );
});

test('the safety pass is idempotent, so the write-time pass cannot change it', () => {
  const input = [
    '# Report',
    '',
    'Coverage was 90%% and <threshold> was met. See [[Appendix]].',
    '',
    '<table><tr><th>k</th><th>v</th></tr><tr><td>$\\alpha$</td><td>1</td></tr></table>',
    '',
    '$$ \\left( x + y',
  ].join('\n');

  const once = toBreadboardMarkdown(input).markdown;
  const twice = toBreadboardMarkdown(once).markdown;
  assert.equal(twice, once);
});

test('warnings name the content that had to be changed', () => {
  const { warnings } = toBreadboardMarkdown('$$\n\\notacommand{{{\n$$');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /KaTeX/);
});
