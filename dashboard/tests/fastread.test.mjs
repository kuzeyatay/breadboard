import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  formatTimeRemaining,
  getActualORPIndex,
  getORPIndex,
  getWordDelay,
  inlineToWords,
  mathToPlainText,
  needsTypesetting,
  parseFastReadDocument,
  resolveAssetUrl,
  splitWordForDisplay,
  stepBackward,
  stepForward,
  wordOffsets,
} from '../src/lib/fastread.ts';
import { pdfTextToMarkdown } from '../src/lib/fastread-source.ts';

// The reader is driven entirely by this timeline, so the tests below are the
// contract: what is read as words, and what stops playback.

function words(segment) {
  return segment.words.map((word) => word.text);
}

function kinds(document) {
  return document.segments.map((segment) => segment.kind);
}

/** The declaration body of the dark-mode override block. */
function darkThemeBlock(css) {
  const start = css.indexOf(".fastread-overlay[data-theme='dark'] {");
  assert.notEqual(start, -1, 'dark theme block should exist');
  return css.slice(start, css.indexOf('}', start));
}

/** Every rule body whose selector matches, concatenated. */
function sliceRules(css, selectorRe) {
  let rest = css;
  const bodies = [];

  for (let match = rest.match(selectorRe); match; match = rest.match(selectorRe)) {
    const from = rest.indexOf(match[0]);
    const open = rest.indexOf('{', from);
    const close = rest.indexOf('}', open);
    if (open === -1 || close === -1) break;
    bodies.push(rest.slice(open, close));
    rest = rest.slice(close + 1);
  }

  assert.ok(bodies.length, `expected rules matching ${selectorRe}`);
  return bodies.join('\n');
}

/* -- word maths ---------------------------------------------------------- */

test('the optimal recognition point moves outward with word length', () => {
  assert.equal(getORPIndex('a'), 0);
  assert.equal(getORPIndex('the'), 0);
  assert.equal(getORPIndex('hello'), 1);
  assert.equal(getORPIndex('spiking'), 2);
  assert.equal(getORPIndex('neuromorphic'), 3);
});

test('the focal index skips leading punctuation', () => {
  assert.equal(getActualORPIndex('hello'), 1);
  assert.equal(getActualORPIndex('"hello'), 2);
  assert.equal(getActualORPIndex('(spiking'), 3);
});

test('a word splits into before / focal letter / after', () => {
  assert.deepEqual(splitWordForDisplay('hello'), { before: 'h', orp: 'e', after: 'llo' });
  assert.deepEqual(splitWordForDisplay(''), { before: '', orp: '', after: '' });
});

test('sentence punctuation and long words hold the frame longer', () => {
  assert.equal(getWordDelay('hello', 300), 200);
  assert.equal(getWordDelay('end.', 300), 400);
  assert.equal(getWordDelay('clause,', 300), 280);
  assert.ok(getWordDelay('electroencephalography', 300) > 200);
});

test('remaining time is formatted as minutes and seconds', () => {
  assert.equal(formatTimeRemaining(300, 300), '1:00');
  assert.equal(formatTimeRemaining(0, 300), '0:00');
  assert.equal(formatTimeRemaining(150, 300), '0:30');
});

/* -- inline markdown ----------------------------------------------------- */

test('inline emphasis, links, and wikilinks read as plain words', () => {
  assert.deepEqual(
    inlineToWords('A **spiking neural network** is [described here](https://x.dev).').map((w) => w.text),
    ['A', 'spiking', 'neural', 'network', 'is', 'described', 'here.'],
  );
  assert.deepEqual(
    inlineToWords('See [[../../sources/epidemic-growth-source|the source note]] for detail.').map(
      (w) => w.text,
    ),
    ['See', 'the', 'source', 'note', 'for', 'detail.'],
  );
  assert.deepEqual(
    inlineToWords('Defined in [[spiking-neural-network]].').map((w) => w.text),
    ['Defined', 'in', 'spiking-neural-network.'],
  );
});

test('inline code and inline math stay whole as atomic words', () => {
  // `inlineToWords` is the heading path: there is no stop to pull an expression
  // into, so maths stays atomic — but still normalised, never raw source.
  const parsed = inlineToWords('The factor $R_{\\mathrm{eff}}=R_0(1-c)$ and `spike_count` matter.');
  const atomic = parsed.filter((word) => word.atomic).map((word) => word.text);
  assert.deepEqual(atomic, ['R_eff=R_0(1-c)', 'spike_count']);
});

test('dollar amounts are not mistaken for inline math', () => {
  assert.deepEqual(
    inlineToWords('It cost $5 and then $10 later.').map((w) => w.text),
    ['It', 'cost', '$5', 'and', 'then', '$10', 'later.'],
  );
});

test('snake_case identifiers survive underscore emphasis stripping', () => {
  assert.deepEqual(
    inlineToWords('Set spike_count to _zero_ now.').map((w) => w.text),
    ['Set', 'spike_count', 'to', 'zero', 'now.'],
  );
});

/* -- block segmentation -------------------------------------------------- */

test('frontmatter, HTML comments, and rules are dropped entirely', () => {
  const document = parseFastReadDocument(
    ['---', 'title: Example', 'tags: [a, b]', '---', '', '<!-- learning-unit:U1 -->', '', '---', '', 'Real prose here.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text']);
  assert.deepEqual(words(document.segments[0]), ['Real', 'prose', 'here.']);
  assert.equal(document.stopCount, 0);
});

test('a breadboard visual block becomes an interactive-visual stop', () => {
  const document = parseFastReadDocument(
    [
      'Some prose before.',
      '',
      '```breadboard-generated-visual',
      'id: visual-contact-threshold-feedback',
      'version: 1',
      '```',
      '',
      'Prose after.',
    ].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'visualizer', 'text']);
  const [, stop] = document.segments;
  assert.equal(stop.label, 'Interactive visual');
  assert.equal(stop.visualId, 'visual-contact-threshold-feedback');
  assert.equal(document.stopCount, 1);
});

test('a plain fenced block becomes a code stop labelled with its language', () => {
  const document = parseFastReadDocument(
    ['Before.', '', '```python', 'spikes = model(x)', '```', '', 'After.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'code', 'text']);
  assert.equal(document.segments[1].label, 'Python code');
  assert.match(document.segments[1].raw, /spikes = model\(x\)/);
});

test('display math is an Equation stop', () => {
  const document = parseFastReadDocument(
    ['Lead in.', '', '$$', 'V(t+1) = \\beta V(t) + I(t)', '$$', '', 'Then prose.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'math', 'text']);
  assert.equal(document.segments[1].label, 'Equation');
  assert.match(document.segments[1].raw, /\\beta V\(t\)/);
});

test('a ```math fence is an equation, not source code', () => {
  const document = parseFastReadDocument(['```math', 'E = mc^2', '```'].join('\n'));

  assert.deepEqual(kinds(document), ['math']);
  assert.equal(document.segments[0].label, 'Equation');
  assert.equal(document.segments[0].raw, '$$\nE = mc^2\n$$');
});

/* -- inline maths: term vs expression ------------------------------------ */

test('maths is normalised to readable text, never shown as raw source', () => {
  assert.equal(mathToPlainText('V_{\\text{th}}'), 'V_th');
  assert.equal(mathToPlainText('100\\,\\mathrm{Hz}'), '100 Hz');
  assert.equal(mathToPlainText('\\alpha'), 'α');
  assert.equal(mathToPlainText('\\geq'), '≥');
  assert.equal(mathToPlainText('\\omega_0'), 'ω_0');
});

test('a term reads inline; an expression needs typesetting', () => {
  // Terms: bare symbol, subscripted name, function reference, quantity, glyph,
  // and a superscript whose sign is part of the name rather than arithmetic.
  for (const term of ['B', 'V_{\\text{th}}', 'm(t)', '100\\,\\mathrm{Hz}', '\\geq', '\\alpha', 'V(t^{+})']) {
    assert.equal(needsTypesetting(term), false, `${term} should read inline`);
  }
  // Statements: a relation or operator with something to operate on.
  for (const expression of ['x<0', 'f_s \\ge 2B', 'N_0/2', 'V_{\\text{th}}=1.0', '\\frac{1}{2}', '\\sqrt{x}']) {
    assert.equal(needsTypesetting(expression), true, `${expression} should be typeset`);
  }
});

test('an inline expression stops mid-sentence and is typeset', () => {
  const document = parseFastReadDocument('The gate opens when $x<0$ holds for the input.');

  assert.deepEqual(kinds(document), ['text', 'math', 'text']);
  assert.equal(document.segments[1].label, 'Expression');
  assert.equal(document.segments[1].raw, '$$\nx<0\n$$');
  assert.deepEqual(words(document.segments[0]), ['The', 'gate', 'opens', 'when']);
  assert.deepEqual(words(document.segments[2]), ['holds', 'for', 'the', 'input.']);
});

test('inline terms stay in the word stream, shown readably', () => {
  const document = parseFastReadDocument(
    'Let $V_{\\text{th}}$ be the threshold and $m(t)$ the signal at $100\\,\\mathrm{Hz}$.',
  );

  assert.deepEqual(kinds(document), ['text']);
  assert.deepEqual(words(document.segments[0]), [
    'Let',
    'V_th',
    'be',
    'the',
    'threshold',
    'and',
    'm(t)',
    'the',
    'signal',
    'at',
    '100 Hz.',
  ]);
  assert.equal(document.segments[0].words[1].atomic, true);
});

test('a lone relation glyph is named, not typeset', () => {
  const document = parseFastReadDocument('The symbol $\\geq$ means at least.');

  assert.deepEqual(kinds(document), ['text']);
  assert.deepEqual(words(document.segments[0]), ['The', 'symbol', '≥', 'means', 'at', 'least.']);
});

test('a link label resolves before its maths is classified', () => {
  // The label is inlined as prose, so the expression inside it is treated like
  // any other — what must not happen is `[[…]]` syntax leaking into the words.
  const document = parseFastReadDocument('See [[ground-model|the $1/d^4$ Rule]] for detail.');

  assert.deepEqual(kinds(document), ['text', 'math', 'text']);
  assert.deepEqual(words(document.segments[0]), ['See', 'the']);
  assert.equal(document.segments[1].raw, '$$\n1/d^4\n$$');
  assert.deepEqual(words(document.segments[2]), ['Rule', 'for', 'detail.']);
});

test('a term keeps the punctuation that follows it', () => {
  const document = parseFastReadDocument('It settles at $100\\,\\mathrm{Hz}$. Then it holds.');
  const stream = words(document.segments[0]);

  assert.deepEqual(kinds(document), ['text']);
  assert.ok(stream.includes('100 Hz.'), `expected a full stop on the quantity, got ${stream.join(' ')}`);
});

test('inline code is never treated as maths', () => {
  const document = parseFastReadDocument('Set `spike_count = 0` before the loop.');

  assert.deepEqual(kinds(document), ['text']);
  assert.deepEqual(words(document.segments[0]), ['Set', 'spike_count = 0', 'before', 'the', 'loop.']);
});

test('single-line display math is recognised', () => {
  const document = parseFastReadDocument('$$E = mc^2$$');
  assert.deepEqual(kinds(document), ['math']);
  assert.match(document.segments[0].raw, /E = mc\^2/);
});

test('LaTeX bracket delimiters are display math too', () => {
  const multi = parseFastReadDocument(
    ['Defined as', '', '\\[', 'P=\\frac{1}{2R}[\\max(|g(t)|)]^2', '\\]', '', 'where R is the load.'].join('\n'),
  );

  assert.deepEqual(kinds(multi), ['text', 'math', 'text']);
  assert.match(multi.segments[1].raw, /\\frac\{1\}\{2R\}/);
  assert.deepEqual(words(multi.segments[2]), ['where', 'R', 'is', 'the', 'load.']);

  const single = parseFastReadDocument('\\[ x = y \\]');
  assert.deepEqual(kinds(single), ['math']);
  assert.match(single.segments[0].raw, /x = y/);
});

test('LaTeX parenthesis delimiters are inline math, kept atomic', () => {
  const parsed = inlineToWords('The power \\(P_{PEP}\\) is defined for \\(g(t)\\) here.');
  assert.deepEqual(
    parsed.filter((word) => word.atomic).map((word) => word.text),
    ['P_PEP', 'g(t)'],
  );
  assert.deepEqual(
    parsed.filter((word) => !word.atomic).map((word) => word.text),
    ['The', 'power', 'is', 'defined', 'for', 'here.'],
  );
});

test('stray dashes, pipes, and other punctuation-only tokens are skipped', () => {
  assert.deepEqual(
    inlineToWords('- Additive - Because the noise adds.').map((w) => w.text),
    ['Additive', 'Because', 'the', 'noise', 'adds.'],
  );
  assert.deepEqual(
    inlineToWords('|r(t)|2 = |').map((w) => w.text),
    ['|r(t)|2', '=', '|'].filter((token) => /[\p{L}\p{N}]/u.test(token)),
  );
});

test('image alt text may contain its own brackets and an empty source', () => {
  const document = parseFastReadDocument('![Figure 90: Bessel functions. [2]]()');

  assert.deepEqual(kinds(document), ['image']);
  assert.equal(document.segments[0].alt, 'Figure 90: Bessel functions. [2]');
  assert.equal(document.segments[0].src, '');
});

test('a LaTeX equation environment becomes a math stop', () => {
  const document = parseFastReadDocument(
    ['Lead in.', '', '\\begin{equation}', 'x = y', '\\end{equation}', '', 'Lead out.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'math', 'text']);
});

test('markdown tables become table stops', () => {
  const document = parseFastReadDocument(
    ['Results follow.', '', '| Model | Accuracy |', '| --- | ---: |', '| SNN | 0.91 |', '', 'Discussion.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'table', 'text']);
  assert.match(document.segments[1].raw, /\| SNN \| 0\.91 \|/);
});

test('a pipe character in prose is not read as a table', () => {
  const document = parseFastReadDocument('Read it as p(a | b) in conditional form.');
  assert.deepEqual(kinds(document), ['text']);
});

test('an image splits the surrounding prose and stops in between', () => {
  const document = parseFastReadDocument(
    'Look at ![the doorway sensor](/test-2/assets/sensor.png) and note the timing.',
  );

  assert.deepEqual(kinds(document), ['text', 'image', 'text']);
  assert.deepEqual(words(document.segments[0]), ['Look', 'at']);
  assert.equal(document.segments[1].src, '/test-2/assets/sensor.png');
  assert.equal(document.segments[1].alt, 'the doorway sensor');
  assert.deepEqual(words(document.segments[2]), ['and', 'note', 'the', 'timing.']);
});

test('obsidian-style embeds and HTML images are image stops', () => {
  const wiki = parseFastReadDocument('![[assets/diagram.png|A diagram]]');
  assert.deepEqual(kinds(wiki), ['image']);
  assert.equal(wiki.segments[0].src, 'assets/diagram.png');
  assert.equal(wiki.segments[0].alt, 'A diagram');

  const html = parseFastReadDocument('<img src="/g/assets/plot.svg" alt="Plot" />');
  assert.deepEqual(kinds(html), ['image']);
  assert.equal(html.segments[0].src, '/g/assets/plot.svg');
});

test('iframes and video are embed stops, never injected markup', () => {
  const document = parseFastReadDocument('<iframe src="https://example.com/sim"></iframe>');
  assert.deepEqual(kinds(document), ['embed']);
  assert.equal(document.segments[0].label, 'Embedded media');
});

test('headings stay in the word stream and name the current section', () => {
  const document = parseFastReadDocument(
    ['# Why Spiking Networks Exist', '', 'Imagine a small camera.'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text']);
  assert.equal(document.segments[0].sectionTitle, 'Why Spiking Networks Exist');
  assert.deepEqual(words(document.segments[0]), [
    'Why',
    'Spiking',
    'Networks',
    'Exist',
    'Imagine',
    'a',
    'small',
    'camera.',
  ]);
  assert.equal(document.segments[0].words[0].heading, true);
  assert.equal(document.segments[0].words[4].heading, false);
});

test('a stop carries the heading it appeared under', () => {
  const document = parseFastReadDocument(
    ['## What to notice', '', '```mermaid', 'graph TD; A-->B;', '```'].join('\n'),
  );

  const stop = document.segments.find((segment) => segment.kind === 'visualizer');
  assert.equal(stop.sectionTitle, 'What to notice');
  assert.equal(stop.label, 'Diagram');
});

test('list markers, checkboxes, blockquotes, and callouts are stripped', () => {
  const document = parseFastReadDocument(
    ['- first point', '2. second point', '- [x] done item', '> [!note] Take care', '> quoted line'].join('\n'),
  );

  assert.deepEqual(words(document.segments[0]), [
    'first',
    'point',
    'second',
    'point',
    'done',
    'item',
    'Take',
    'care',
    'quoted',
    'line',
  ]);
});

test('consecutive non-text blocks each get their own stop', () => {
  const document = parseFastReadDocument(
    ['Intro.', '', '![a](/x.png)', '', '```js', 'let a = 1;', '```', '', '$$', 'y = x', '$$'].join('\n'),
  );

  assert.deepEqual(kinds(document), ['text', 'image', 'code', 'math']);
  assert.equal(document.stopCount, 3);
});

test('word counts and offsets line up across the timeline', () => {
  const document = parseFastReadDocument(
    ['One two three.', '', '![a](/x.png)', '', 'Four five.'].join('\n'),
  );

  assert.equal(document.totalWords, 5);
  assert.deepEqual(wordOffsets(document.segments), [0, 3, 3]);
});

test('empty and whitespace input produce an empty timeline', () => {
  assert.deepEqual(parseFastReadDocument('').segments, []);
  assert.equal(parseFastReadDocument('   \n\n  ').totalWords, 0);
});

/* -- playback state machine ---------------------------------------------- */

/**
 * Play a document the way the reader does: keep stepping while the step yields a
 * word, and record every point where playback had to halt.
 */
function play(markdown) {
  const { segments } = parseFastReadDocument(markdown);
  const shown = [];
  const halts = [];
  let cursor = { segmentIndex: 0, wordIndex: 0 };

  if (segments[0] && segments[0].kind !== 'text') halts.push(segments[0].label);

  for (let guard = 0; guard < 10_000; guard += 1) {
    const active = segments[cursor.segmentIndex];
    if (active?.kind === 'text') shown.push(active.words[cursor.wordIndex].text);

    const step = stepForward(segments, cursor);
    if (step.type === 'end') return { shown, halts, endedCleanly: true };
    if (step.type === 'stop') halts.push(segments[step.cursor.segmentIndex].label);
    cursor = step.cursor;
  }

  throw new Error('playback did not terminate');
}

test('playback halts at every non-text block and nowhere else', () => {
  const { shown, halts, endedCleanly } = play(
    [
      'Read one two.',
      '',
      '![a](/x.png)',
      '',
      'Then three.',
      '',
      '```python',
      'y = 1',
      '```',
      '',
      '$$',
      'x = y',
      '$$',
      '',
      'Finally four.',
    ].join('\n'),
  );

  assert.equal(endedCleanly, true);
  // Every readable word is shown exactly once, in document order.
  assert.deepEqual(shown, ['Read', 'one', 'two.', 'Then', 'three.', 'Finally', 'four.']);
  // And playback paused once per block that is looked at rather than read.
  assert.deepEqual(halts, ['Image', 'Python code', 'Equation']);
});

test('a document that opens on a stop halts before any word is read', () => {
  const { shown, halts } = play(['![a](/x.png)', '', 'Now read this.'].join('\n'));

  assert.deepEqual(halts, ['Image']);
  assert.deepEqual(shown, ['Now', 'read', 'this.']);
});

test('back-to-back stops each halt separately', () => {
  const { halts } = play(['Intro.', '', '![a](/x.png)', '', '![b](/y.png)', '', 'Outro.'].join('\n'));
  assert.deepEqual(halts, ['Image', 'Image']);
});

test('stepping forward off the last word ends rather than wrapping', () => {
  const { segments } = parseFastReadDocument('Just two words');
  assert.deepEqual(stepForward(segments, { segmentIndex: 0, wordIndex: 2 }), { type: 'end' });
  assert.deepEqual(stepForward([], { segmentIndex: 0, wordIndex: 0 }), { type: 'end' });
});

test('crossing into more prose reports text, not a stop', () => {
  // A heading flushes the run, so two text segments sit next to each other.
  const { segments } = parseFastReadDocument(['First line.', '', '## Next section', '', 'More.'].join('\n'));
  const boundary = stepForward(segments, { segmentIndex: 0, wordIndex: segments[0].words.length - 1 });

  assert.equal(boundary.type, 'text');
  assert.deepEqual(boundary.cursor, { segmentIndex: 1, wordIndex: 0 });
});

test('stepping back walks into the previous segment and stops at the start', () => {
  const { segments } = parseFastReadDocument(['One two.', '', '![a](/x.png)', '', 'Three.'].join('\n'));

  // From the first word of the last run, back into the image stop.
  assert.deepEqual(stepBackward(segments, { segmentIndex: 2, wordIndex: 0 }), {
    segmentIndex: 1,
    wordIndex: 0,
  });
  // From the stop, back onto the last word of the opening run.
  assert.deepEqual(stepBackward(segments, { segmentIndex: 1, wordIndex: 0 }), {
    segmentIndex: 0,
    wordIndex: 1,
  });
  // At the very beginning there is nowhere to go.
  assert.equal(stepBackward(segments, { segmentIndex: 0, wordIndex: 0 }), null);
});

test('every word of a real garden note is reachable by stepping', () => {
  const markdown = fs.readFileSync(
    fileURLToPath(
      new URL(
        '../../quartz/content/test-2/learning/3. Describing Firing Threshold Formally/3.1 Threshold Crossing, Spike Emission, and Reset.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  const document = parseFastReadDocument(markdown);
  const { shown, halts } = play(markdown);

  assert.equal(shown.length, document.totalWords);
  assert.equal(halts.length, document.stopCount);
  // Three display equations and the figure, plus six inline statements such as
  // "V_th = 1.0" and "1.03 ≥ 1.0". Bare terms keep reading in the stream.
  assert.deepEqual(halts, [
    'Equation',
    'Expression',
    'Expression',
    'Equation',
    'Image',
    'Equation',
    'Expression',
    'Expression',
    'Expression',
    'Expression',
  ]);
  assert.ok(shown.includes('V_th'), 'a subscripted name should read inline');
  assert.ok(shown.includes('V(t^+)'), 'a superscript is part of a name, not an operator');
  assert.ok(!shown.some((word) => word.includes('\\')), 'no raw LaTeX in the word stream');
});

/* -- asset resolution ---------------------------------------------------- */

test('relative asset paths resolve against the garden origin', () => {
  assert.equal(
    resolveAssetUrl('/test-2/assets/sensor.png', 'http://localhost:8081'),
    'http://localhost:8081/test-2/assets/sensor.png',
  );
  assert.equal(
    resolveAssetUrl('./assets/plot.svg', 'http://localhost:8081/'),
    'http://localhost:8081/assets/plot.svg',
  );
  assert.equal(
    resolveAssetUrl('https://cdn.example.com/a.png', 'http://localhost:8081'),
    'https://cdn.example.com/a.png',
  );
  assert.equal(resolveAssetUrl('data:image/png;base64,AAA', 'http://localhost:8081'), 'data:image/png;base64,AAA');
});

/* -- PDF text layer ------------------------------------------------------ */

/** pdf.js hands back runs, not lines; `hasEOL` marks where the line broke. */
function pdfPage(lines) {
  return {
    items: lines.map((line) => ({ str: line, hasEOL: true })),
  };
}

test('a page of text runs becomes lines', () => {
  const markdown = pdfTextToMarkdown([
    { items: [{ str: 'The gate ' }, { str: 'opens.', hasEOL: true }, { str: 'Then it holds.' }] },
  ]);

  assert.equal(markdown, 'The gate opens.\nThen it holds.');
});

test('marked-content markers carry no text and are skipped', () => {
  const markdown = pdfTextToMarkdown([
    { items: [{ type: 'beginMarkedContent' }, { str: 'Readable.', hasEOL: true }, { type: 'endMarkedContent' }] },
  ]);

  assert.equal(markdown, 'Readable.');
});

test('a word split across a line break is rejoined', () => {
  const markdown = pdfTextToMarkdown([pdfPage(['The measured environ-', 'ment settles.'])]);

  assert.equal(markdown, 'The measured environment settles.');
});

test('a dash before a new sentence is left alone', () => {
  const markdown = pdfTextToMarkdown([pdfPage(['The result — clear —', 'The next claim follows.'])]);

  assert.equal(markdown, 'The result — clear —\nThe next claim follows.');
});

test('page numbers are not read as words', () => {
  const markdown = pdfTextToMarkdown([pdfPage(['Opening line.', '12']), pdfPage(['Closing line.', 'xiv'])]);

  assert.equal(markdown, 'Opening line.\n\nClosing line.');
});

test('a running head repeated across pages is dropped', () => {
  const pages = [
    pdfPage(['Chapter 3: Damping', 'First point.']),
    pdfPage(['Chapter 3: Damping', 'Second point.']),
    pdfPage(['Chapter 3: Damping', 'Third point.']),
  ];

  assert.equal(pdfTextToMarkdown(pages), 'First point.\n\nSecond point.\n\nThird point.');
});

test('a repeated line survives when the PDF is too short to tell', () => {
  const pages = [pdfPage(['Damping', 'First point.']), pdfPage(['Damping', 'Second point.'])];

  assert.equal(pdfTextToMarkdown(pages), 'Damping\nFirst point.\n\nDamping\nSecond point.');
});

test('paragraph breaks survive and blank runs collapse', () => {
  const markdown = pdfTextToMarkdown([pdfPage(['One.', '', '', 'Two.'])]);

  assert.equal(markdown, 'One.\n\nTwo.');
});

test('a scanned PDF with no text layer reads as empty', () => {
  assert.equal(pdfTextToMarkdown([{ items: [] }, { items: [] }]), '');
});

test('extracted PDF text parses into a readable word stream', () => {
  const markdown = pdfTextToMarkdown([pdfPage(['A damped oscil-', 'lator loses energy.', '4'])]);
  const { segments, totalWords } = parseFastReadDocument(markdown);

  assert.deepEqual(words(segments[0]), ['A', 'damped', 'oscillator', 'loses', 'energy.']);
  assert.equal(totalWords, 5);
});

/* -- wiring -------------------------------------------------------------- */

test('the garden navbar renders the Fast-read button', () => {
  const page = fs.readFileSync(
    fileURLToPath(new URL('../src/app/garden/[clusterSlug]/page.tsx', import.meta.url)),
    'utf8',
  );
  const button = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-button.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(page, /import FastReadButton from '@\/app\/components\/fastread-button'/);
  assert.match(page, /<FastReadButton clusterSlug=\{clusterSlug\} initialNote=\{note\} \/>/);
  // The feature is spelled Fast-read everywhere it is read.
  assert.match(button, /'Opening\.\.\.' : 'Fast-read'/);
  assert.doesNotMatch(button, />\s*Fastread\s*</);
});

test('the reader names itself Fast-read', () => {
  const reader = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-reader.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(reader, /className="fastread-eyebrow">Fast-read</);
  assert.match(reader, /aria-label="Fast-read reader"/);
  assert.match(reader, /aria-label="Close Fast-read"/);
});

test('the PDF viewer opens Fast-read from the note, then from the file itself', () => {
  const viewer = fs.readFileSync(
    fileURLToPath(
      new URL('../src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx', import.meta.url),
    ),
    'utf8',
  );

  assert.match(viewer, /import FastReadReader from "@\/app\/components\/fastread-reader"/);
  assert.match(viewer, /fetchFastReadNote,\r?\n\s+pdfTextToMarkdown,/);
  assert.match(viewer, /\{fastReadLoading \? "Opening\.\.\." : "Fast-read"\}/);

  // The note is tried first; only its failure falls through to the text layer.
  const open = viewer.slice(viewer.indexOf('const openFastRead'));
  const body = open.slice(0, open.indexOf('\n  }, ['));
  assert.ok(
    body.indexOf('fetchFastReadNote') < body.indexOf('pdfTextToMarkdown'),
    'the markdown note should be preferred over the PDF text layer',
  );
  assert.match(body, /getTextContent\(\)/);

  // Artifact PDFs have no note to fetch, so the button must not require one.
  assert.doesNotMatch(viewer, /disabled=\{[^}]*!documentSlug[^}]*\}\s*\n\s*title="Speed-read/);
});

test('the overlay portals out of the navbar stacking context', () => {
  const reader = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-reader.tsx', import.meta.url)),
    'utf8',
  );
  const page = fs.readFileSync(
    fileURLToPath(new URL('../src/app/garden/[clusterSlug]/page.tsx', import.meta.url)),
    'utf8',
  );

  // The button sits inside a `relative z-10` wrapper. That is a stacking
  // context, so an overlay rendered in place could never rise above the garden's
  // floating Quartz AI launcher (z-70) no matter what z-index it claimed.
  assert.match(page, /className="relative z-10 flex items-center gap-2"/);
  assert.match(reader, /import \{ createPortal \} from 'react-dom'/);
  assert.match(reader, /createPortal\(overlay, document\.body\)/);
  // Server rendering has no document; the overlay must still render inline.
  assert.match(reader, /typeof document === 'undefined' \? overlay :/);
});

test('the overlay clears the Quartz AI launcher and the desktop title bar', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../src/app/globals.css', import.meta.url)), 'utf8');
  const assistant = fs.readFileSync(
    fileURLToPath(new URL('../src/app/garden/garden-assistant.tsx', import.meta.url)),
    'utf8',
  );

  const rule = css.slice(css.indexOf('.fastread-overlay {'));
  const block = rule.slice(0, rule.indexOf('}'));

  // Above the Quartz AI launcher, below dialogs and toasts (z-100+).
  assert.match(assistant, /fixed bottom-5 right-5 z-\[70\]/);
  assert.match(block, /z-index: 80;/);

  // Inset below the native window controls, with a browser fallback of 0.
  assert.match(block, /inset: var\(--breadboard-titlebar-height, 0px\) 0 0 0;/);
  assert.match(css, /--breadboard-titlebar-height: 32px;/);
});

test('the reader opens paused on the first word', () => {
  const reader = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-reader.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(reader, /const \[playing, setPlaying\] = useState\(false\);/);
  assert.match(reader, /Open paused/);
  // Nothing may auto-start it: the clock only runs once `playing` is set by hand.
  assert.doesNotMatch(reader, /setPlaying\(true\)/);
});

test('dark reading mode is scoped to the overlay and remembered', () => {
  const reader = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-reader.tsx', import.meta.url)),
    'utf8',
  );
  const css = fs.readFileSync(fileURLToPath(new URL('../src/app/globals.css', import.meta.url)), 'utf8');

  assert.match(reader, /data-theme=\{theme\}/);
  assert.match(reader, /THEME_STORAGE_KEY, theme/);
  // Falls back to the OS preference before the app's light default.
  assert.match(reader, /prefers-color-scheme: dark/);

  const block = darkThemeBlock(css);
  // Redefining the base tokens is what carries dark into the shared markdown
  // renderer, its code blocks, and KaTeX.
  for (const token of ['--paper-surface', '--ink', '--line', '--botanical', '--danger']) {
    assert.ok(block.includes(`${token}:`), `dark theme should redefine ${token}`);
  }
  // Scoped to the overlay, so it cannot leak into the light dashboard.
  assert.doesNotMatch(css, /^\s*html\[data-theme='dark'\]/m);
});

test('every themed token the reader paints with is redeclared for dark', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../src/app/globals.css', import.meta.url)), 'utf8');
  const dark = darkThemeBlock(css);

  // A custom property resolves its var() references on the element where it is
  // DECLARED. So a derived token like `--neu-surface: var(--paper-surface)`
  // computes to the light value at :root and inherits as that literal colour —
  // overriding `--paper-surface` on the overlay cannot reach it. Every themed
  // token the reader touches therefore has to be redeclared in the dark block,
  // or dark mode paints light surfaces (a white equation card on a dark page).
  const declaredInDark = new Set([...dark.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

  // Tokens that carry no colour, so the theme cannot affect them.
  const themeIndependent =
    /^--(font|neu-radius|neu-duration|neu-easing|breadboard-titlebar-height|bb-scrollbar-size)/;

  const rulesThatPaintTheReader = [
    sliceRules(css, /^\.fastread/m),
    sliceRules(css, /^\.chat-markdown\b/m),
  ].join('\n');

  const missing = [
    ...new Set([...rulesThatPaintTheReader.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])),
  ]
    .filter((token) => !themeIndependent.test(token))
    .filter((token) => !declaredInDark.has(token))
    .sort();

  assert.deepEqual(
    missing,
    [],
    `these tokens stay light in dark mode: ${missing.join(', ')}`,
  );
});

test('the reader holds at a stop and only advances on Continue', () => {
  const reader = fs.readFileSync(
    fileURLToPath(new URL('../src/app/components/fastread-reader.tsx', import.meta.url)),
    'utf8',
  );

  // The playback clock must refuse to run while a stop is on screen.
  assert.match(reader, /if \(!playing \|\| stop \|\| !currentWord\) return;/);
  // Reaching a stop pauses instead of reading through it.
  assert.match(reader, /if \(step\.type === 'stop'\) setPlaying\(false\);/);
  // Playback resumes only when the next segment is prose again.
  assert.match(reader, /setPlaying\(step\.type === 'text'\);/);
  assert.match(reader, /onClick=\{continuePastStop\}/);
  assert.match(reader, /Continue reading/);
});
