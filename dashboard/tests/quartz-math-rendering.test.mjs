import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { VFile } from 'vfile';

const quartzRequire = createRequire(path.resolve(import.meta.dirname,'../../quartz/package.json'));
const { toHtml } = quartzRequire('hast-util-to-html');

const bundle = await build({stdin:{contents:"export { renderQuartzDocument } from '../quartz/quartz/reader.ts'; export { Latex } from '../quartz/quartz/plugins/transformers/latex.ts'; export { repairMarkdownMathFormatting } from './src/lib/markdown-math-edit.ts';",resolveDir:path.resolve(import.meta.dirname,'..'),loader:'ts'},
  bundle:true,platform:'node',format:'cjs',write:false,
  external:['@myriaddreamin/rehype-typst'],
  plugins:[{name:'omit-reader-assets',setup(builder){builder.onLoad({filter:/(?:\.scss|\.inline\.(?:ts|js))$/},()=>({contents:'',loader:'text'}));}}]});
const module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(quartzRequire,module,module.exports);
const render=async content=>(await module.exports.renderQuartzDocument({content,relativePath:'demo/lesson.md',contentRoot:'/fixture',allFiles:['demo/lesson.md']})).html;

test('the Garden reader displays numbered one-line equations without changing their annotation source',async()=>{
  const formula=String.raw`a=\frac{v^2}{r}\tag{1}`;
  for(const content of [`Before.\n\n$$${formula}$$\n\nAfter.`,`- $$${formula}$$\n\nAfter.`,`> $$${formula}$$\n\nAfter.`]){
    const html=await render(content);
    assert.doesNotMatch(html,/katex-error/);
    assert.match(html,/class="katex-display"/);
    assert.ok(html.includes(`data-bb-math-source="$$${formula}$$"`));
    assert.match(html,/After\./);
  }
});

test('the Garden reader keeps inline math inline and dollar examples as code',async()=>{
  const html=await render('Use $a=b$ here.\n\n`$$a=b\\tag{1}$$`\n\n```tex\n$$a=b\\tag{1}$$\n```');
  assert.equal((html.match(/class="katex"/g)??[]).length,1);
  assert.doesNotMatch(html,/katex-display|katex-error/);
  assert.match(html,/data-bb-math-source="\$a=b\$"/);
});

test('repaired note math renders inline, including magnitudes inside table cells', async () => {
  const original = String.raw`For \(Z_1=R\) and \(Z_2=1/(j\omega C)\), use \(\widetilde V_{\mathrm{out}}=Z_2\widetilde I\).

| Frequency | Capacitor |
|---|---|
| \(\omega\to0\) | \(|Z_C|\to\infty\) |`;
  const repaired = module.exports.repairMarkdownMathFormatting(original);
  const html = await render(repaired);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 5);
  assert.equal((html.match(/<td(?:>| )/g) ?? []).length, 2);
  assert.doesNotMatch(html, /katex-error|katex-display/);
  assert.match(html, /data-bb-math-source="\$Z_1=R\$"/);
});

test('ordinary Garden rendering accepts explicit LaTeX without rewriting the saved note', async () => {
  const content = String.raw`The amplitude is \(|x+jy|=\sqrt{x^2+y^2}\).

\[
T(j\omega)=\frac{1}{1+j\omega RC}
\]

| Quantity | Value |
|---|---|
| norm | \(\|x\|\) |

Use code literally: ` + '`\\(example\\)`' + '\n\n```tex\n\\[example\\]\n```';
  const original = content;
  const html = await render(content);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 3);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 1);
  assert.equal((html.match(/<td(?:>| )/g) ?? []).length, 2);
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(content, original);
});

test('the publication math transformer renders the same explicit delimiters as the canonical reader', async () => {
  const content = String.raw`A coefficient \(1/(RC)\) and $x=y$.

> \[x^2+y^2=r^2\]

` + '`\\(literal\\)`';
  const plugin = module.exports.Latex();
  const file = new VFile(plugin.textTransform({}, content));
  const markdown = unified().use(remarkParse).use(plugin.markdownPlugins({}));
  const tree = await markdown.run(markdown.parse(file), file);
  const html = toHtml(await unified().use(remarkRehype).use(plugin.htmlPlugins({})).run(tree, file));
  const canonical = await render(content);
  for (const output of [html, canonical]) {
    assert.equal((output.match(/class="katex"/g) ?? []).length, 3);
    assert.equal((output.match(/class="katex-display"/g) ?? []).length, 1);
    assert.match(output, /<blockquote>/);
    assert.doesNotMatch(output, /katex-error/);
  }
});
