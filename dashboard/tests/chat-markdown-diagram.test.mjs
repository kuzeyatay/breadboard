import assert from 'node:assert/strict';
import test from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { VFile } from 'vfile';
import { remarkChatDiagrams } from '../src/lib/chat-markdown-diagram.ts';

function figures(source) {
  const tree = fromMarkdown(source);
  remarkChatDiagrams()(tree, new VFile(source));
  return tree.children.filter(node => node.data?.hName === 'figure').map(node => node.data.hChildren[0]);
}

test('standalone SVG blocks retain their bounds and labels across Markdown blank lines', () => {
  const source = '<svg width="120" height="80">\n\n<text x="10" y="20">Leaf</text>\n\n</svg>';
  const [svg, next] = figures('Before\n\n' + source + '\n\nBetween\n\n' + source + '\n\nAfter');
  assert.equal(svg.properties.viewBox, '0 0 120 80');
  assert.equal(svg.properties['aria-label'], 'Leaf');
  assert.deepEqual(svg, next);
});

test('drawing examples and incomplete drawings remain literal Markdown', () => {
  const svg = '<svg><text>Leaf</text></svg>';
  for (const code of ['~~~svg\n' + svg + '\n~~~', '    ' + svg, '`' + svg + '`',
    'The tag ' + svg + ' is an example.', svg.slice(0, -2)]) {
    assert.deepEqual(figures(code), []);
  }
});

test('only static shapes, paint and bounded record expressions are rendered', () => {
  const wrap = body => '<svg viewBox="0 0 100 60">' + body + '</svg>';
  const loop = (rows, body) => '{#each ' + rows + ' as p}' + body + '{/each}';
  for (const body of [
    '<foreignObject><div>HTML</div></foreignObject>',
    '<path stroke="url(example.svg)" />',
    loop('[{x:1}]', '<text>{p.x.toString()}</text>'),
    loop('[{x:1}]', '<rect x={p.missing}/>'),
    loop(JSON.stringify(Array.from({length:129}, () => ({x:1}))), '<rect x={p.x}/>'),
  ]) assert.deepEqual(figures(wrap(body)), []);

  const [svg] = figures(wrap(loop("[{x:30,label:'<tag>'}]", '<text style="display:none" onclick="unused" x={p.x - 5}>label={p.label}</text>')));
  const [label] = svg.children;
  assert.deepEqual(label.properties, {x:'25'});
  assert.deepEqual(label.children, [{type:'text', value:'label=<tag>'}]);
});
