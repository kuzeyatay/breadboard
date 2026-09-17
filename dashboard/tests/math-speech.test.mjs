import assert from 'node:assert/strict';
import test from 'node:test';
import { responseTextForSpeech as speak } from '../src/lib/speech/response-text.ts';
import { speakableText } from '../src/lib/speech/voice-conversation.ts';

test('all math delimiters preserve fractions, powers and subscripts', async () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]'], ['```math\n', '\n```'], ['~~~latex\n', '\n~~~']]) {
    const result = await speak(`The result is ${open}x^2 + y_1 = \\frac{a}{b}${close}.`);
    assert.equal(result, 'The result is x squared plus y sub 1 equals a over b.');
  }
});

test('nested expressions retain numerator, denominator, root and grouping boundaries', async () => {
  const result = await speak(String.raw`$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$`);
  assert.equal(result, 'x equals the fraction with numerator negative b plus or minus the square root of b squared minus 4 a c and denominator 2 a');
  const nested = await speak(String.raw`$\frac{1}{\frac{a+b}{c}}$`);
  assert.match(nested, /numerator 1.*denominator.*numerator a plus b.*denominator c/);
});

test('calculus, Greek letters, comparisons, and matrices are read structurally', async () => {
  assert.equal(await speak(String.raw`$$\int_0^1 x^2\,dx = \frac{1}{3}$$`), 'the integral from 0 to 1 of x squared d x equals one third');
  assert.match(await speak(String.raw`$\sum_{i=1}^{n} i$`), /sum from i equals 1 to n of i/);
  assert.equal(await speak(String.raw`$\alpha \leq \beta \neq \pi$`), 'alpha is less than or equal to beta is not equal to pi');
  assert.match(await speak(String.raw`$\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}$`), /matrix.*row.*1.*2.*row.*3.*4/i);
  assert.match(await speak(String.raw`$|x| > 0$`), /absolute value of x.*greater than 0/);
});

test('bare equations and inline code formulas have the same spoken meaning', async () => {
  for (const text of ['E = mc²', '`E=mc^2`', '$E=mc^2$']) {
    assert.equal(await speak(text), 'E equals m c squared');
  }
  assert.equal(await speak('x_1 ≥ 0'), 'x sub 1 is greater than or equal to 0');
});

test('Markdown, currency and code remain readable around formulas', async () => {
  assert.equal(await speak('## Result\n**Useful**: $x^2$. [Details](https://example.com).'), 'Result.\n\nUseful: x squared. Details.');
  for (const value of ['$5 and $10', '$18B, up from $7B', 'It costs \\$5.', 'Please use `npm test`.']) {
    assert.equal(await speak(value), value.replace('\\$', '$').replaceAll('`', ''));
  }
  assert.equal(await speak('```js\nconst price = "$5";\n```'), 'const price = "$5";');
  assert.equal(await speak('```image-results\n{"value":"$x^2$"}\n```'), '');
  assert.equal(await speak('$0 < x < 1$'), '0 is less than x is less than 1');
  assert.equal(await speak('| Value | Formula |\n| --- | --- |\n| Energy | $E=mc^2$ |'), 'Value; Formula.\n\nEnergy; E equals m c squared.');
});

test('broken formulas are explicit and do not prevent reading the rest', async () => {
  assert.equal(await speak(String.raw`Before $\notACommand{x}$. After $x^2$.`), 'Before formula could not be read aloud. After x squared.');
  assert.equal(await speak('$\frac{1}{2}$'.replace('\\f', '\f')), 'one half');
});

test('voice mode uses the same formula readings and does not truncate an equation', async () => {
  const content = String.raw`The answer is $\sqrt{x^2+y^2}$.`;
  assert.equal(await speakableText(content), await speak(content));
  const long = `${'A complete sentence. '.repeat(100)}${content}`;
  assert.ok((await speakableText(long)).endsWith(await speak(content)));
});

test('cancelled conversion cannot be sent to speech', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(speak('$x^2$', { signal: controller.signal }), { name: 'AbortError' });
  const pending = new AbortController();
  const result = speak('$x^2$', { signal: pending.signal });
  pending.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
