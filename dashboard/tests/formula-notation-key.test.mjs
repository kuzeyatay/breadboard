import assert from "node:assert/strict";
import test from "node:test";
import { formulaNotationKey } from "../src/lib/quartz-markdown.ts";

test("notation-identical formulas share a key; different formulas do not", () => {
  // Live 2026-10-02 (telecom-1 lesson 1.2): two source pages print the same
  // PSD relation as P_S/T_S and P_{S}/T_{S}.
  const a = "P_S(f) = \frac{|F(f)|^2}{T_S} \sum_{k=-\infty}^{\infty} R(k) e^{j 2 \pi k f T_S}";
  const b = "P_{S}(f) = \frac{|F(f)|^2}{T_{S}}\sum_{k=-\infty}^{\infty} R(k)e^{j2\pi kfT_{S}}";
  assert.equal(formulaNotationKey(a), formulaNotationKey(b));
  // A missing k in the exponent is a different formula.
  const c = "P_S(f) = \frac{|F(f)|^2}{T_S} \sum_{k=-\infty}^{\infty} R(k) e^{j 2 \pi f T_S}";
  assert.notEqual(formulaNotationKey(a), formulaNotationKey(c));
  // Multi-character groups keep their braces.
  assert.notEqual(formulaNotationKey("x_{ab}"), formulaNotationKey("x_ab"));
});

test("a trailing equation number is not part of the formula", async () => {
  // Live 2026-10-05 (telecom-1 lesson 2.2).
  const { formulaNotationKey } = await import("../src/lib/quartz-markdown.ts");
  const plain = formulaNotationKey(String.raw`B \ll \frac{1}{2\pi RC} \ll f_c`);
  assert.equal(formulaNotationKey(String.raw`B\ll\frac{1}{2\pi RC}\ll f_c\quad{(4-75)}`), plain);
  assert.equal(formulaNotationKey(String.raw`B\ll\frac{1}{2\pi RC}\ll f_c \tag{4-75}`), plain);
  assert.equal(formulaNotationKey(String.raw`y = f(x)`), "y=f(x)");
});

test("a trailing function argument is never mistaken for an equation number", async () => {
  const { formulaNotationKey } = await import("../src/lib/quartz-markdown.ts");
  assert.equal(formulaNotationKey("y = g(2)"), "y=g(2)");
});

test("outer display delimiters are not part of the formula", () => {
  assert.equal(
    formulaNotationKey(String.raw`\[V_T=\frac{s_{01}+s_{02}}{2}\tag{7-16}\]`),
    formulaNotationKey(String.raw`V_T=\frac{s_{01}+s_{02}}{2}\tag{7-16}`),
  );
});

test("book equation labels are ignored in every printed shape and position", () => {
  const bare = formulaNotationKey(String.raw`B\ll\frac{1}{2\pi RC}\ll f_c`);
  for (const labelled of [
    String.raw`B\ll\frac{1}{2\pi RC}\ll f_c\quad{(4-75)}`,
    String.raw`B\ll\frac{1}{2\pi RC}\ll f_c\qquad \text{(4-75)}`,
    String.raw`B\ll\frac{1}{2\pi RC}\ll f_c\quad (4-75)`,
    String.raw`B\ll\frac{1}{2\pi RC}\ll f_c\tag{4-75}`,
  ]) assert.equal(formulaNotationKey(labelled), bare, labelled);
  assert.equal(
    formulaNotationKey(String.raw`\begin{aligned}x&=1\quad(6-58)\end{aligned}`),
    formulaNotationKey(String.raw`\begin{aligned}x&=1\end{aligned}`),
  );
  // Plain chapter-local numbers are labels too (em1 4.5 and 12.2, 2026-10-16).
  assert.equal(
    formulaNotationKey(String.raw`\mathbf{E} = -\nabla V \qquad \text{(29)}`),
    formulaNotationKey(String.raw`\mathbf{E} = -\nabla V \tag{23}`),
  );
  assert.equal(
    formulaNotationKey(String.raw`\mathbf{H}=0\qquad\text{(outside)}\qquad \text{(16b)}`),
    formulaNotationKey(String.raw`\mathbf{H}=0\qquad\text{(outside)}\tag{17b}`),
  );
  // A parenthesised quantity that is not a book label stays.
  assert.notEqual(formulaNotationKey(String.raw`x=a\quad(n+1)`), formulaNotationKey("x=a"));
});
